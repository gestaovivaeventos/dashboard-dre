// Orchestrates the contract extraction pipeline:
//   PDF URL -> LandingAI ADE (OCR + markdown) -> Gemini (structured JSON)
// Returns both the raw extraction (for storage in raw_extraction jsonb) and a
// normalized ExtractedContract ready for the validation rules.

import { extractContractDataWithLlm } from './llm'
import { parseDocumentWithLandingAI } from './landingai'
import { parseValor } from './parse-value'
import type { ContractExtraction, ExtractedContract } from './types'

export interface ContractExtractionResult {
  raw: ContractExtraction
  normalized: ExtractedContract
  creditsUsed: number
  pageCount: number
}

export async function extractContract(documentUrl: string): Promise<ContractExtractionResult> {
  const ocr = await parseDocumentWithLandingAI(documentUrl)
  const raw = await extractContractDataWithLlm(ocr.markdown)

  return {
    raw,
    normalized: normalizeExtraction(raw),
    creditsUsed: ocr.creditsUsed,
    pageCount: ocr.pageCount,
  }
}

/**
 * Junta o CPF/CNPJ do favorecido + todos os encontrados no documento,
 * deduplicando por dígitos (mantém a primeira grafia vista). A validação de
 * CPF/CNPJ casa contra esta lista, então o favorecido da requisição pode ser um
 * documento diferente do contratante desde que apareça no contrato.
 *
 * Compartilhado entre a extração (normalizeExtraction) e a reidratação a partir
 * do `raw_extraction` salvo no banco (process-batch).
 */
export function mergeCpfCnpj(
  principal: string | null | undefined,
  encontrados: string[] | null | undefined,
): string[] {
  const resultado: string[] = []
  const vistos = new Set<string>()
  const lista = Array.isArray(encontrados) ? encontrados : []
  for (const candidato of [principal, ...lista]) {
    const texto = (candidato ?? '').toString().trim()
    if (!texto) continue
    const digitos = texto.replace(/\D/g, '')
    const chave = digitos || texto.toLowerCase()
    if (vistos.has(chave)) continue
    vistos.add(chave)
    resultado.push(texto)
  }
  return resultado
}

export function normalizeExtraction(raw: ContractExtraction): ExtractedContract {
  // The Gemini prompt asks for up to 10 installments. We capture all of them
  // so the partial-payment detection in analisarRequisicao can match any.
  const valoresPagamentos = [
    raw.pagamento1_valor,
    raw.pagamento2_valor,
    raw.pagamento3_valor,
    raw.pagamento4_valor,
    raw.pagamento5_valor,
    raw.pagamento6_valor,
    raw.pagamento7_valor,
    raw.pagamento8_valor,
    raw.pagamento9_valor,
    raw.pagamento10_valor,
  ]
    .map(parseValor)
    .filter((v) => v > 0)

  const datasVencimento = [
    raw.pagamento1_data_vencimento,
    raw.pagamento2_data_vencimento,
    raw.pagamento3_data_vencimento,
    raw.pagamento4_data_vencimento,
    raw.pagamento5_data_vencimento,
    raw.pagamento6_data_vencimento,
    raw.pagamento7_data_vencimento,
    raw.pagamento8_data_vencimento,
    raw.pagamento9_data_vencimento,
    raw.pagamento10_data_vencimento,
  ]
    .map((d) => (d ?? '').toString().trim())
    .filter((d) => d.length > 0)

  return {
    tipo_documento: (raw.tipo_documento ?? '').toString().trim() || null,
    fornecedor: (raw.favorecido?.nome ?? '').toString().trim() || null,
    cpf_cnpj: (raw.favorecido?.cpf_cnpj ?? '').toString().trim() || null,
    cpf_cnpj_todos: mergeCpfCnpj(raw.favorecido?.cpf_cnpj, raw.cpf_cnpj_encontrados),
    conta: (raw.favorecido?.conta ?? '').toString().trim() || null,
    valor_contrato: parseValor(raw.valor_contrato) || null,
    valores_pagamentos: valoresPagamentos,
    assinatura_contratante: (raw.assinatura_contratante ?? '').toString().trim() || null,
    assinatura_contratado: (raw.assinatura_contratado ?? '').toString().trim() || null,
    data_contrato: (raw.data_contrato ?? '').toString().trim() || null,
    datas_vencimento: datasVencimento,
  }
}
