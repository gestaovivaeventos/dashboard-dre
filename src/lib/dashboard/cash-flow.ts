// Engine de calculo do modulo Fluxo de Caixa.
//
// Espelha src/lib/dashboard/dre.ts no que toca a filtros, buckets de periodo
// e construcao de linhas — mas com semantica propria:
//
// - Linhas analiticas (is_summary=false, sem source) recebem valor agregado
//   do RPC cash_flow_aggregate (sum sobre financial_entries via mapeamento).
// - Linhas summary com formula nao nula avaliam a formula com sinais.
// - Linhas summary sem formula (ex.: Emprestimos e Mutuos / Investimentos /
//   Dividendos / Aportes) somam filhos respeitando o tipo: receita soma como
//   positivo, despesa soma como negativo. Isso da automaticamente o NET cash
//   impact, sem precisar escrever formula explicita.
// - Linha com source='dre_resultado_exercicio' busca o valor da conta
//   code='11' do DRE para o mesmo periodo/empresa.
// - Linha com source='cash_balance_initial' usa cash_flow_opening_balances
//   ou, na ausencia, o "Caixa Final" do mes anterior (recursivo).
// - Linha com source='cash_balance_final' soma Saldo Inicial + Caixa Gerado.

import type { SupabaseClient } from "@supabase/supabase-js";

export type PeriodMode = "especifico" | "mes_atual" | "ano_atual";
type CashFlowType = "receita" | "despesa" | "calculado" | "misto";

export interface CashFlowAccountBase {
  id: string;
  code: string;
  name: string;
  parent_id: string | null;
  level: number;
  type: CashFlowType;
  is_summary: boolean;
  formula: string | null;
  source: string | null;
  is_highlight_block: boolean;
  sort_order: number;
  active: boolean;
}

export interface CashFlowFilterState {
  periodMode: PeriodMode;
  monthFrom: number;
  yearFrom: number;
  monthTo: number;
  yearTo: number;
  selectedCompanyIds: string[];
  compareCompanies: boolean;
}

export interface CashFlowRange {
  dateFrom: string;
  dateTo: string;
  label: string;
}

export interface CashFlowPeriodBucket {
  key: string;
  label: string;
  dateFrom: string;
  dateTo: string;
  year: number;
  month: number;
}

export interface CashFlowRow extends CashFlowAccountBase {
  value: number;
  hasChildren: boolean;
}

const MONTH_NAMES = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
  "Jul", "Ago", "Set", "Out", "Nov", "Dez",
];

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

export function buildCashFlowFilterState(
  searchParams: Record<string, string | string[] | undefined>,
  companyIds: string[],
): CashFlowFilterState {
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
      : [];

  const compareCompanies = searchParams.compareCompanies === "true";

  return {
    periodMode,
    yearFrom,
    monthFrom,
    yearTo,
    monthTo,
    selectedCompanyIds,
    compareCompanies,
  };
}

export function buildCashFlowDateRange(filter: CashFlowFilterState): CashFlowRange {
  const { yearFrom, monthFrom, yearTo, monthTo, periodMode } = filter;
  const dateFrom = toIsoDate(startOfMonth(yearFrom, monthFrom));
  const dateTo = toIsoDate(endOfMonth(yearTo, monthTo));

  let label: string;
  if (periodMode === "mes_atual") {
    label = `${MONTH_NAMES[monthFrom - 1]}/${yearFrom}`;
  } else if (periodMode === "ano_atual") {
    label = `Jan a Dez/${yearFrom}`;
  } else if (yearFrom === yearTo && monthFrom === monthTo) {
    label = `${MONTH_NAMES[monthFrom - 1]}/${yearFrom}`;
  } else {
    label = `${MONTH_NAMES[monthFrom - 1]}/${yearFrom} a ${MONTH_NAMES[monthTo - 1]}/${yearTo}`;
  }

  return { dateFrom, dateTo, label };
}

export function buildCashFlowBuckets(filter: CashFlowFilterState): CashFlowPeriodBucket[] {
  const { yearFrom, monthFrom, yearTo, monthTo } = filter;
  const buckets: CashFlowPeriodBucket[] = [];

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
      year,
      month,
    });
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return buckets;
}

export function buildCashFlowAccumulatedBucket(buckets: CashFlowPeriodBucket[]): CashFlowPeriodBucket {
  const first = buckets[0];
  const last = buckets[buckets.length - 1];
  return {
    key: "total",
    label: "Total",
    dateFrom: first.dateFrom,
    dateTo: last.dateTo,
    year: last.year,
    month: last.month,
  };
}

