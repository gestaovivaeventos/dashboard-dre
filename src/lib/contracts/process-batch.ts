// Drains a single contract validation batch:
//   1) extract data for every item missing tipo_documento (LandingAI + Gemini)
//   2) compute soma_grupos over all extracted items
//   3) run analisarLinha for every item, saving status + motivos
//   4) update batch counters and transition to "completed" (or "failed")
//
// Designed to be resumable: if step 1 partially succeeds (timeout/error),
// the next run picks up where it left off because extraction is keyed off
// "tipo_documento IS NULL".

import { extractContract, mergeCpfCnpj } from './extract'
import { LandingAIError } from './landingai'
import { LlmExtractionError } from './llm'
import { analisarRequisicao, isFeeCerimonial, type RequisitionDocument } from './validate'
import type { ContractExtraction, ValidationStatus } from './types'
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
  extracted_vencimentos: string[] | null
  // JSON cru da extração (contém cpf_cnpj_encontrados — todos os CPF/CNPJ do
  // documento). Reidratado para reconstruir cpf_cnpj_todos na validação.
  raw_extraction: ContractExtraction | null
  assinatura_contratante: string | null
  assinatura_contratado: string | null
  status: ValidationStatus | 'pending' | 'processing'
  error_log: string | null
  data_evento: string | null
  modulo: number | null
  valor_total_contrato: number | string | null
  historico_rps_pagas: number | string | null
  data_pagamento_prevista: string | null
  data_contrato: string | null
  fundo: string | null
  numero_contrato: string | null
}

export interface ProcessBatchResult {
  batch_id: string
  extracted: number
  validated: number
  errors: number
  credits_used: number
  status: BatchRow['status']
}

