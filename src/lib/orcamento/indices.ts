// Índices de correção do módulo Orçamento — tipos, catálogo e helpers.
// Módulo "puro" (sem "use server"): pode ser importado por client e server.

export type IndiceKey = "ipca" | "igpm" | "salario_minimo";

export type IndiceUnit = "percent" | "brl";

export interface IndiceMeta {
  key: IndiceKey;
  label: string;
  unit: IndiceUnit;
}

// Conjunto fixo de índices, na ordem de exibição.
export const INDICES: readonly IndiceMeta[] = [
  { key: "ipca", label: "IPCA", unit: "percent" },
  { key: "igpm", label: "IGP-M", unit: "percent" },
  { key: "salario_minimo", label: "Salário mínimo", unit: "brl" },
] as const;

/** Um ano de índices (linha da tabela orcamento_indices). */
export interface IndiceYear {
  year: number;
  ipca: number | null;
  igpm: number | null;
  salario_minimo: number | null;
}

/**
 * Converte texto pt-BR em número. Aceita "4,5", "1.518,00", "1518.00", "1518".
 * Vazio → null. Inválido → NaN (o chamador valida).
 */
export function parseBrNumber(input: string): number | null {
  const t = input.trim();
  if (!t) return null;
  let cleaned = t.replace(/[R$\s%]/g, "");
  if (cleaned.includes(",")) {
    // vírgula é o separador decimal; ponto é separador de milhar.
    cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  }
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

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
  if (value == null) return "";
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
    useGrouping: false,
  });
}
