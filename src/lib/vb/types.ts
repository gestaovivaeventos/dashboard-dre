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
  conferir: "Marcado 'CONFERIR' na planilha",
  sem_descricao: "Sem descrição",
  periodo_inferido: "Período do rendimento inferido",
  dias_divergentes: "Dias diferentes da planilha",
  entrada_e_saida: "Entrada e saída na mesma linha",
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
  /** SALDO que a planilha mostrava nesta linha (só importados). */
  sheet_balance: number | null;
  sort_order: number;
  flags: VbEntryFlag[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

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
