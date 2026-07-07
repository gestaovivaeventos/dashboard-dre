const BUDGET_IMPORT_BASELINE_YEAR = 2026;
// Virada única de meio de ano: a planilha-base carrega o realizado até
// 06/07/2026; o realizado/saldo dinâmico conta só requisições criadas a partir
// de 07/07/2026 (00:00 no horário de Brasília, -03:00).
const BUDGET_IMPORT_BASELINE_REQUEST_START = "2026-07-07T00:00:00-03:00";

export function getBudgetRequestWindow(year: number) {
  const requestStartIso =
    year === BUDGET_IMPORT_BASELINE_YEAR
      ? BUDGET_IMPORT_BASELINE_REQUEST_START
      : `${year}-01-01`;

  return {
    requestStartIso,
    requestEndIso: `${year + 1}-01-01`,
  };
}
