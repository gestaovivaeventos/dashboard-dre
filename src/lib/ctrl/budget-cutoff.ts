import { dayKeyBR } from "@/lib/ctrl/datetime";

// Virada única de meio de ano: o consumo/realizado de orçamento de 2026 passa a
// considerar a DATA DE VENCIMENTO (due_date), não a data de lançamento. A
// planilha-base cobre o realizado até 11/07/2026; ocorrências com vencimento a
// partir de 12/07/2026 — inclusive parcelas e recorrências já lançadas —
// continuam descontando do orçamento. Sem due_date, cai pra data de criação.
const BUDGET_IMPORT_BASELINE_YEAR = 2026;
const BUDGET_IMPORT_BASELINE_DUE_START = "2026-07-12";

/**
 * Janela [startDate, endDate) do ano, como datas puras (YYYY-MM-DD).
 *
 * `throughMonth` (1–12) fecha a janela no fim daquele mês em vez de no fim do
 * ano — é o que sustenta a visão "Até o mês atual" da tela de Orçamento (só
 * conta o realizado/pendente com vencimento de janeiro até o mês corrente).
 * Omitido ou 12 → ano inteiro (comportamento padrão).
 */
export function getBudgetWindowDates(year: number, throughMonth?: number) {
  const startDate =
    year === BUDGET_IMPORT_BASELINE_YEAR
      ? BUDGET_IMPORT_BASELINE_DUE_START
      : `${year}-01-01`;
  const endDate =
    throughMonth != null && throughMonth < 12
      ? `${year}-${String(throughMonth + 1).padStart(2, "0")}-01`
      : `${year + 1}-01-01`;
  return { startDate, endDate };
}

/**
 * Uma ocorrência (requisição / parcela / recorrência) conta para o orçamento do
 * ano se o VENCIMENTO cai na janela [startDate, endDate). Sem vencimento, usa a
 * data de criação como fallback — o dia da criação é contado no fuso de
 * Brasília (fatiar o ISO daria o dia em UTC e jogaria o que foi criado à noite
 * para o dia seguinte, virando o ano do orçamento em 31/12). Datas ISO
 * (YYYY-MM-DD) comparam lexicograficamente = cronologicamente.
 *
 * `throughMonth` fecha a janela no fim do mês informado (visão "Até o mês
 * atual"); omitido = ano inteiro.
 */
export function countsTowardBudget(
  row: { due_date: string | null; created_at: string },
  year: number,
  throughMonth?: number,
): boolean {
  const { startDate, endDate } = getBudgetWindowDates(year, throughMonth);
  const eff = row.due_date ?? dayKeyBR(row.created_at);
  return eff >= startDate && eff < endDate;
}
