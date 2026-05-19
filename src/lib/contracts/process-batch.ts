// Drains a single contract validation batch:
//   1) extract data for every item missing tipo_documento (LandingAI + Gemini)
//   2) compute soma_grupos over all extracted items
//   3) run analisarLinha for every item, saving status + motivos
//   4) update batch counters and transition to "completed" (or "failed")
//
// Designed to be resumable: if step 1 partially succeeds (timeout/error),
// the next run picks up where it left off because extraction is keyed off
// "tipo_documento IS NULL".

import { extractContract } from './extract'
import { LandingAIError } from './landingai'
import { LlmExtractionError } from './llm'
import { calcularSomaGrupos, analisarLinha, chaveGrupoSoma } from './validate'
import type { ValidationStatus } from './types'
import type { SupabaseClient } from '@supabase/supabase-js'

interface BatchRow {
  id: string
  company_id: string
  total_items: number
  status: 'pending' | 'processing' | 'completed' | 'failed'
}

interface ItemRow {
  id: string
  requisicao_codigo: string
  fornecedor: string | null
  favorecido: string | null
  cpf_cnpj: string | null
  conta: string | null
  valor: number | string | null
  link_contrato: string
  tipo_documento: string | null
  extracted_fornecedor: string | null
  extracted_cpf_cnpj: string | null
  extracted_conta: string | null
  extracted_valor_contrato: number | string | null
  extracted_pagamentos: number[] | null
  assinatura_contratante: string | null
  assinatura_contratado: string | null
  status: ValidationStatus | 'pending' | 'processing'
}

export interface ProcessBatchResult {
  batch_id: string
  extracted: number
  validated: number
  errors: number
  credits_used: number
  status: BatchRow['status']
}

export async function processNextPendingBatch(
  db: SupabaseClient,
): Promise<ProcessBatchResult | null> {
  // Pick the oldest batch that still has work to do.
  const { data: batches } = await db
    .from('contract_validation_batches')
    .select('id, company_id, total_items, status')
    .in('status', ['pending', 'processing'])
    .order('created_at', { ascending: true })
    .limit(1)

  const batch = batches?.[0] as BatchRow | undefined
  if (!batch) return null

  // Transition to "processing" if it's still "pending" so the UI reflects activity.
  if (batch.status === 'pending') {
    await db
      .from('contract_validation_batches')
      .update({ status: 'processing' })
      .eq('id', batch.id)
  }

  return processBatch(db, batch.id)
}

