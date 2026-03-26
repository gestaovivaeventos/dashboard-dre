import type { DashboardRange } from "@/lib/dashboard/dre";

export type KpiFormulaType = "percentage" | "value" | "ratio";

export interface KpiDefinition {
  id: string;
  name: string;
  description: string | null;
  formula_type: KpiFormulaType;
  numerator_account_codes: string[];
  denominator_account_codes: string[];
  multiply_by: number;
  sort_order: number;
  active: boolean;
}

export interface CompanyAmountRow {
  company_id: string;
  dre_account_id: string;
  amount: number;
}

export interface CompanyKpiValue {
  companyId: string;
  value: number;
}

export function evaluateKpiValue(
  kpi: KpiDefinition,
  accountValuesByCode: Map<string, number>,
) {
  const numeratorCodes = kpi.numerator_account_codes ?? [];
  const denominatorCodes = kpi.denominator_account_codes ?? [];

  const numerator = numeratorCodes.reduce((sum, code, index) => {
    const accountValue = accountValuesByCode.get(code) ?? 0;
    return index === 0 ? accountValue : sum - accountValue;
  }, 0);

  const denominator = denominatorCodes.reduce(
    (sum, code) => sum + (accountValuesByCode.get(code) ?? 0),
    0,
  );

  if ((kpi.formula_type === "percentage" || kpi.formula_type === "ratio") && denominator === 0) {
    return 0;
  }

  const base =
    kpi.formula_type === "percentage" || kpi.formula_type === "ratio"
      ? numerator / denominator
      : numerator;

  return base * (kpi.multiply_by ?? 1);
}

export function buildAccountValuesByCompany(
  amountRows: CompanyAmountRow[],
  accountCodeById: Map<string, string>,
) {
  const map = new Map<string, Map<string, number>>();
  amountRows.forEach((row) => {
    const code = accountCodeById.get(row.dre_account_id);
    if (!code) return;
    const companyMap = map.get(row.company_id) ?? new Map<string, number>();
    companyMap.set(code, Number(row.amount ?? 0));
    map.set(row.company_id, companyMap);
  });
  return map;
}

export function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
}

export function buildLastSixMonthRanges(referenceDateTo: string): DashboardRange[] {
  const end = new Date(`${referenceDateTo}T00:00:00Z`);
  const ranges: DashboardRange[] = [];
  for (let index = 5; index >= 0; index -= 1) {
    const date = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - index, 1));
    const from = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
    const to = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
    ranges.push({
      dateFrom: from.toISOString().slice(0, 10),
      dateTo: to.toISOString().slice(0, 10),
      label: `${String(from.getUTCMonth() + 1).padStart(2, "0")}/${from.getUTCFullYear()}`,
    });
  }
  return ranges;
}
