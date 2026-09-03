// Métodos de construção do orçamento ("produtores"). Cada categoria de despesa
// de uma empresa é orçada por UM método. Módulo puro (client + server).

export type OrcamentoMetodo =
  | "pessoal"
  | "media"
  | "valor_fixo"
  | "planejamento_socios"
  | "viagens_ve"
  | "marketing_ve"
  | "endomarketing_ve";

export interface MetodoMeta {
  key: OrcamentoMetodo;
  label: string;
  /** Métodos específicos de VE (Viva Eventos) — telas construídas depois. */
  ve: boolean;
}

export const METODOS: readonly MetodoMeta[] = [
  { key: "pessoal", label: "Despesas com pessoal", ve: false },
  { key: "media", label: "Média com correção de índices", ve: false },
  { key: "valor_fixo", label: "Valor fixo com correção de índices", ve: false },
  { key: "planejamento_socios", label: "Planejamento dos gestores", ve: false },
  { key: "viagens_ve", label: "Viagens (VE)", ve: true },
  { key: "marketing_ve", label: "Campanhas de marketing (VE)", ve: true },
  { key: "endomarketing_ve", label: "Endomarketing (VE)", ve: true },
] as const;

const METODO_KEYS = new Set<string>(METODOS.map((m) => m.key));

export function isOrcamentoMetodo(value: unknown): value is OrcamentoMetodo {
  return typeof value === "string" && METODO_KEYS.has(value);
}

export function metodoLabel(key: OrcamentoMetodo): string {
  return METODOS.find((m) => m.key === key)?.label ?? key;
}
