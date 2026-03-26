import type { UserProfile } from "@/lib/supabase/types";

type PeriodType = "mensal" | "trimestral" | "semestral" | "anual" | "acumulado";
type DreType = "receita" | "despesa" | "calculado" | "misto";
export type ViewMode = "simples" | "comparativa";

export interface DreAccountBase {
  id: string;
  code: string;
  name: string;
  parent_id: string | null;
  level: number;
  type: DreType;
  is_summary: boolean;
  formula: string | null;
  sort_order: number;
  active: boolean;
}

export interface DashboardFilterState {
  viewMode: ViewMode;
  periodType: PeriodType;
  year: number;
  month: number;
  quarter: number;
  semester: 1 | 2;
  startDate: string;
  endDate: string;
  selectedCompanyIds: string[];
}

export interface DashboardRange {
  dateFrom: string;
  dateTo: string;
  label: string;
}

export interface DashboardPeriodBucket {
  key: string;
  label: string;
  dateFrom: string;
  dateTo: string;
}

export interface DashboardRow extends DreAccountBase {
  value: number;
  percentageOverNetRevenue: number;
  hasChildren: boolean;
}

export function isCoreDreCode(code: string) {
  const topLevel = Number(code.split(".")[0]);
  return Number.isInteger(topLevel) && topLevel >= 1 && topLevel <= 11;
}

export function filterCoreDreAccounts(accounts: DreAccountBase[]) {
  return accounts.filter((account) => isCoreDreCode(account.code));
}

function startOfMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month - 1, 1));
}

function endOfMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0));
}

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function parseInteger(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

export function buildFilterState(
  searchParams: Record<string, string | string[] | undefined>,
  companyIds: string[],
) {
  const now = new Date();
  const fallbackYear = now.getUTCFullYear();
  const fallbackMonth = now.getUTCMonth() + 1;
  const viewMode = (searchParams.viewMode as ViewMode) || "simples";
  const periodType = (searchParams.periodType as PeriodType) || "mensal";
  const year = parseInteger(searchParams.year as string | undefined, fallbackYear);
  const month = Math.min(12, Math.max(1, parseInteger(searchParams.month as string | undefined, fallbackMonth)));
  const quarter = Math.min(4, Math.max(1, parseInteger(searchParams.quarter as string | undefined, 1)));
  const semester = (Math.min(2, Math.max(1, parseInteger(searchParams.semester as string | undefined, 1))) as 1 | 2);

  const defaultStart = toIsoDate(startOfMonth(year, month));
  const defaultEnd = toIsoDate(endOfMonth(year, month));
  const startDate = (searchParams.startDate as string | undefined) || defaultStart;
  const endDate = (searchParams.endDate as string | undefined) || defaultEnd;

  const rawCompanies = (searchParams.companyIds as string | undefined)?.split(",").filter(Boolean) ?? [];
  const allSelected = rawCompanies.length === 0 || rawCompanies.includes("all");
  const selectedCompanyIds = allSelected
    ? companyIds
    : rawCompanies.filter((companyId) => companyIds.includes(companyId));

  return {
    viewMode,
    periodType,
    year,
    month,
    quarter,
    semester,
    startDate,
    endDate,
    selectedCompanyIds: selectedCompanyIds.length > 0 ? selectedCompanyIds : companyIds,
  } satisfies DashboardFilterState;
}

export function buildDateRange(filter: DashboardFilterState): DashboardRange {
  const { periodType, year, month, quarter, semester, startDate, endDate } = filter;

  if (periodType === "mensal") {
    const from = startOfMonth(year, month);
    const to = endOfMonth(year, month);
    return {
      dateFrom: toIsoDate(from),
      dateTo: toIsoDate(to),
      label: `Mensal ${String(month).padStart(2, "0")}/${year}`,
    };
  }

  if (periodType === "trimestral") {
    const firstMonth = (quarter - 1) * 3 + 1;
    return {
      dateFrom: toIsoDate(startOfMonth(year, firstMonth)),
      dateTo: toIsoDate(endOfMonth(year, firstMonth + 2)),
      label: `${quarter}o trimestre/${year}`,
    };
  }

  if (periodType === "semestral") {
    const firstMonth = semester === 1 ? 1 : 7;
    return {
      dateFrom: toIsoDate(startOfMonth(year, firstMonth)),
      dateTo: toIsoDate(endOfMonth(year, firstMonth + 5)),
      label: `${semester}o semestre/${year}`,
    };
  }

  if (periodType === "anual") {
    return {
      dateFrom: `${year}-01-01`,
      dateTo: `${year}-12-31`,
      label: `Anual ${year}`,
    };
  }

  return {
    dateFrom: startDate,
    dateTo: endDate,
    label: `Acumulado ${startDate} ate ${endDate}`,
  };
}

export function buildVisibleBuckets(filter: DashboardFilterState) {
  const single = buildDateRange(filter);
  if (filter.viewMode === "simples") {
    return [
      {
        key: "single",
        label: "Periodo",
        dateFrom: single.dateFrom,
        dateTo: single.dateTo,
      },
    ] satisfies DashboardPeriodBucket[];
  }

  if (filter.periodType === "mensal") {
    return Array.from({ length: 12 }).map((_, index) => {
      const month = index + 1;
      const from = startOfMonth(filter.year, month);
      const to = endOfMonth(filter.year, month);
      return {
        key: `m-${month}`,
        label: `${String(month).padStart(2, "0")}/${filter.year}`,
        dateFrom: toIsoDate(from),
        dateTo: toIsoDate(to),
      };
    }) satisfies DashboardPeriodBucket[];
  }

  if (filter.periodType === "trimestral") {
    return [1, 2, 3, 4].map((quarter) => {
      const firstMonth = (quarter - 1) * 3 + 1;
      return {
        key: `q-${quarter}`,
        label: `Q${quarter}/${filter.year}`,
        dateFrom: toIsoDate(startOfMonth(filter.year, firstMonth)),
        dateTo: toIsoDate(endOfMonth(filter.year, firstMonth + 2)),
      };
    }) satisfies DashboardPeriodBucket[];
  }

  if (filter.periodType === "semestral") {
    return [1, 2].map((semester) => {
      const firstMonth = semester === 1 ? 1 : 7;
      return {
        key: `s-${semester}`,
        label: `S${semester}/${filter.year}`,
        dateFrom: toIsoDate(startOfMonth(filter.year, firstMonth)),
        dateTo: toIsoDate(endOfMonth(filter.year, firstMonth + 5)),
      };
    }) satisfies DashboardPeriodBucket[];
  }

  if (filter.periodType === "anual") {
    return [
      {
        key: `y-${filter.year}`,
        label: String(filter.year),
        dateFrom: `${filter.year}-01-01`,
        dateTo: `${filter.year}-12-31`,
      },
    ] satisfies DashboardPeriodBucket[];
  }

  return [
    {
      key: "acc",
      label: "Acumulado",
      dateFrom: filter.startDate,
      dateTo: filter.endDate,
    },
  ] satisfies DashboardPeriodBucket[];
}

export function buildAccumulatedBucket(buckets: DashboardPeriodBucket[]) {
  const first = buckets[0];
  const last = buckets[buckets.length - 1];
  return {
    key: "acc-total",
    label: "Acumulado",
    dateFrom: first.dateFrom,
    dateTo: last.dateTo,
  } satisfies DashboardPeriodBucket;
}

function evaluateFormula(formula: string, getByCode: (code: string) => number) {
  const normalized = formula.replace(/\s+/g, "");
  const parts = normalized.match(/[+-]?[^+-]+/g) ?? [];
  return parts.reduce((sum, token) => {
    if (!token) return sum;
    const operator = token[0] === "-" ? -1 : 1;
    const code = token[0] === "+" || token[0] === "-" ? token.slice(1) : token;
    const value = getByCode(code);
    return sum + operator * value;
  }, 0);
}

export function buildDashboardRows(
  accounts: DreAccountBase[],
  amountsByAccountId: Map<string, number>,
) {
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const byCode = new Map(accounts.map((account) => [account.code, account]));
  const childrenByParent = new Map<string | null, DreAccountBase[]>();

  accounts.forEach((account) => {
    const siblings = childrenByParent.get(account.parent_id) ?? [];
    siblings.push(account);
    childrenByParent.set(account.parent_id, siblings);
  });

  childrenByParent.forEach((items) => {
    items.sort((a, b) => a.sort_order - b.sort_order || a.code.localeCompare(b.code));
  });

  const cacheById = new Map<string, number>();
  const calculateValueById = (accountId: string): number => {
    if (cacheById.has(accountId)) {
      return cacheById.get(accountId)!;
    }
    const account = byId.get(accountId);
    if (!account) return 0;

    let value = 0;
    const children = childrenByParent.get(account.id) ?? [];
    if (account.type === "calculado" && account.formula) {
      value = evaluateFormula(account.formula, (code) => {
        const ref = byCode.get(code);
        return ref ? calculateValueById(ref.id) : 0;
      });
    } else if (account.is_summary) {
      value = children.reduce((sum, child) => sum + calculateValueById(child.id), 0);
    } else {
      value = amountsByAccountId.get(account.id) ?? 0;
    }

    cacheById.set(accountId, value);
    return value;
  };

  const netRevenueAccount = accounts.find((account) => account.code === "4");
  const netRevenueValue = netRevenueAccount ? calculateValueById(netRevenueAccount.id) : 0;

  const rows = accounts
    .map((account) => {
      const value = calculateValueById(account.id);
      const percentage =
        netRevenueValue !== 0 ? (value / netRevenueValue) * 100 : 0;
      return {
        ...account,
        value,
        percentageOverNetRevenue: percentage,
        hasChildren: (childrenByParent.get(account.id) ?? []).length > 0,
      } satisfies DashboardRow;
    })
    .sort((a, b) => {
      if (a.level !== b.level && a.parent_id === b.parent_id) {
        return a.sort_order - b.sort_order;
      }
      return a.code.localeCompare(b.code, undefined, { numeric: true });
    });

  return {
    rows,
    netRevenueCode: netRevenueAccount?.code ?? "4",
  };
}

export function resolveAllowedCompanyIds(
  profile: UserProfile | null,
  allCompanyIds: string[],
) {
  if (!profile) return allCompanyIds;
  if (profile.role === "gestor_unidade") {
    return profile.company_id ? [profile.company_id] : [];
  }
  return allCompanyIds;
}
