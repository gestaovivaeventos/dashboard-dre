import { NextResponse } from 'next/server'

import { getCurrentSessionContext } from '@/lib/auth/session'
import { processBatch } from '@/lib/contracts/process-batch'
import { createAdminClient, createAdminClientIfAvailable } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const maxDuration = 300

interface Params {
  params: { id: string }
}

export async function POST(_request: Request, { params }: Params) {
  const { supabase, user, profile } = await getCurrentSessionContext()
  if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  const allowed =
    profile?.contracts_only === true ||
    profile?.role === 'admin' ||
    profile?.role === 'gestor_hero'
  if (!allowed) {
    return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 })
  }

  const db = createAdminClientIfAvailable() ?? supabase

  // Confirm the batch exists and the caller has access via RLS before we
  // start hitting paid APIs.
  const { data: batch, error } = await db
    .from('contract_validation_batches')
    .select('id, status')
    .eq('id', params.id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!batch) return NextResponse.json({ error: 'Lote não encontrado.' }, { status: 404 })

  if (batch.status === 'pending') {
    await db
      .from('contract_validation_batches')
      .update({ status: 'processing' })
      .eq('id', params.id)
  }

  // Use the service-role client so RLS doesn't fight the batch update loop.
  // Process only 1 item per manual click so the request returns fast with
  // diagnostics. The cron drains the rest in the background.
  const adminDb = createAdminClient()
  const result = await processBatch(adminDb, params.id, {
    maxItems: 1,
    timeBudgetMs: 250_000,
  })
  return NextResponse.json({ ok: true, ...result })
}
