// Índices de correção do módulo Orçamento — tipos, catálogo e helpers.
// Módulo "puro" (sem "use server"): pode ser importado por client e server.

import { numberToInput, parseBrNumber } from "@/lib/orcamento/format";

// Reexporta os helpers de número para quem já importa daqui.
export { parseBrNumber };

export type IndiceKey =
  | "ipca"
  | "igpm"
  | "salario_minimo"
  | "ist"
  | "aneel"
  | "inpc"
  | "ans";

export type IndiceUnit = "percent" | "brl";

export interface IndiceMeta {
  key: IndiceKey;
  label: string;
  unit: IndiceUnit;
}

// Conjunto fixo de índices, na ordem de exibição. Todos percentuais, exceto o
// salário mínimo (valor em R$).
export const INDICES: readonly IndiceMeta[] = [
  { key: "ipca", label: "IPCA", unit: "percent" },
  { key: "igpm", label: "IGP-M", unit: "percent" },
  { key: "salario_minimo", label: "Salário mínimo", unit: "brl" },
  { key: "ist", label: "IST", unit: "percent" },
  { key: "aneel", label: "Aneel", unit: "percent" },
  { key: "inpc", label: "INPC", unit: "percent" },
  { key: "ans", label: "ANS", unit: "percent" },
] as const;

/** Um ano de índices (linha da tabela orcamento_indices). */
export interface IndiceYear {
  year: number;
  ipca: number | null;
  igpm: number | null;
  salario_minimo: number | null;
  ist: number | null;
  aneel: number | null;
  inpc: number | null;
  ans: number | null;
}

/** Valores editáveis de um ano, indexados pela chave do índice. */
export type IndiceValues = Record<IndiceKey, number | null>;

/** Formata um valor de índice conforme sua unidade, para exibição. */
export function formatIndice(value: number | null, unit: IndiceUnit): string {
  if (value == null) return "—";
  if (unit === "brl") {
    return value.toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });
  }
  // percentual
  return `${value.toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}%`;
}

/** Valor "cru" para preencher um input de edição (sem símbolo, decimal com vírgula). */
export function indiceToInput(value: number | null): string {
  return numberToInput(value);
}
