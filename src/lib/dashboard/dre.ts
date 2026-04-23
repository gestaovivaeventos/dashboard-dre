import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserProfile } from "@/lib/supabase/types";

export type PeriodMode = "especifico" | "mes_atual" | "ano_atual";
type DreType = "receita" | "despesa" | "calculado" | "misto";

// Keep legacy ViewMode export for type compatibility
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
  periodMode: PeriodMode;
  monthFrom: number;
  yearFrom: number;
  monthTo: number;
  yearTo: number;
  selectedCompanyIds: string[];
  compareCompanies: boolean;
  budgetMode: boolean;
  // Legacy fields kept for backward compat with URL params
  viewMode: ViewMode;
  periodType: string;
  year: number;
  month: number;
  quarter: number;
  semester: 1 | 2;
  startDate: string;
  endDate: string;
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

const MONTH_NAMES = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
  "Jul", "Ago", "Set", "Out", "Nov", "Dez",
];

export function buildFilterState(
  searchParams: Record<string, string | string[] | undefined>,
  companyIds: string[],
) {
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1;

  const periodMode = (searchParams.periodMode as PeriodMode) || "ano_atual";

  let yearFrom: number;
  let monthFrom: number;
  let yearTo: number;
  let monthTo: number;

  if (periodMode === "mes_atual") {
    yearFrom = currentYear;
    monthFrom = currentMonth;
    yearTo = currentYear;
    monthTo = currentMonth;
  } else if (periodMode === "ano_atual") {
    yearFrom = currentYear;
    monthFrom = 1;
    yearTo = currentYear;
    monthTo = 12;
  } else {
    // especifico
    yearFrom = parseInteger(searchParams.yearFrom as string | undefined, currentYear);
    monthFrom = Math.min(12, Math.max(1, parseInteger(searchParams.monthFrom as string | undefined, 1)));
    yearTo = parseInteger(searchParams.yearTo as string | undefined, currentYear);
    monthTo = Math.min(12, Math.max(1, parseInteger(searchParams.monthTo as string | undefined, currentMonth)));
  }

  const rawCompanies = (searchParams.companyIds as string | undefined)?.split(",").filter(Boolean) ?? [];
  const hasCompanyParam = Boolean(searchParams.companyIds);
  const selectedCompanyIds = rawCompanies.includes("all")
    ? companyIds
    : hasCompanyParam
      ? rawCompanies.filter((companyId) => companyIds.includes(companyId))
      : []; // No companies selected by default — user must choose

  const compareCompanies = searchParams.compareCompanies === "true";
  const budgetMode = searchParams.budgetMode === "true";

  return {
    periodMode,
    yearFrom,
    monthFrom,
    yearTo,
    monthTo,
    selectedCompanyIds,
    compareCompanies,
    budgetMode,
    // Legacy defaults
    viewMode: "comparativa" as ViewMode,
    periodType: "mensal",
    year: yearFrom,
    month: monthFrom,
    quarter: 1,
    semester: 1 as 1 | 2,
    startDate: toIsoDate(startOfMonth(yearFrom, monthFrom)),
    endDate: toIsoDate(endOfMonth(yearTo, monthTo)),
  } satisfies DashboardFilterState;
}

export function buildDateRange(filter: DashboardFilterState): DashboardRange {
  const { yearFrom, monthFrom, yearTo, monthTo, periodMode } = filter;
  const dateFrom = toIsoDate(startOfMonth(yearFrom, monthFrom));
  const dateTo = toIsoDate(endOfMonth(yearTo, monthTo));

  let label: string;
  if (periodMode === "mes_atual") {
    label = `${MONTH_NAMES[monthFrom - 1]}/${yearFrom}`;
  } else if (periodMode === "ano_atual") {
    label = `Jan a Dez/${yearFrom}`;
  } else {
    if (yearFrom === yearTo && monthFrom === monthTo) {
      label = `${MONTH_NAMES[monthFrom - 1]}/${yearFrom}`;
    } else {
      label = `${MONTH_NAMES[monthFrom - 1]}/${yearFrom} a ${MONTH_NAMES[monthTo - 1]}/${yearTo}`;
    }
  }

  return { dateFrom, dateTo, label };
}

export function buildVisibleBuckets(filter: DashboardFilterState) {
  const { yearFrom, monthFrom, yearTo, monthTo } = filter;

  const buckets: DashboardPeriodBucket[] = [];
  let year = yearFrom;
  let month = monthFrom;

  while (year < yearTo || (year === yearTo && month <= monthTo)) {
    const from = startOfMonth(year, month);
    const to = endOfMonth(year, month);
    buckets.push({
      key: `m-${year}-${month}`,
      label: `${MONTH_NAMES[month - 1]}/${String(year).slice(2)}`,
      dateFrom: toIsoDate(from),
      dateTo: toIsoDate(to),
    });
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }

  return buckets;
}

export function buildAccumulatedBucket(buckets: DashboardPeriodBucket[]) {
  const first = buckets[0];
  const last = buckets[buckets.length - 1];
  return {
    key: "total",
    label: "Total",
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

/**
 * Resolve which companies the user is allowed to see.
 * - admin: all companies
 * - gestor_hero / gestor_unidade: only companies in user_company_access
 *   (falls back to profile.company_id for gestor_unidade if no access rows exist)
 */
export async function resolveAllowedCompanyIds(
  supabase: SupabaseClient,
  profile: UserProfile | null,
  allCompanyIds: string[],
): Promise<string[]> {
  if (!profile) return allCompanyIds;
  if (profile.role === "admin") return allCompanyIds;

  // Query the user_company_access table for explicit permissions
  const { data } = await supabase
    .from("user_company_access")
    .select("company_id")
    .eq("user_id", profile.id);

  const accessIds = (data ?? []).map((row) => row.company_id as string);

  if (accessIds.length > 0) {
    // Only keep companies that exist in the loaded list
    return allCompanyIds.filter((id) => accessIds.includes(id));
  }

  // Fallback for gestor_unidade with legacy company_id field
  if (profile.role === "gestor_unidade" && profile.company_id) {
    return allCompanyIds.filter((id) => id === profile.company_id);
  }

  // No explicit access configured — show nothing for non-admins
  return [];
}
