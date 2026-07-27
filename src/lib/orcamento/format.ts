// Helpers de número/moeda pt-BR compartilhados pelo módulo Orçamento.

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

/** Formata um valor em reais (R$). null → travessão. */
export function formatBRL(value: number | null): string {
  if (value == null) return "—";
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Valor "cru" para input de edição (sem símbolo, decimal com vírgula, sem milhar). */
export function numberToInput(value: number | null): string {
  if (value == null) return "";
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
    useGrouping: false,
  });
}