// Avalia formulas como "1+2-3" usando o getter por code.
function evaluateFormula(formula: string, getByCode: (code: string) => number) {
  const normalized = formula.replace(/\s+/g, "");
  const parts = normalized.match(/[+-]?[^+-]+/g) ?? [];
  return parts.reduce((sum, token) => {
    if (!token) return sum;
    const operator = token[0] === "-" ? -1 : 1;
    const code = token[0] === "+" || token[0] === "-" ? token.slice(1) : token;
    return sum + operator * getByCode(code);
  }, 0);
}

interface BuildCashFlowRowsOptions {
  /** Valor do "Resultado do Exercicio" ja calculado pelo motor do DRE. */
  dreResultadoExercicio?: number;
  /** Saldo inicial de caixa para o mes corrente. */
  saldoInicial?: number;
}

/**
 * Constroi as linhas do Fluxo de Caixa para um unico bucket de periodo,
 * aplicando: agregacao por mapeamento, sources especiais (DRE, saldo
 * inicial/final) e regra de soma com sinais para summary sem formula.
 */
export function buildCashFlowRows(
  accounts: CashFlowAccountBase[],
  amountsByAccountId: Map<string, number>,
  options: BuildCashFlowRowsOptions = {},
): { rows: CashFlowRow[] } {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const byCode = new Map(accounts.map((a) => [a.code, a]));
  const childrenByParent = new Map<string | null, CashFlowAccountBase[]>();

  accounts.forEach((account) => {
    const siblings = childrenByParent.get(account.parent_id) ?? [];
    siblings.push(account);
    childrenByParent.set(account.parent_id, siblings);
  });
  childrenByParent.forEach((items) => {
    items.sort((a, b) => a.sort_order - b.sort_order || a.code.localeCompare(b.code));
  });

  const cache = new Map<string, number>();

  const calc = (accountId: string): number => {
    if (cache.has(accountId)) return cache.get(accountId)!;
    const account = byId.get(accountId);
    if (!account) return 0;

    let value = 0;
    const children = childrenByParent.get(account.id) ?? [];

    if (account.source === "dre_resultado_exercicio") {
      value = options.dreResultadoExercicio ?? 0;
    } else if (account.source === "cash_balance_initial") {
      value = options.saldoInicial ?? 0;
    } else if (account.source === "cash_balance_final") {
      // Saldo Final = Saldo Inicial + Caixa Gerado (formula tambem cobre
      // isso, mas mantemos source explicito para clareza semantica).
      if (account.formula) {
        value = evaluateFormula(account.formula, (code) => {
          const ref = byCode.get(code);
          return ref ? calc(ref.id) : 0;
        });
      }
    } else if (account.type === "calculado" && account.formula) {
      value = evaluateFormula(account.formula, (code) => {
        const ref = byCode.get(code);
        return ref ? calc(ref.id) : 0;
      });
    } else if (account.is_summary) {
      // Soma filhos com sinais: receita soma positivo, despesa soma negativo.
      // Isso da diretamente o NET cash impact (entradas - saidas) sem exigir
      // formula explicita nas totalizadoras.
      const childrenSum = children.reduce((sum, child) => {
        const childValue = calc(child.id);
        const signed = child.type === "despesa" ? -childValue : childValue;
        return sum + signed;
      }, 0);
      const directAmount = amountsByAccountId.get(account.id) ?? 0;
      value = childrenSum + directAmount;
    } else {
      value = amountsByAccountId.get(account.id) ?? 0;
    }

    cache.set(accountId, value);
    return value;
  };

  const rows = accounts
    .map((account) => ({
      ...account,
      value: calc(account.id),
      hasChildren: (childrenByParent.get(account.id) ?? []).length > 0,
    }))
    .sort((a, b) => {
      if (a.parent_id === b.parent_id) {
        return a.sort_order - b.sort_order || a.code.localeCompare(b.code, undefined, { numeric: true });
      }
      return 0;
    });

  return { rows };
}

/** Retorna o ano/mes do mes anterior. */
export function previousMonth(year: number, month: number): { year: number; month: number } {
  if (month === 1) return { year: year - 1, month: 12 };
  return { year, month: month - 1 };
}

/**
 * Resolve quais empresas o usuario pode ver — copia direta de dre.ts para
 * evitar acoplamento entre os modulos.
 */
export async function resolveAllowedCompanyIds(
  supabase: SupabaseClient,
  profile: { id: string; role: string; company_id: string | null } | null,
  allCompanyIds: string[],
): Promise<string[]> {
  if (!profile) return allCompanyIds;
  if (profile.role === "admin") return allCompanyIds;

  const { data } = await supabase
    .from("user_company_access")
    .select("company_id")
    .eq("user_id", profile.id);

  const accessIds = (data ?? []).map((row) => row.company_id as string);
  if (accessIds.length > 0) {
    return allCompanyIds.filter((id) => accessIds.includes(id));
  }

  if (profile.role === "gestor_unidade" && profile.company_id) {
    return allCompanyIds.filter((id) => id === profile.company_id);
  }

  return [];
}
