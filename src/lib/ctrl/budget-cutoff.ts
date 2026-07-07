const BUDGET_IMPORT_BASELINE_YEAR = 2026;
const BUDGET_IMPORT_BASELINE_REQUEST_START = "2026-07-01";

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
