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
  const allowedCompanyIds = resolveAllowedCompanyIds(
    profile,
    companies.map((company) => company.id),
  );

  const filter = buildFilterState(searchParams, allowedCompanyIds);
  if (profile?.role === "gestor_unidade") {
    filter.selectedCompanyIds = allowedCompanyIds;
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

  const displayRows = zeroRows.map((row) => {
    const valuesByBucket: Record<string, number> = {};
    visibleBuckets.forEach((bucket) => {
      valuesByBucket[bucket.key] = valuesPerBucket.get(bucket.key)?.[row.id] ?? 0;
    });

    return {
      ...row,
      valuesByBucket,
      accumulatedValue: accumulatedMap[row.id] ?? 0,
    } satisfies DashboardDisplayRow;
  });

  return (
    <DashboardDreView
      filter={filter}
      range={range}
      rows={displayRows}
      companies={companies.filter((company) => allowedCompanyIds.includes(company.id))}
      role={profile?.role ?? "gestor_hero"}
      visibleBuckets={visibleBuckets}
      accumulatedBucket={accumulatedBucket}
      selectedCompanyIds={filter.selectedCompanyIds}
    />
  );
}
