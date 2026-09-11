// Tipos do módulo VB (Viva Bank). Espelham as tabelas vb_* da migration
// 20260909120000_vb_module.sql. O `types.ts` do Supabase é escrito à mão neste
// projeto (não há Database gerado), então as linhas das tabelas vivem aqui,
// junto do módulo.

export type VbEntryKind = "entrada" | "saida" | "rendimento";
export type VbRateBasis = "mensal" | "periodo" | "ajuste" | "cdi";
export type VbEntryStatus = "pendente" | "aprovado";
export type VbBatchStatus = "pendente" | "aprovado" | "descartado";

export type VbEntryFlag =
  | "data_invalida"
  | "valor_invalido"
  | "fora_de_ordem"
  | "conferir"
  | "sem_descricao"
  | "periodo_inferido"
  | "dias_divergentes"
  | "entrada_e_saida";

/** Flags que impedem a aprovação do lote (mesma lista da função SQL vb_approve_import_batch). */
export const VB_BLOCKING_FLAGS: ReadonlySet<VbEntryFlag> = new Set<VbEntryFlag>([
  "data_invalida",
  "valor_invalido",
]);

export const VB_FLAG_LABELS: Record<VbEntryFlag, string> = {
  data_invalida: "Data inválida",
  valor_invalido: "Valor inválido",
  fora_de_ordem: "Data fora de ordem",
  conferir: "Marcado para conferir",
  sem_descricao: "Sem descrição",
  periodo_inferido: "Período do rendimento inferido",
  dias_divergentes: "Dias do período diferentes do informado",
  entrada_e_saida: "Entrada e saída no mesmo lançamento",
};

export function isBlockingFlag(flag: string): boolean {
  return VB_BLOCKING_FLAGS.has(flag as VbEntryFlag);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Id vindo da URL ou do cliente: evita 22P02 do Postgres virar erro genérico. */
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** Diferença planilha × sistema tolerada como arredondamento (R$ por credor). */
export const VB_BALANCE_TOLERANCE = 1;

export const VB_KIND_LABELS: Record<VbEntryKind, string> = {
  entrada: "Entrada",
  saida: "Saída",
  rendimento: "Rendimento",
};

export interface VbCreditor {
  id: string;
  name: string;
  active: boolean;
  user_id: string | null;
  source_sheet: string | null;
  sort_order: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface VbEntry {
  id: string;
  creditor_id: string;
  /** 'YYYY-MM-DD' */
  entry_date: string;
  kind: VbEntryKind;
  /** Com sinal: entrada > 0, saída < 0, rendimento ±. */
  amount: number;
  description: string | null;
  period_start: string | null;
  period_end: string | null;
  days: number | null;
  /** Fração (0.0335 = 3,35%). */
  rate: number | null;
  rate_basis: VbRateBasis | null;
  status: VbEntryStatus;
  import_batch_id: string | null;
  source_row: number | null;
  /** Lançamentos gravados na mesma operação (Novo lançamento) compartilham o id; importados: null. */
  group_id: string | null;
  /** SALDO que a planilha mostrava nesta linha (só importados). */
  sheet_balance: number | null;
  sort_order: number;
  flags: VbEntryFlag[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Linha de vb_entries pronta para o insert (id e carimbos vêm do banco). */
export type VbEntryInsert = Omit<VbEntry, "id" | "created_at" | "updated_at">;

export interface VbImportCreditorSummary {
  creditorId: string;
  sheetName: string;
  name: string;
  hidden: boolean;
  entries: number;
  skippedRows: number;
  sheetFinalBalance: number | null;
  computedFinalBalance: number;
  diff: number | null;
  blockingCount: number;
  warningCount: number;
}

export interface VbImportSummary {
  creditors: VbImportCreditorSummary[];
  skippedSheets: Array<{ sheetName: string; reason: "ja_importado" }>;
  emptySheets: string[];
  ignoredSheets: string[];
  /** Ids dos credores que ESTE lote criou — descartar só apaga esses, nunca um credor que já existia. */
  createdCreditorIds: string[];
}

export interface VbImportBatch {
  id: string;
  file_name: string;
  status: VbBatchStatus;
  summary: VbImportSummary;
  created_by: string | null;
  created_at: string;
  approved_by: string | null;
  approved_at: string | null;
  discarded_at: string | null;
}

/** Retorno padrão dos server actions do módulo. */
export type VbActionResult<T extends object = Record<never, never>> =
  | ({ ok: true } & T)
  | { error: string };

export const EMPTY_IMPORT_SUMMARY: VbImportSummary = {
  creditors: [],
  skippedSheets: [],
  emptySheets: [],
  ignoredSheets: [],
  createdCreditorIds: [],
};

/** O que o formulário de lançamento precisa saber de um credor. */
export type VbCreditorOption = Pick<VbCreditor, "id" | "name" | "active">;

/** Pagamento da ABD Holding como está hoje em financial_entries. */
export interface VbOmieMovement {
  /** financial_entries.id (muda se o sync recriar a linha; a chave é omie_id). */
  id: string;
  omie_id: string;
  /** 'YYYY-MM-DD' */
  payment_date: string;
  supplier_customer: string | null;
  description: string | null;
  category_code: string | null;
  category_name: string | null;
  /** Sempre positivo; o tipo (despesa) dá a direção. */
  value: number;
  document_number: string | null;
}

export type VbOmieTriageStatus = "vinculado" | "descartado";

export interface VbOmieLinkedEntry {
  id: string;
  creditor_id: string;
  creditor_name: string;
  kind: VbEntryKind;
  amount: number;
  sort_order: number;
}

/** Decisão gravada + retrato + o que existe hoje (para os avisos). */
export interface VbOmieTriageRow {
  id: string;
  omie_id: string;
  status: VbOmieTriageStatus;
  group_id: string | null;
  payment_date: string;
  supplier_customer: string | null;
  description: string | null;
  category_code: string | null;
  category_name: string | null;
  value: number;
  decided_by_name: string | null;
  decided_at: string;
  /** Movimento como está hoje na Omie; null = não consta mais. */
  live: { value: number } | null;
  /** Só vinculado: lançamentos do grupo, em sort_order. */
  entries: VbOmieLinkedEntry[];
}

export interface VbOmieSyncStatus {
  /** Fim do último sync com sucesso (ISO) ou null. */
  finishedAt: string | null;
  /** Há um sync em andamento (iniciado há menos de VB_OMIE_SYNC_RUNNING_WINDOW_MS). */
  running: boolean;
}

/** Valores iniciais do diálogo de lançamento (valor como string BR, ex.: "330000" ou "1234,5"). */
export interface VbEntryPrefill {
  date: string;
  description: string;
  lines: Array<{ creditorId: string; kind: VbEntryKind; amount: string }>;
}
