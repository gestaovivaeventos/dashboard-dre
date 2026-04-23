import { redirect } from "next/navigation";

import { DashboardDreView } from "@/components/app/dashboard-dre-view";
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

interface DashboardPageProps {
  searchParams: Record<string, string | string[] | undefined>;
  params?: { segmentSlug?: string };
}

interface DashboardDisplayRow extends DreAccountBase {
  hasChildren: boolean;
  percentageOverNetRevenue: number;
  valuesByBucket: Record<string, number>;
  accumulatedValue: number;
  valuesByCompany?: Record<string, number>;
  budgetValue?: number;
}

export default async function DashboardPage({ searchParams, params }: DashboardPageProps) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user) {
    redirect("/login");
  }

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

  // Filter the companies list to only show allowed ones
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

  // If no companies selected, render empty state
  if (filter.selectedCompanyIds.length === 0) {
    return (
      <DashboardDreView
        filter={filter}
        range={{ dateFrom: "", dateTo: "", label: "" }}
        rows={[]}
        companies={visibleCompanies}
        role={profile?.role ?? "gestor_hero"}
        visibleBuckets={[]}
        accumulatedBucket={{ key: "", label: "", dateFrom: "", dateTo: "" }}
        selectedCompanyIds={[]}
      />
    );
  }

  const range = buildDateRange(filter);
  const accounts = filterCoreDreAccounts((accountsData ?? []) as DreAccountBase[]);
  const visibleBuckets = buildVisibleBuckets(filter);
  const accumulatedBucket = buildAccumulatedBucket(visibleBuckets);

  const aggregateBucket = async (bucket: DashboardPeriodBucket) => {
    const { data, error } = await supabase.rpc("dashboard_dre_aggregate", {
      p_company_ids: filter.selectedCompanyIds,
      p_date_from: bucket.dateFrom,
      p_date_to: bucket.dateTo,
    });
    if (error) {
      throw new Error(`Falha ao carregar agregados DRE: ${error.message}`);
    }

    const amountsByAccountId = new Map<string, number>();
    (
      data as Array<{ dre_account_id: string; amount: number | string | null }> | null
    ?? []
    ).forEach((item) => {
      amountsByAccountId.set(item.dre_account_id, Number(item.amount ?? 0));
    });

    return buildDashboardRows(accounts, amountsByAccountId).rows;
  };

  const [bucketRows, accumulatedRows, zeroRows] = await Promise.all([
    Promise.all(visibleBuckets.map((bucket) => aggregateBucket(bucket))),
    aggregateBucket(accumulatedBucket),
    Promise.resolve(buildDashboardRows(accounts, new Map()).rows),
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

  // Fetch per-company data for comparative mode
  const companyValuesMap: Record<string, Record<string, number>> = {};
  if (filter.compareCompanies && filter.selectedCompanyIds.length > 1) {
    const { data: byCompanyData } = await supabase.rpc("dashboard_dre_aggregate_by_company", {
      p_company_ids: filter.selectedCompanyIds,
      p_date_from: accumulatedBucket.dateFrom,
      p_date_to: accumulatedBucket.dateTo,
    });

    const rawByCompany = (byCompanyData as Array<{
      company_id: string;
      dre_account_id: string;
      amount: number | string | null;
    }> | null) ?? [];

    // Group raw amounts by company
    const amountsByCompanyId = new Map<string, Map<string, number>>();
    rawByCompany.forEach((item) => {
      let map = amountsByCompanyId.get(item.company_id);
      if (!map) {
        map = new Map();
        amountsByCompanyId.set(item.company_id, map);
      }
      map.set(item.dre_account_id, Number(item.amount ?? 0));
    });

    // Build full DRE rows per company (so formulas/summaries are computed)
    for (const companyId of filter.selectedCompanyIds) {
      const companyAmounts = amountsByCompanyId.get(companyId) ?? new Map();
      const companyRows = buildDashboardRows(accounts, companyAmounts).rows;
      const byId: Record<string, number> = {};
      companyRows.forEach((r) => { byId[r.id] = r.value; });
      companyValuesMap[companyId] = byId;
    }
  }

  // Fetch budget data for "Previsto x Realizado" mode
  // When "Ano atual", cap budget at current month (not full year)
  const budgetMap: Record<string, number> = {};
  if (filter.budgetMode) {
    const now = new Date();
    const currentMonth = now.getUTCMonth() + 1;
    const currentYear = now.getUTCFullYear();

    let budgetDateTo = accumulatedBucket.dateTo;
    if (filter.periodMode === "ano_atual") {
      const lastDay = new Date(Date.UTC(currentYear, currentMonth, 0));
      budgetDateTo = lastDay.toISOString().slice(0, 10);
    }

    const { data: budgetData } = await supabase.rpc("budget_aggregate", {
      p_company_ids: filter.selectedCompanyIds,
      p_date_from: accumulatedBucket.dateFrom,
      p_date_to: budgetDateTo,
    });

    const budgetAmounts = new Map<string, number>();
    ((budgetData as Array<{ dre_account_id: string; amount: number | string | null }> | null) ?? []).forEach((item) => {
      budgetAmounts.set(item.dre_account_id, Number(item.amount ?? 0));
    });

    // Build full DRE rows from budget amounts (so formulas/summaries compute)
    const budgetRows = buildDashboardRows(accounts, budgetAmounts).rows;
    budgetRows.forEach((r) => { budgetMap[r.id] = r.value; });
  }

  const displayRows = zeroRows.map((row) => {
    const valuesByBucket: Record<string, number> = {};
    visibleBuckets.forEach((bucket) => {
      valuesByBucket[bucket.key] = valuesPerBucket.get(bucket.key)?.[row.id] ?? 0;
    });

    const valuesByCompany: Record<string, number> = {};
    if (filter.compareCompanies) {
      for (const companyId of filter.selectedCompanyIds) {
        valuesByCompany[companyId] = companyValuesMap[companyId]?.[row.id] ?? 0;
      }
    }

    return {
      ...row,
      valuesByBucket,
      accumulatedValue: accumulatedMap[row.id] ?? 0,
      valuesByCompany: filter.compareCompanies ? valuesByCompany : undefined,
      budgetValue: filter.budgetMode ? (budgetMap[row.id] ?? 0) : undefined,
    } satisfies DashboardDisplayRow;
  });

  return (
    <DashboardDreView
      filter={filter}
      range={range}
      rows={displayRows}
      companies={visibleCompanies}
      role={profile?.role ?? "gestor_hero"}
      visibleBuckets={visibleBuckets}
      accumulatedBucket={accumulatedBucket}
      selectedCompanyIds={filter.selectedCompanyIds}
    />
  );
}