export async function processBatch(
  db: SupabaseClient,
  batchId: string,
): Promise<ProcessBatchResult> {
  const result: ProcessBatchResult = {
    batch_id: batchId,
    extracted: 0,
    validated: 0,
    errors: 0,
    credits_used: 0,
    status: 'processing',
  }

  // ── Phase 1: extract missing data ──────────────────────────────────────────
  const { data: pendingExtraction } = await db
    .from('contract_validation_items')
    .select(
      'id, requisicao_codigo, link_contrato, tipo_documento, status',
    )
    .eq('batch_id', batchId)
    .is('tipo_documento', null)
    .neq('status', 'erro')
    .order('created_at', { ascending: true })

  for (const item of (pendingExtraction ?? []) as Array<
    Pick<ItemRow, 'id' | 'requisicao_codigo' | 'link_contrato'>
  >) {
    try {
      const extraction = await extractContract(item.link_contrato)
      const normalized = extraction.normalized
      const payments = normalized.valores_pagamentos

      const { error: updateErr } = await db
        .from('contract_validation_items')
        .update({
          tipo_documento: normalized.tipo_documento,
          data_baile: extraction.raw.data_baile || null,
          extracted_fornecedor: normalized.fornecedor,
          extracted_cpf_cnpj: normalized.cpf_cnpj,
          extracted_banco: extraction.raw.favorecido?.banco || null,
          extracted_agencia: extraction.raw.favorecido?.agencia || null,
          extracted_conta: normalized.conta,
          extracted_valor_contrato: normalized.valor_contrato,
          extracted_pagamentos: payments,
          assinatura_contratante: normalized.assinatura_contratante,
          assinatura_contratado: normalized.assinatura_contratado,
          assinatura_digital: extraction.raw.assinatura_digital_detectada || null,
          raw_extraction: extraction.raw,
          ai_credits: extraction.creditsUsed,
        })
        .eq('id', item.id)

      if (updateErr) throw updateErr

      result.extracted += 1
      result.credits_used += extraction.creditsUsed
    } catch (e) {
      const message =
        e instanceof LandingAIError || e instanceof LlmExtractionError
          ? e.message
          : `Extração falhou: ${(e as Error).message}`

      await db
        .from('contract_validation_items')
        .update({
          status: 'erro',
          status_resumo: message,
          status_motivos: [message],
          error_log: message,
          processed_at: new Date().toISOString(),
        })
        .eq('id', item.id)

      result.errors += 1
    }
  }

  // ── Phase 2: validate every item we have extraction for ────────────────────
  const { data: allItems } = await db
    .from('contract_validation_items')
    .select(
      'id, requisicao_codigo, fornecedor, favorecido, cpf_cnpj, conta, valor, link_contrato, tipo_documento, extracted_fornecedor, extracted_cpf_cnpj, extracted_conta, extracted_valor_contrato, extracted_pagamentos, assinatura_contratante, assinatura_contratado, status',
    )
    .eq('batch_id', batchId)

  const itemsForSum = ((allItems ?? []) as ItemRow[])
    .filter((i) => i.tipo_documento)
    .map((i) => ({
      requisicao_codigo: i.requisicao_codigo,
      tipo_documento: i.tipo_documento,
      extracted_valor_contrato: Number(i.extracted_valor_contrato) || 0,
    }))
  const somaGrupos = calcularSomaGrupos(itemsForSum)

  for (const item of (allItems ?? []) as ItemRow[]) {
    // Skip items already finalized in a previous run or that errored out.
    if (
      item.status === 'aprovada' ||
      item.status === 'reprovada' ||
      item.status === 'analise_especialista' ||
      item.status === 'erro'
    ) {
      continue
    }
    if (!item.tipo_documento) {
      // Extraction failed silently — already marked as erro above, or skipped.
      continue
    }

    const validation = analisarLinha(
      {
        fornecedor: item.fornecedor,
        favorecido: item.favorecido,
        cpf_cnpj: item.cpf_cnpj,
        conta: item.conta,
        valor: Number(item.valor) || null,
      },
      {
        tipo_documento: item.tipo_documento,
        fornecedor: item.extracted_fornecedor,
        cpf_cnpj: item.extracted_cpf_cnpj,
        conta: item.extracted_conta,
        valor_contrato: Number(item.extracted_valor_contrato) || null,
        valores_pagamentos: item.extracted_pagamentos ?? [],
        assinatura_contratante: item.assinatura_contratante,
        assinatura_contratado: item.assinatura_contratado,
      },
      {
        somaDoGrupo:
          somaGrupos.get(chaveGrupoSoma(item.requisicao_codigo, item.tipo_documento)) ?? 0,
      },
    )

    await db
      .from('contract_validation_items')
      .update({
        status: validation.status,
        status_motivos: validation.motivos,
        status_resumo: validation.resumo,
        processed_at: new Date().toISOString(),
      })
      .eq('id', item.id)

    result.validated += 1
  }

  // ── Phase 3: roll up batch aggregates and finalize ─────────────────────────
  const { data: counters } = await db
    .from('contract_validation_items')
    .select('status, ai_credits')
    .eq('batch_id', batchId)

  let approved = 0
  let reproved = 0
  let failed = 0
  let specialist = 0
  let totalCredits = 0
  let stillPending = 0
  for (const c of (counters ?? []) as Array<{ status: string; ai_credits: number | string }>) {
    if (c.status === 'aprovada') approved += 1
    else if (c.status === 'reprovada') reproved += 1
    else if (c.status === 'erro') failed += 1
    else if (c.status === 'analise_especialista') specialist += 1
    else stillPending += 1
    totalCredits += Number(c.ai_credits) || 0
  }

  const finalStatus: BatchRow['status'] = stillPending > 0 ? 'processing' : 'completed'

  await db
    .from('contract_validation_batches')
    .update({
      status: finalStatus,
      items_approved: approved,
      items_reproved: reproved,
      items_failed: failed,
      items_specialist: specialist,
      ai_credits_used: totalCredits,
    })
    .eq('id', batchId)

  result.status = finalStatus
  return result
}
