import { redirect } from "next/navigation";

import { BudgetForecastView } from "@/components/app/budget-forecast-view";
import { getCurrentSessionContext } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
import {
  buildAccumulatedBucket,
  buildDashboardRows,
  buildDateRange,
  buildFilterState,
  buildVisibleBuckets,
  filterCoreDreAccounts,
  resolveAllowedCompanyIds,
  type DreAccountBase,
  type DashboardPeriodBucket,
} from "@/lib/dashboard/dre";

type ViewTab = "orcamento" | "realizado" | "projecao";
type RealizadoSubView = "consolidado" | "mensal";

interface BudgetForecastPageProps {
  searchParams: Record<string, string | string[] | undefined>;
  params?: { segmentSlug?: string };
}

interface BudgetForecastDisplayRow extends DreAccountBase {
  hasChildren: boolean;
  percentageOverNetRevenue: number;
  valuesByBucket: Record<string, number>;
  accumulatedValue: number;
  budgetValue?: number;
  realizedValue?: number;
  budgetByBucket?: Record<string, number>;
  accumulatedBudget?: number;
}

function parseView(value: string | string[] | undefined): ViewTab {
  const v = Array.isArray(value) ? value[0] : value;
  if (v === "realizado" || v === "projecao") return v;
  return "orcamento";
}

function parseSubView(value: string | string[] | undefined): RealizadoSubView {
  const v = Array.isArray(value) ? value[0] : value;
  return v === "mensal" ? "mensal" : "consolidado";
}

