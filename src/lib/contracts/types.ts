// Contract validation domain types. Mirrors the GCP Python script
// (main.py / get_contract_data_with_gemini) so the same prompts and rules
// continue to work without behavioural changes.

export const DOC_TYPES = [
  'Contrato / Aditivo Contratual',
  'Nota Fiscal / Fatura',
  'Recibo / Declaração de Quitação',
  'Boleto',
  'Atas, Orçamentos, Ordens de Serviço',
  'Comprovantes de pgto para reembolso',
  'Documentos de Suporte / Evidências',
] as const

export type DocumentType = (typeof DOC_TYPES)[number]

export const DEFAULT_DOC_TYPE: DocumentType = 'Contrato / Aditivo Contratual'

// Shape of the structured JSON returned by the LLM extraction step.
// Matches the prompt in get_contract_data_with_gemini() exactly.
export interface ContractExtraction {
  tipo_documento: DocumentType | string
  data_baile: string
  // Data de assinatura/emissão do documento (DD/MM/AAAA). Usada no cálculo de
  // antecedência do cronograma por módulo (etapa futura). Extração híbrida.
  data_contrato?: string
  favorecido: {
    nome: string
    cpf_cnpj: string
    banco: string
    agencia: string
    conta: string
  }
  valor_contrato: string
  // pagamentoX_obs: registra a porcentagem original quando a parcela veio como
  // "% do contrato" (o valor calculado fica em pagamentoX_valor).
  pagamento1_data_vencimento: string
  pagamento1_valor: string
  pagamento1_obs?: string
  pagamento2_data_vencimento: string
  pagamento2_valor: string
  pagamento2_obs?: string
  pagamento3_data_vencimento: string
  pagamento3_valor: string
  pagamento3_obs?: string
  pagamento4_data_vencimento: string
  pagamento4_valor: string
  pagamento4_obs?: string
  pagamento5_data_vencimento?: string
  pagamento5_valor?: string
  pagamento5_obs?: string
  pagamento6_data_vencimento?: string
  pagamento6_valor?: string
  pagamento6_obs?: string
  pagamento7_data_vencimento?: string
  pagamento7_valor?: string
  pagamento7_obs?: string
  pagamento8_data_vencimento?: string
  pagamento8_valor?: string
  pagamento8_obs?: string
  pagamento9_data_vencimento?: string
  pagamento9_valor?: string
  pagamento9_obs?: string
  pagamento10_data_vencimento?: string
  pagamento10_valor?: string
  pagamento10_obs?: string
  assinatura_contratante: 'Sim' | 'Não' | string
  assinatura_contratado: 'Sim' | 'Não' | string
  assinatura_digital_detectada: 'Sim' | 'Não' | string
}

// Input for validation: the requisition row (from XLSX upload) plus the
// extracted contract data. Field names match the dashboard-dre DB columns,
// not the legacy Portuguese column headers from the GCP spreadsheet.
export interface RequisitionInput {
  fornecedor: string | null
  favorecido: string | null
  cpf_cnpj: string | null
  conta: string | null
  valor: number | null
}

export interface ExtractedContract {
  tipo_documento: string | null
  fornecedor: string | null
  cpf_cnpj: string | null
  conta: string | null
  valor_contrato: number | null
  valores_pagamentos: number[]
  assinatura_contratante: string | null
  assinatura_contratado: string | null
  // Data de assinatura/emissão (DD/MM/AAAA). Disponível para regras futuras
  // (cronograma). Hoje não é consumida pela validação.
  data_contrato?: string | null
}

export type ValidationStatus =
  | 'aprovada'
  | 'aprovada_ressalva'
  | 'reprovada'
  | 'analise_especialista'
  | 'verificar_saldo'
  | 'erro'

export interface ValidationResult {
  status: ValidationStatus
  motivos: string[]
  // Human-readable summary matching the legacy GCP string format.
  // Stored in contract_validation_items.status_resumo.
  resumo: string
}