// Normalização para o casamento do BV (saldo do contrato).
function normBV(s: string | null | undefined): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Chave de casamento do BV: fundo + CNPJ (só dígitos). A base de RPs pagas não
// traz número de contrato, então o "contrato" é identificado por fundo+fornecedor
// (decisão 2026-06-09). Retorna null se faltar fundo ou CNPJ.
function bvKey(
  fundo: string | null | undefined,
  cnpj: string | null | undefined,
): string | null {
  const f = normBV(fundo)
  const c = String(cnpj ?? '').replace(/\D/g, '')
  if (!f || !c) return null
  return `${f}|${c}`
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
  options: { timeBudgetMs?: number; maxItems?: number } = {},
): Promise<ProcessBatchResult> {
  const result: ProcessBatchResult = {
    batch_id: batchId,
    extracted: 0,
    validated: 0,
    errors: 0,
    credits_used: 0,
    status: 'processing',
  }

  // Default to 250s, leaving a 50s safety margin under Vercel's 300s ceiling.
  const startedAt = Date.now()
  const timeBudgetMs = options.timeBudgetMs ?? 250_000
  const maxItems = options.maxItems
  const timeIsUp = () => Date.now() - startedAt > timeBudgetMs

  console.log(`[contracts] processBatch start batch=${batchId} budget=${timeBudgetMs}ms maxItems=${maxItems ?? 'unlimited'}`)

  // ── Phase 0: atalho FEE/Cerimonial ─────────────────────────────────────────
  // Requisições cuja descrição contém FEE/Cerimonial não são lidas: vão direto
  // para aprovação manual (análise especialista), sem gastar crédito de IA.
  // A decisão é por requisição (a descrição é da requisição, não do documento).
  const { data: descRows } = await db
    .from('contract_validation_items')
    .select('requisicao_codigo, descricao')
    .eq('batch_id', batchId)

  const feeReqs = new Set<string>()
  for (const r of (descRows ?? []) as Array<{ requisicao_codigo: string; descricao: string | null }>) {
    if (isFeeCerimonial(r.descricao)) feeReqs.add(r.requisicao_codigo)
  }
  console.log(`[contracts] phase0 FEE/Cerimonial reqs=${feeReqs.size}`)

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

  const pendingList = (pendingExtraction ?? []) as Array<
    Pick<ItemRow, 'id' | 'requisicao_codigo' | 'link_contrato'>
  >
  console.log(`[contracts] phase1 found ${pendingList.length} items needing extraction`)

  for (const item of pendingList) {
    if (timeIsUp()) {
      console.log('[contracts] time budget exhausted, breaking extraction loop')
      break
    }

    // FEE/Cerimonial → aprovação manual, sem leitura (não chama o LLM).
    if (feeReqs.has(item.requisicao_codigo)) {
      await db
        .from('contract_validation_items')
        .update({
          status: 'analise_especialista',
          status_resumo: 'FEE/Cerimonial — aprovação manual (leitura dispensada)',
          status_motivos: ['Requisição de FEE/Cerimonial: não exige leitura de documento'],
          processed_at: new Date().toISOString(),
        })
        .eq('id', item.id)
      continue
    }
    if (maxItems !== undefined && result.extracted + result.errors >= maxItems) {
      console.log(`[contracts] maxItems=${maxItems} reached, breaking extraction loop`)
      break
    }
    const itemStart = Date.now()
    console.log(`[contracts] extracting req=${item.requisicao_codigo} link=${item.link_contrato.slice(0, 80)}`)
    try {
      const extraction = await extractContract(item.link_contrato)
      console.log(`[contracts] extraction OK req=${item.requisicao_codigo} took=${Date.now() - itemStart}ms credits=${extraction.creditsUsed}`)
      const normalized = extraction.normalized
      const payments = normalized.valores_pagamentos

      const { error: updateErr } = await db
        .from('contract_validation_items')
        .update({
          tipo_documento: normalized.tipo_documento,
          data_baile: extraction.raw.data_baile || null,
          data_contrato: normalized.data_contrato || null,
          extracted_fornecedor: normalized.fornecedor,
          extracted_cpf_cnpj: normalized.cpf_cnpj,
          extracted_banco: extraction.raw.favorecido?.banco || null,
          extracted_agencia: extraction.raw.favorecido?.agencia || null,
          extracted_conta: normalized.conta,
          extracted_valor_contrato: normalized.valor_contrato,
          extracted_pagamentos: payments,
          extracted_vencimentos: normalized.datas_vencimento ?? [],
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

      console.log(`[contracts] extraction FAIL req=${item.requisicao_codigo} took=${Date.now() - itemStart}ms err=${message}`)

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

  // ── Phase 2: validate by REQUISIÇÃO (cross-document rules) ─────────────────
  // Unit of validation = requisicao_codigo. We group all items of a req and
  // apply R1, R6, R9, R10, R14, R15, R16; the same verdict is then mirrored
  // onto every item of that group so the existing UI/queries keep working.
  const { data: allItems } = await db
    .from('contract_validation_items')
    .select(
      'id, requisicao_codigo, fornecedor, favorecido, cpf_cnpj, conta, valor, link_contrato, tipo_documento, extracted_fornecedor, extracted_cpf_cnpj, extracted_conta, extracted_valor_contrato, extracted_pagamentos, extracted_vencimentos, assinatura_contratante, assinatura_contratado, status, error_log, data_evento, modulo, valor_total_contrato, historico_rps_pagas, data_pagamento_prevista, data_contrato, fundo, numero_contrato, raw_extraction',
    )
    .eq('batch_id', batchId)

  const items = (allItems ?? []) as ItemRow[]

  // Group by requisicao_codigo, also tracking which items errored on extraction.
  const groups = new Map<string, ItemRow[]>()
  for (const item of items) {
    const arr = groups.get(item.requisicao_codigo) ?? []
    arr.push(item)
    groups.set(item.requisicao_codigo, arr)
  }

  console.log(`[contracts] phase2 evaluating ${groups.size} requisitions (${items.length} items)`)

  // BV (saldo do contrato): carrega a base de RPs pagas uma vez e soma o já-pago
  // por (fundo + CNPJ + número do contrato), normalizado. O valor entra na RP
  // como historico_rps_pagas e a regra pura (analisarRequisicao) faz a conta.
  const paidByKey = new Map<string, number>()
  {
    const { data: paidRows } = await db
      .from('contract_paid_history')
      .select('fundo, cpf_cnpj, valor_pago')
    for (const r of (paidRows ?? []) as Array<{ fundo: string | null; cpf_cnpj: string | null; valor_pago: number | string | null }>) {
      const key = bvKey(r.fundo, r.cpf_cnpj)
      if (!key) continue
      paidByKey.set(key, (paidByKey.get(key) ?? 0) + (Number(r.valor_pago) || 0))
    }
    console.log(`[contracts] BV paid-history rows aggregated into ${paidByKey.size} contracts`)
  }

  // Materialize entries so we don't iterate Map directly (target=es5 limitation).
  const groupEntries: Array<[string, ItemRow[]]> = []
  groups.forEach((v, k) => groupEntries.push([k, v]))

  for (const [reqCodigo, groupItems] of groupEntries) {
    if (timeIsUp()) {
      console.log('[contracts] time budget exhausted in phase2')
      break
    }

    // Skip a requisition if every item is already finalized AND we don't need
    // to re-evaluate. We always re-evaluate when there is fresh data (i.e.,
    // at least one item flipped extraction state since last run).
    const anyPendingExtraction = groupItems.some(
      (i) => !i.tipo_documento && i.status !== 'erro',
    )
    if (anyPendingExtraction) continue

    // Build the documents list. The first row carries the requisition data
    // (req.fornecedor, valor, cpf_cnpj, conta) — by construction it's the same
    // across all items of the same req (they all come from the same XLSX row
    // group), so picking the first is safe.
    const first = groupItems[0]
    const documentos: RequisitionDocument[] = groupItems.map((i) => ({
      tipo_documento: i.tipo_documento,
      fornecedor: i.extracted_fornecedor,
      cpf_cnpj: i.extracted_cpf_cnpj,
      // Todos os CPF/CNPJ do documento, reconstruídos do raw_extraction salvo.
      // Itens antigos sem cpf_cnpj_encontrados caem só no principal (retrocompat).
      cpf_cnpj_todos: mergeCpfCnpj(i.extracted_cpf_cnpj, i.raw_extraction?.cpf_cnpj_encontrados),
      conta: i.extracted_conta,
      valor_contrato: Number(i.extracted_valor_contrato) || null,
      valores_pagamentos: i.extracted_pagamentos ?? [],
      assinatura_contratante: i.assinatura_contratante,
      assinatura_contratado: i.assinatura_contratado,
      data_contrato: i.data_contrato,
      datas_vencimento: i.extracted_vencimentos ?? [],
      extraction_failed: i.status === 'erro',
    }))

    const validation = analisarRequisicao({
      requisicao_codigo: reqCodigo,
      req: {
        fornecedor: first.fornecedor,
        favorecido: first.favorecido,
        cpf_cnpj: first.cpf_cnpj,
        conta: first.conta,
        valor: Number(first.valor) || null,
        data_evento: first.data_evento,
        modulo: first.modulo,
        valor_total_contrato: Number(first.valor_total_contrato) || null,
        // BV: soma calculada da base de pagas quando casável (fundo+CNPJ+contrato);
        // senão, cai no valor manual da planilha (se houver).
        historico_rps_pagas: (() => {
          const k = bvKey(first.fundo, first.cpf_cnpj)
          if (k) return paidByKey.get(k) ?? 0
          return Number(first.historico_rps_pagas) || null
        })(),
        data_pagamento_prevista: first.data_pagamento_prevista,
        fundo: first.fundo,
        numero_contrato: first.numero_contrato,
      },
      documentos,
    })

    // Mirror the verdict to every item in the group so existing queries
    // (status filter, counters, exports) keep working unchanged.
    const ids = groupItems.map((i) => i.id)
    await db
      .from('contract_validation_items')
      .update({
        status: validation.status,
        // Alertas (ex.: cronograma fora da janela) entram junto dos motivos com
        // prefixo ⚠️ — são informativos e não mudam o status.
        status_motivos: [
          ...validation.motivos,
          ...(validation.alertas ?? []).map((a) => `⚠️ ${a}`),
        ],
        status_resumo: validation.resumo,
        processed_at: new Date().toISOString(),
      })
      .in('id', ids)

    result.validated += groupItems.length
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
  let verificarSaldo = 0
  let totalCredits = 0
  let stillPending = 0
  for (const c of (counters ?? []) as Array<{ status: string; ai_credits: number | string }>) {
    // "aprovada_ressalva" conta como aprovada no resumo do lote; a ressalva
    // fica visível no status/resumo de cada item ao abrir o lote.
    if (c.status === 'aprovada' || c.status === 'aprovada_ressalva') approved += 1
    else if (c.status === 'reprovada') reproved += 1
    else if (c.status === 'erro') failed += 1
    else if (c.status === 'analise_especialista') specialist += 1
    else if (c.status === 'verificar_saldo') verificarSaldo += 1
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
      items_verificar_saldo: verificarSaldo,
      ai_credits_used: totalCredits,
    })
    .eq('id', batchId)

  result.status = finalStatus
  return result
}
