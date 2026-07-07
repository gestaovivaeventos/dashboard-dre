// Virada única de meio de ano: o consumo/realizado de orçamento de 2026 passa a
// considerar a DATA DE VENCIMENTO (due_date), não a data de lançamento. A
// planilha-base cobre o realizado até 07/07/2026; ocorrências com vencimento a
// partir de 08/07/2026 — inclusive parcelas e recorrências já lançadas —
// continuam descontando do orçamento. Sem due_date, cai pra data de criação.
const BUDGET_IMPORT_BASELINE_YEAR = 2026;
const BUDGET_IMPORT_BASELINE_DUE_START = "2026-07-08";

/** Janela [startDate, endDate) do ano, como datas puras (YYYY-MM-DD). */
export function getBudgetWindowDates(year: number) {
  const startDate =
    year === BUDGET_IMPORT_BASELINE_YEAR
      ? BUDGET_IMPORT_BASELINE_DUE_START
      : `${year}-01-01`;
  return { startDate, endDate: `${year + 1}-01-01` };
}

/**
 * Uma ocorrência (requisição / parcela / recorrência) conta para o orçamento do
 * ano se o VENCIMENTO cai na janela [startDate, endDate). Sem vencimento, usa a
 * data de criação como fallback. Datas ISO (YYYY-MM-DD) comparam
 * lexicograficamente = cronologicamente.
 */
export function countsTowardBudget(
  row: { due_date: string | null; created_at: string },
  year: number,
): boolean {
  const { startDate, endDate } = getBudgetWindowDates(year);
  const eff = row.due_date ?? row.created_at.slice(0, 10);
  return eff >= startDate && eff < endDate;
}
