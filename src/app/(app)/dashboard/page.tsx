import { redirect } from "next/navigation";

import { DashboardDreView } from "@/components/app/dashboard-dre-view";
import { getCurrentSessionContext } from "@/lib/auth/session";
import type { Segment } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";
import {
  SCOPED_DRE_ACCOUNTS_SELECT,
  aggregateDreRows,
  aggregateDreRowsByCompany,
  buildAccumulatedBucket,
  buildDashboardRows,
  buildDateRange,
  buildFilterState,
  buildVisibleBuckets,
  scopeDreAccounts,
  resolveAllowedCompanyIds,
  type DreAccountBase,
  type RawDreAccount,
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
}

export default async function DashboardPage({ searchParams, params }: DashboardPageProps) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user) {
    redirect("/login");
  }

  // Load all segments the user can access (for the picker).
  let segments: Segment[] = [];
  if (profile?.role === "admin") {
    const { data } = await supabase
      .from("segments")
      .select("id,name,slug,display_order,active")
      .eq("active", true)
      .order("display_order");
    segments = (data as Segment[]) ?? [];
  } else if (profile) {
    const { data } = await supabase
      .from("user_segment_access")
      .select("segments(id,name,slug,display_order,active)")
      .eq("user_id", profile.id);
    segments = ((data ?? []) as unknown as Array<{ segments: Segment }>)
      .map((row) => row.segments)
      .filter((s) => s && s.active)
      .sort((a, b) => a.display_order - b.display_order);
  }

  // Resolve segment filter if inside a segment route
  let segmentId: string | null = null;
  const activeSegmentSlug = params?.segmentSlug ?? null;
  if (activeSegmentSlug) {
    const found = segments.find((s) => s.slug === activeSegmentSlug);
    segmentId = found?.id ?? null;
  }

  let companiesQuery = supabase.from("companies").select("id,name,active").eq("active", true);
  if (segmentId) {
    companiesQuery = companiesQuery.eq("segment_id", segmentId);
  }

  const [{ data: companiesData }, { data: accountsData }] = await Promise.all([
    companiesQuery.order("name"),
    supabase
      .from("dre_accounts")
      .select(SCOPED_DRE_ACCOUNTS_SELECT)
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
        lastSyncAt={null}
        segments={segments}
        activeSegmentSlug={activeSegmentSlug}
      />
    );
  }

  const { data: lastSyncAtRaw } = await supabase.rpc(
    "dashboard_last_successful_sync",
    { p_company_ids: filter.selectedCompanyIds },
  );
  const lastSyncAt =
    typeof lastSyncAtRaw === "string" ? lastSyncAtRaw : null;

  const range = buildDateRange(filter);

  // Escopo + tradutor de ids do plano DRE — centralizados em
  // src/lib/dashboard/dre.ts para que Fluxo de Caixa e demais consumidores
  // reusem EXATAMENTE a mesma lógica e o valor de "Resultado do Exercício"
  // não divirja entre telas (ver comentário do bloco em dre.ts).
  const scope = scopeDreAccounts(
    (accountsData ?? []) as RawDreAccount[],
    filter.selectedCompanyIds,
  );
  const accounts = scope.coreAccounts;
  const visibleBuckets = buildVisibleBuckets(filter);
  const accumulatedBucket = buildAccumulatedBucket(visibleBuckets);

  const aggregateBucket = (bucket: { dateFrom: string; dateTo: string }) =>
    aggregateDreRows({
      supabase,
      scope,
      companyIds: filter.selectedCompanyIds,
      dateFrom: bucket.dateFrom,
      dateTo: bucket.dateTo,
    });

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

  // Fetch per-company data for comparative mode. Reaproveita o helper
  // centralizado para garantir que as linhas (incluindo Resultado do
  // Exercício) sigam a mesma regra de cálculo do consolidado.
  const companyValuesMap: Record<string, Record<string, number>> = {};
  if (filter.compareCompanies && filter.selectedCompanyIds.length > 1) {
    const rowsByCompany = await aggregateDreRowsByCompany({
      supabase,
      scope,
      companyIds: filter.selectedCompanyIds,
      dateFrom: accumulatedBucket.dateFrom,
      dateTo: accumulatedBucket.dateTo,
    });
    rowsByCompany.forEach((companyRows, companyId) => {
      const byId: Record<string, number> = {};
      companyRows.forEach((r) => { byId[r.id] = r.value; });
      companyValuesMap[companyId] = byId;
    });
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
      lastSyncAt={lastSyncAt}
      segments={segments}
      activeSegmentSlug={activeSegmentSlug}
    />
  );
}
