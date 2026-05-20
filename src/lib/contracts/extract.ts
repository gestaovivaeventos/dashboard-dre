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

export function normalizeExtraction(raw: ContractExtraction): ExtractedContract {
  const valoresPagamentos = [
    raw.pagamento1_valor,
    raw.pagamento2_valor,
    raw.pagamento3_valor,
    raw.pagamento4_valor,
  ]
    .map(parseValor)
    .filter((v) => v > 0)

  return {
    tipo_documento: (raw.tipo_documento ?? '').toString().trim() || null,
    fornecedor: (raw.favorecido?.nome ?? '').toString().trim() || null,
    cpf_cnpj: (raw.favorecido?.cpf_cnpj ?? '').toString().trim() || null,
    conta: (raw.favorecido?.conta ?? '').toString().trim() || null,
    valor_contrato: parseValor(raw.valor_contrato) || null,
    valores_pagamentos: valoresPagamentos,
    assinatura_contratante: (raw.assinatura_contratante ?? '').toString().trim() || null,
    assinatura_contratado: (raw.assinatura_contratado ?? '').toString().trim() || null,
  }
}