export default async function BudgetForecastPage({ searchParams, params }: BudgetForecastPageProps) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user) {
    redirect("/login");
  }

  const view = parseView(searchParams.view);
  const subView = parseSubView(searchParams.subView);

  // Resolve segment filter if inside a segment route
  let segmentId: string | null = null;
  if (params?.segmentSlug) {
    const { data: seg } = await supabase
      .from("segments")
      .select("id")
      .eq("slug", params.segmentSlug)
      .eq("active", true)
      .maybeSingle<{ id: string }>();
    segmentId = seg?.id ?? null;
  }

  let companiesQuery = supabase.from("companies").select("id,name,active").eq("active", true);
  if (segmentId) {
    companiesQuery = companiesQuery.eq("segment_id", segmentId);
  }

  const [{ data: companiesData }, { data: accountsData }] = await Promise.all([
    companiesQuery.order("name"),
    supabase
      .from("dre_accounts")
      .select("id,code,name,parent_id,level,type,is_summary,formula,sort_order,active")
      .eq("active", true)
      .order("code"),
  ]);

  const companies = (companiesData ?? []).map((company) => ({
    id: company.id as string,
    name: company.name as string,
  }));
  const allowedCompanyIds = await resolveAllowedCompanyIds(
    supabase,
    profile,
    companies.map((company) => company.id),
  );

  const visibleCompanies = profile?.role === "admin"
    ? companies
    : companies.filter((c) => allowedCompanyIds.includes(c.id));

  const filter = buildFilterState(searchParams, allowedCompanyIds);
  if (profile?.role !== "admin") {
    filter.selectedCompanyIds = allowedCompanyIds.length > 0
      ? filter.selectedCompanyIds.filter((id) => allowedCompanyIds.includes(id))
      : allowedCompanyIds;
    if (filter.selectedCompanyIds.length === 0) {
      filter.selectedCompanyIds = allowedCompanyIds;
    }
  }

  if (filter.selectedCompanyIds.length === 0) {
    return (
      <BudgetForecastView
        view={view}
        subView={subView}
        filter={filter}
        range={{ dateFrom: "", dateTo: "", label: "" }}
        rows={[]}
        companies={visibleCompanies}
        role={profile?.role ?? "gestor_hero"}
        visibleBuckets={[]}
        accumulatedBucket={{ key: "", label: "", dateFrom: "", dateTo: "" }}
        selectedCompanyIds={[]}
        currentMonthIndex={-1}
      />
    );
  }

  const range = buildDateRange(filter);
  const accounts = filterCoreDreAccounts((accountsData ?? []) as DreAccountBase[]);
  const visibleBuckets = buildVisibleBuckets(filter);
  const accumulatedBucket = buildAccumulatedBucket(visibleBuckets);

  const aggregateRealizedBucket = async (bucket: DashboardPeriodBucket) => {
    const { data, error } = await supabase.rpc("dashboard_dre_aggregate", {
      p_company_ids: filter.selectedCompanyIds,
      p_date_from: bucket.dateFrom,
      p_date_to: bucket.dateTo,
    });
    if (error) {
      throw new Error(`Falha ao carregar agregados DRE: ${error.message}`);
    }
    const amounts = new Map<string, number>();
    ((data as Array<{ dre_account_id: string; amount: number | string | null }> | null) ?? []).forEach((item) => {
      amounts.set(item.dre_account_id, Number(item.amount ?? 0));
    });
    return buildDashboardRows(accounts, amounts).rows;
  };

  const aggregateBudgetBucket = async (bucket: DashboardPeriodBucket) => {
    const { data, error } = await supabase.rpc("budget_aggregate", {
      p_company_ids: filter.selectedCompanyIds,
      p_date_from: bucket.dateFrom,
      p_date_to: bucket.dateTo,
    });
    if (error) {
      throw new Error(`Falha ao carregar agregados de orcamento: ${error.message}`);
    }
    const amounts = new Map<string, number>();
    ((data as Array<{ dre_account_id: string; amount: number | string | null }> | null) ?? []).forEach((item) => {
      amounts.set(item.dre_account_id, Number(item.amount ?? 0));
    });
    return buildDashboardRows(accounts, amounts).rows;
  };

  const zeroRows = buildDashboardRows(accounts, new Map()).rows;

  const now = new Date();
  const currentMonth = now.getUTCMonth() + 1;
  const currentYear = now.getUTCFullYear();

  // Compute current-month boundary index within visibleBuckets (-1 if no buckets)
  const currentMonthIndex = visibleBuckets.findIndex((b) => {
    const [yStr, mStr] = b.key.replace("m-", "").split("-");
    const y = Number(yStr);
    const m = Number(mStr);
    return y > currentYear || (y === currentYear && m >= currentMonth);
  });

  let displayRows: BudgetForecastDisplayRow[] = [];

  if (view === "orcamento") {
    // Annual budget: monthly columns + total
    const [bucketRows, accumulatedRows] = await Promise.all([
      Promise.all(visibleBuckets.map((bucket) => aggregateBudgetBucket(bucket))),
      aggregateBudgetBucket(accumulatedBucket),
    ]);

    const valuesPerBucket = new Map<string, Record<string, number>>();
    visibleBuckets.forEach((bucket, index) => {
      const byRowId: Record<string, number> = {};
      bucketRows[index].forEach((row) => {
        byRowId[row.id] = row.value;
      });
      valuesPerBucket.set(bucket.key, byRowId);
    });

    const accumulatedMap: Record<string, number> = {};
    accumulatedRows.forEach((row) => {
      accumulatedMap[row.id] = row.value;
    });

    displayRows = zeroRows.map((row) => {
      const valuesByBucket: Record<string, number> = {};
      visibleBuckets.forEach((bucket) => {
        valuesByBucket[bucket.key] = valuesPerBucket.get(bucket.key)?.[row.id] ?? 0;
      });
      return {
        ...row,
        valuesByBucket,
        accumulatedValue: accumulatedMap[row.id] ?? 0,
      } satisfies BudgetForecastDisplayRow;
    });
  } else if (view === "realizado") {
    if (subView === "mensal") {
      // Per-month Previsto x Realizado x Var%
      // When periodMode=ano_atual, cap to current month (Jan to current).
      const monthlyBuckets =
        filter.periodMode === "ano_atual"
          ? visibleBuckets.filter((b) => {
              const [yStr, mStr] = b.key.replace("m-", "").split("-");
              const y = Number(yStr);
              const m = Number(mStr);
              return y < currentYear || (y === currentYear && m <= currentMonth);
            })
          : visibleBuckets;

      const [realizedRowsByBucket, budgetRowsByBucket] = await Promise.all([
        Promise.all(monthlyBuckets.map((b) => aggregateRealizedBucket(b))),
        Promise.all(monthlyBuckets.map((b) => aggregateBudgetBucket(b))),
      ]);

      const realizedPerBucket = new Map<string, Record<string, number>>();
      const budgetPerBucket = new Map<string, Record<string, number>>();
      monthlyBuckets.forEach((bucket, index) => {
        const realMap: Record<string, number> = {};
        realizedRowsByBucket[index].forEach((row) => { realMap[row.id] = row.value; });
        realizedPerBucket.set(bucket.key, realMap);
        const budMap: Record<string, number> = {};
        budgetRowsByBucket[index].forEach((row) => { budMap[row.id] = row.value; });
        budgetPerBucket.set(bucket.key, budMap);
      });

      displayRows = zeroRows.map((row) => {
        const valuesByBucket: Record<string, number> = {};
        const budgetByBucket: Record<string, number> = {};
        let accReal = 0;
        let accBudget = 0;
        monthlyBuckets.forEach((bucket) => {
          const r = realizedPerBucket.get(bucket.key)?.[row.id] ?? 0;
          const b = budgetPerBucket.get(bucket.key)?.[row.id] ?? 0;
          valuesByBucket[bucket.key] = r;
          budgetByBucket[bucket.key] = b;
          accReal += r;
          accBudget += b;
        });
        return {
          ...row,
          valuesByBucket,
          budgetByBucket,
          accumulatedValue: accReal,
          accumulatedBudget: accBudget,
          realizedValue: accReal,
          budgetValue: accBudget,
        } satisfies BudgetForecastDisplayRow;
      });

      // Override visibleBuckets/accumulatedBucket so the view renders monthly columns.
      const effectiveAccumulated = monthlyBuckets.length > 0
        ? buildAccumulatedBucket(monthlyBuckets)
        : accumulatedBucket;

      return (
        <BudgetForecastView
          view={view}
          subView={subView}
          filter={filter}
          range={range}
          rows={displayRows}
          companies={visibleCompanies}
          role={profile?.role ?? "gestor_hero"}
          visibleBuckets={monthlyBuckets}
          accumulatedBucket={effectiveAccumulated}
          selectedCompanyIds={filter.selectedCompanyIds}
          currentMonthIndex={currentMonthIndex}
        />
      );
    }

    // Consolidado: aggregated period
    let budgetDateTo = accumulatedBucket.dateTo;
    if (filter.periodMode === "ano_atual") {
      const lastDay = new Date(Date.UTC(currentYear, currentMonth, 0));
      budgetDateTo = lastDay.toISOString().slice(0, 10);
    }
    const cappedBudgetBucket: DashboardPeriodBucket = {
      ...accumulatedBucket,
      dateTo: budgetDateTo,
    };

    const [realizedRows, budgetRows] = await Promise.all([
      aggregateRealizedBucket(accumulatedBucket),
      aggregateBudgetBucket(cappedBudgetBucket),
    ]);

    const realizedMap: Record<string, number> = {};
    realizedRows.forEach((row) => { realizedMap[row.id] = row.value; });
    const budgetMap: Record<string, number> = {};
    budgetRows.forEach((row) => { budgetMap[row.id] = row.value; });

    displayRows = zeroRows.map((row) => ({
      ...row,
      valuesByBucket: {},
      accumulatedValue: realizedMap[row.id] ?? 0,
      realizedValue: realizedMap[row.id] ?? 0,
      budgetValue: budgetMap[row.id] ?? 0,
    } satisfies BudgetForecastDisplayRow));
  } else {
    // Projecao: months <= current = realized, months > current = budget
    const realizedBuckets = visibleBuckets.filter((b) => {
      const [yStr, mStr] = b.key.replace("m-", "").split("-");
      const y = Number(yStr);
      const m = Number(mStr);
      return y < currentYear || (y === currentYear && m <= currentMonth);
    });
    const budgetBuckets = visibleBuckets.filter((b) => {
      const [yStr, mStr] = b.key.replace("m-", "").split("-");
      const y = Number(yStr);
      const m = Number(mStr);
      return y > currentYear || (y === currentYear && m > currentMonth);
    });

    const [realizedRowsByBucket, budgetRowsByBucket] = await Promise.all([
      Promise.all(realizedBuckets.map((b) => aggregateRealizedBucket(b))),
      Promise.all(budgetBuckets.map((b) => aggregateBudgetBucket(b))),
    ]);

    const valuesPerBucket = new Map<string, Record<string, number>>();
    realizedBuckets.forEach((bucket, index) => {
      const byRowId: Record<string, number> = {};
      realizedRowsByBucket[index].forEach((row) => { byRowId[row.id] = row.value; });
      valuesPerBucket.set(bucket.key, byRowId);
    });
    budgetBuckets.forEach((bucket, index) => {
      const byRowId: Record<string, number> = {};
      budgetRowsByBucket[index].forEach((row) => { byRowId[row.id] = row.value; });
      valuesPerBucket.set(bucket.key, byRowId);
    });

    displayRows = zeroRows.map((row) => {
      const valuesByBucket: Record<string, number> = {};
      let accumulated = 0;
      visibleBuckets.forEach((bucket) => {
        const v = valuesPerBucket.get(bucket.key)?.[row.id] ?? 0;
        valuesByBucket[bucket.key] = v;
        accumulated += v;
      });
      return {
        ...row,
        valuesByBucket,
        accumulatedValue: accumulated,
      } satisfies BudgetForecastDisplayRow;
    });
  }

  return (
    <BudgetForecastView
      view={view}
      subView={subView}
      filter={filter}
      range={range}
      rows={displayRows}
      companies={visibleCompanies}
      role={profile?.role ?? "gestor_hero"}
      visibleBuckets={visibleBuckets}
      accumulatedBucket={accumulatedBucket}
      selectedCompanyIds={filter.selectedCompanyIds}
      currentMonthIndex={currentMonthIndex}
    />
  );
}
