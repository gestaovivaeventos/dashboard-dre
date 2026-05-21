import { NextResponse } from 'next/server'

import { getCurrentSessionContext } from '@/lib/auth/session'
import { parseRequisitionsXlsx } from '@/lib/contracts/parse-xlsx'
import { createAdminClientIfAvailable } from '@/lib/supabase/admin'

function canUseContracts(
  role: string | undefined,
  contractsOnly: boolean | undefined,
): boolean {
  return contractsOnly === true || role === 'admin' || role === 'gestor_hero'
}

export async function GET() {
  const { supabase, user, profile } = await getCurrentSessionContext()
  if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  if (!canUseContracts(profile?.role, profile?.contracts_only)) {
    return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 })
  }

  const db = createAdminClientIfAvailable() ?? supabase

  const { data, error } = await db
    .from('contract_validation_batches')
    .select(
      'id, name, status, total_items, items_approved, items_reproved, items_failed, items_specialist, items_verificar_saldo, ai_credits_used, created_at, started_at, completed_at, company_id, error_message',
    )
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ batches: data ?? [] })
}

export async function POST(request: Request) {
  const { supabase, user, profile } = await getCurrentSessionContext()
  if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  if (!canUseContracts(profile?.role, profile?.contracts_only)) {
    return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 })
  }

  const db = createAdminClientIfAvailable() ?? supabase

  // The contract validation module is enabled per-company via the
  // contract_validation_enabled flag. Pick the first enabled company —
  // today only VE Franqueadora has it on (decision from 2026-05-19).
  const { data: companies, error: companyErr } = await db
    .from('companies')
    .select('id, name')
    .eq('contract_validation_enabled', true)
    .eq('active', true)
    .order('name')

  if (companyErr) {
    return NextResponse.json({ error: companyErr.message }, { status: 500 })
  }
  if (!companies || companies.length === 0) {
    return NextResponse.json(
      { error: 'Nenhuma empresa habilitada para validação de contratos.' },
      { status: 400 },
    )
  }

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  const nameRaw = (formData.get('name') as string | null)?.trim()
  const companyIdRaw = (formData.get('company_id') as string | null)?.trim()

  if (!file) {
    return NextResponse.json({ error: 'Envie um arquivo .xlsx.' }, { status: 400 })
  }

  const company = companyIdRaw
    ? companies.find((c) => c.id === companyIdRaw)
    : companies[0]
  if (!company) {
    return NextResponse.json(
      { error: 'Empresa não encontrada ou sem permissão para validação.' },
      { status: 400 },
    )
  }

  let parsed: ReturnType<typeof parseRequisitionsXlsx>
  try {
    const buffer = await file.arrayBuffer()
    parsed = parseRequisitionsXlsx(buffer)
  } catch (e) {
    return NextResponse.json(
      { error: `Falha ao ler a planilha: ${(e as Error).message}` },
      { status: 400 },
    )
  }

  const batchName = nameRaw || `${file.name} — ${new Date().toLocaleString('pt-BR')}`

  const { data: batch, error: batchErr } = await db
    .from('contract_validation_batches')
    .insert({
      company_id: company.id,
      created_by: user.id,
      name: batchName,
      source_file_name: file.name,
      total_items: parsed.rows.length,
      status: 'pending',
    })
    .select('id')
    .single()

  if (batchErr || !batch) {
    return NextResponse.json(
      { error: `Falha ao criar lote: ${batchErr?.message ?? 'erro desconhecido'}` },
      { status: 500 },
    )
  }

  const itemsToInsert = parsed.rows.map((row) => ({
    batch_id: batch.id,
    company_id: company.id,
    requisicao_codigo: row.requisicao_codigo,
    fornecedor: row.fornecedor,
    favorecido: row.favorecido,
    cpf_cnpj: row.cpf_cnpj,
    conta: row.conta,
    valor: row.valor,
    link_contrato: row.link_contrato,
    status: 'pending' as const,
  }))

  // Insert in chunks to stay well under the PostgREST row limit.
  const CHUNK = 500
  for (let i = 0; i < itemsToInsert.length; i += CHUNK) {
    const chunk = itemsToInsert.slice(i, i + CHUNK)
    const { error: itemErr } = await db.from('contract_validation_items').insert(chunk)
    if (itemErr) {
      // Roll back the batch so the user can retry.
      await db.from('contract_validation_batches').delete().eq('id', batch.id)
      return NextResponse.json(
        { error: `Falha ao gravar items: ${itemErr.message}` },
        { status: 500 },
      )
    }
  }

  return NextResponse.json({
    ok: true,
    batch_id: batch.id,
    company: company.name,
    total_items: parsed.rows.length,
    warnings: parsed.warnings,
  })
}
