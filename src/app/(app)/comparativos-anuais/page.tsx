import { redirect } from "next/navigation";

import { ComparativosAnuaisView } from "@/components/app/comparativos-anuais-view";
import { getCurrentSessionContext } from "@/lib/auth/session";
import { readActiveCompanyIds, readActiveSegmentSlug } from "@/lib/context/active-context";
import { resolveUserSegments } from "@/lib/context/user-segments";
import { resolveFranquiasVivaCustosNegation } from "@/lib/dashboard/franquias-viva-custos";
import {
  buildDashboardRows,
  buildDateRange,
  buildFilterState,
  buildVisibleBuckets,
  fetchAllDreAccountRows,
  scopeDreAccounts,
  resolveAllowedCompanyIds,
  type DreAccountBase,
  type DashboardPeriodBucket,
} from "@/lib/dashboard/dre";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Record<string, string | string[] | undefined>;
  params?: { segmentSlug?: string };
}

export interface ComparativoDisplayRow extends DreAccountBase {
  hasChildren: boolean;
  realizado: number;
  orcado: number;
  anoAnterior: number;
}

export default async function ComparativosAnuaisPage({ searchParams, params }: PageProps) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user) {
    redirect("/login");
  }
  // Tela admin-only (menu e rota).
  if (profile?.role !== "admin") {
    redirect("/home");
  }

  const segments = await resolveUserSegments(supabase, {
    isAdmin: profile?.role === "admin",
    userId: profile?.id ?? null,
    companyIds: profile?.company_ids ?? [],
  });

  let segmentId: string | null = null;
  let activeSegmentSlug = params?.segmentSlug ?? null;
  if (!activeSegmentSlug) {
    const cookieSlug = await readActiveSegmentSlug();
    if (cookieSlug && segments.some((s) => s.slug === cookieSlug)) {
      activeSegmentSlug = cookieSlug;
    } else {
      activeSegmentSlug = segments[0]?.slug ?? null;
    }
  }
  if (activeSegmentSlug) {
    segmentId = segments.find((s) => s.slug === activeSegmentSlug)?.id ?? null;
  }

  let companiesQuery = supabase.from("companies").select("id,name,active").eq("active", true);
  if (segmentId) companiesQuery = companiesQuery.eq("segment_id", segmentId);
  const { data: companiesData } = await companiesQuery.order("name");
  const companies = (companiesData ?? []).map((c) => ({ id: c.id as string, name: c.name as string }));

  const scopeCompanyIds = companies.map((c) => c.id);
  const accountsData = await fetchAllDreAccountRows<DreAccountBase & { company_id: string | null }>((from, to) => {
    let query = supabase
      .from("dre_accounts")
      .select("id,code,name,parent_id,level,type,is_summary,formula,sort_order,active,company_id")
      .eq("active", true);
    if (segmentId) {
      query =
        scopeCompanyIds.length > 0
          ? query.or(`company_id.is.null,company_id.in.(${scopeCompanyIds.join(",")})`)
          : query.is("company_id", null);
    }
    return query.order("code").range(from, to);
  });

  const allowedCompanyIds = await resolveAllowedCompanyIds(
    supabase,
    profile,
    companies.map((c) => c.id),
  );
  const visibleCompanies =
    profile?.role === "admin" ? companies : companies.filter((c) => allowedCompanyIds.includes(c.id));

  const filter = buildFilterState(searchParams, allowedCompanyIds);
  if (!searchParams.companyIds) {
    const cookieCompanyIds = (await readActiveCompanyIds()).filter((id) => allowedCompanyIds.includes(id));
    if (cookieCompanyIds.length > 0) filter.selectedCompanyIds = cookieCompanyIds;
  }
  if (profile?.role !== "admin") {
    filter.selectedCompanyIds =
      allowedCompanyIds.length > 0
        ? filter.selectedCompanyIds.filter((id) => allowedCompanyIds.includes(id))
        : allowedCompanyIds;
    if (filter.selectedCompanyIds.length === 0) filter.selectedCompanyIds = allowedCompanyIds;
  }

  const range = buildDateRange(filter);
  // Mesmo período, um ano antes.
  const priorFilter = { ...filter, yearFrom: filter.yearFrom - 1, yearTo: filter.yearTo - 1 };
  const priorRange = buildDateRange(priorFilter);

  const currentBucket: DashboardPeriodBucket = {
    key: "cur",
    label: range.label,
    dateFrom: range.dateFrom,
    dateTo: range.dateTo,
  };
  const priorBucket: DashboardPeriodBucket = {
    key: "prior",
    label: priorRange.label,
    dateFrom: priorRange.dateFrom,
    dateTo: priorRange.dateTo,
  };

  const commonViewProps = {
    filter,
    range,
    priorRange,
    companies: visibleCompanies,
    selectedCompanyIds: filter.selectedCompanyIds,
    currentBucket,
    priorBucket,
    segments,
    activeSegmentSlug,
  };

  const visibleBuckets = buildVisibleBuckets(filter);
  if (filter.selectedCompanyIds.length === 0 || visibleBuckets.length === 0) {
    return <ComparativosAnuaisView {...commonViewProps} rows={[]} />;
  }

  const scope = scopeDreAccounts(accountsData, filter.selectedCompanyIds);
  const accounts = scope.coreAccounts;
  const custosNegation = resolveFranquiasVivaCustosNegation(activeSegmentSlug, accounts);

  const aggregate = async (rpcName: string, dateFrom: string, dateTo: string) => {
    const { data, error } = await supabase.rpc(rpcName, {
      p_company_ids: filter.selectedCompanyIds,
      p_date_from: dateFrom,
      p_date_to: dateTo,
    });
    if (error) throw new Error(`Falha ao carregar ${rpcName}: ${error.message}`);
    const amounts = new Map<string, number>();
    ((data as Array<{ dre_account_id: string; amount: number | string | null }> | null) ?? []).forEach((item) => {
      const scopedId = scope.translateToScopedId(item.dre_account_id);
      if (!scopedId) return;
      amounts.set(scopedId, (amounts.get(scopedId) ?? 0) + Number(item.amount ?? 0));
    });
    return buildDashboardRows(accounts, amounts, { negateChildCodesInSummary: custosNegation }).rows;
  };

  const [realizadoRows, orcadoRows, anoAnteriorRows] = await Promise.all([
    aggregate("dashboard_dre_aggregate", currentBucket.dateFrom, currentBucket.dateTo),
    aggregate("budget_aggregate", currentBucket.dateFrom, currentBucket.dateTo),
    aggregate("dashboard_dre_aggregate", priorBucket.dateFrom, priorBucket.dateTo),
  ]);

  const realMap: Record<string, number> = {};
  realizadoRows.forEach((r) => { realMap[r.id] = r.value; });
  const budMap: Record<string, number> = {};
  orcadoRows.forEach((r) => { budMap[r.id] = r.value; });
  const priorMap: Record<string, number> = {};
  anoAnteriorRows.forEach((r) => { priorMap[r.id] = r.value; });

  const zeroRows = buildDashboardRows(accounts, new Map(), { negateChildCodesInSummary: custosNegation }).rows;
  const rows: ComparativoDisplayRow[] = zeroRows.map((row) => ({
    ...row,
    realizado: realMap[row.id] ?? 0,
    orcado: budMap[row.id] ?? 0,
    anoAnterior: priorMap[row.id] ?? 0,
  }));

  return <ComparativosAnuaisView {...commonViewProps} rows={rows} />;
}
