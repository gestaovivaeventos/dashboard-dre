import { NextResponse } from 'next/server'

import { getCurrentSessionContext } from '@/lib/auth/session'
import { createAdminClientIfAvailable } from '@/lib/supabase/admin'

interface Params {
  params: { id: string }
}

function canUseContracts(
  role: string | undefined,
  contractsOnly: boolean | undefined,
): boolean {
  return contractsOnly === true || role === 'admin' || role === 'gestor_hero'
}

export async function GET(_request: Request, { params }: Params) {
  const { supabase, user, profile } = await getCurrentSessionContext()
  if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  if (!canUseContracts(profile?.role, profile?.contracts_only)) {
    return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 })
  }

  const db = createAdminClientIfAvailable() ?? supabase

  const { data: batch, error: batchErr } = await db
    .from('contract_validation_batches')
    .select(
      'id, name, status, total_items, items_approved, items_reproved, items_failed, items_specialist, items_verificar_saldo, ai_credits_used, created_at, started_at, completed_at, error_message, company_id',
    )
    .eq('id', params.id)
    .maybeSingle()

  if (batchErr) {
    return NextResponse.json({ error: batchErr.message }, { status: 500 })
  }
  if (!batch) {
    return NextResponse.json({ error: 'Lote não encontrado.' }, { status: 404 })
  }

  const { data: items, error: itemsErr } = await db
    .from('contract_validation_items')
    .select(
      'id, requisicao_codigo, fornecedor, favorecido, cpf_cnpj, conta, valor, link_contrato, tipo_documento, data_baile, extracted_fornecedor, extracted_cpf_cnpj, extracted_conta, extracted_valor_contrato, status, status_motivos, status_resumo, ai_credits, error_log, processed_at, created_at',
    )
    .eq('batch_id', params.id)
    .order('created_at', { ascending: true })

  if (itemsErr) {
    return NextResponse.json({ error: itemsErr.message }, { status: 500 })
  }

  return NextResponse.json({ batch, items: items ?? [] })
}

export async function DELETE(_request: Request, { params }: Params) {
  const { supabase, user, profile } = await getCurrentSessionContext()
  if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  if (profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Apenas admin pode apagar lotes.' }, { status: 403 })
  }

  const db = createAdminClientIfAvailable() ?? supabase
  const { error } = await db.from('contract_validation_batches').delete().eq('id', params.id)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
