import { redirect } from "next/navigation";

import { KpiAllView } from "@/components/app/kpi-all-view";
import { getCurrentSessionContext } from "@/lib/auth/session";
import { readActiveSegmentSlug } from "@/lib/context/active-context";

export const dynamic = "force-dynamic";
import {
  buildDateRange,
  buildFilterState,
  fetchAllDreAccountRows,
  resolveAllowedCompanyIds,
  type DreAccountBase,
} from "@/lib/dashboard/dre";
import {
  buildAccountValuesByCompany,
  evaluateKpiValue,
  type KpiDefinition,
} from "@/lib/kpi/calc";

interface KpisPageProps {
  searchParams: Record<string, string | string[] | undefined>;
  params?: { segmentSlug?: string };
}

export default async function KpisPage({ searchParams, params }: KpisPageProps) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user) {
    redirect("/login");
  }

  // URL `/s/<slug>/kpis` traz pelo params; `/kpis` (sem segmento) recorre ao
  // cookie `active_segment_slug` — sem isso companies de outros segmentos
  // entram na agregação e contaminam os KPIs.
  let segmentId: string | null = null;
  const activeSegmentSlug =
    params?.segmentSlug ?? (await readActiveSegmentSlug()) ?? null;
  if (activeSegmentSlug) {
    const { data: seg } = await supabase
      .from("segments")
      .select("id")
      .eq("slug", activeSegmentSlug)
      .eq("active", true)
      .maybeSingle<{ id: string }>();
    segmentId = seg?.id ?? null;
  }

  let companiesQuery = supabase.from("companies").select("id,name,active").eq("active", true);
  if (segmentId) {
    companiesQuery = companiesQuery.eq("segment_id", segmentId);
  }

  const [{ data: companiesData }, accountsData, { data: kpisData }] = await Promise.all([
    companiesQuery.order("name"),
    // Paginado: o cap de 1000 do PostgREST truncava os codes "8"/"9" (ver fetchAllDreAccountRows).
    fetchAllDreAccountRows<Pick<DreAccountBase, "id" | "code">>((from, to) =>
      supabase.from("dre_accounts").select("id,code").eq("active", true).order("code").range(from, to),
    ),
    supabase
      .from("kpi_definitions")
      .select(
        "id,name,description,formula_type,numerator_account_codes,denominator_account_codes,multiply_by,sort_order,active",
      )
      .eq("active", true)
      .order("sort_order", { ascending: true }),
  ]);

  const companies = (companiesData ?? []).map((company) => ({
    id: company.id as string,
    name: company.name as string,
  }));
  const accountCodeById = new Map(
    accountsData.map((account) => [account.id, account.code]),
  );
  const kpis = ((kpisData ?? []) as KpiDefinition[]) ?? [];
  if (kpis.length === 0) {
    return <div className="rounded-xl border bg-background p-4">Nenhum KPI ativo cadastrado.</div>;
  }

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
  // If no companies selected, render empty state
  if (filter.selectedCompanyIds.length === 0) {
    return (
      <KpiAllView
        filter={filter}
        range={{ dateFrom: "", dateTo: "", label: "" }}
        kpiCards={[]}
        companies={visibleCompanies}
        role={profile?.role ?? "gestor_hero"}
        selectedCompanyIds={[]}
      />
    );
  }

  const range = buildDateRange(filter);

  // Aggregate by company for the period
  const { data: aggregateData, error: aggregateError } = await supabase.rpc(
    "dashboard_dre_aggregate_by_company",
    {
      p_company_ids: filter.selectedCompanyIds,
      p_date_from: range.dateFrom,
      p_date_to: range.dateTo,
    },
  );
  if (aggregateError) {
    throw new Error(`Falha ao carregar KPIs: ${aggregateError.message}`);
  }

  const valuesByCompany = buildAccountValuesByCompany(
    (aggregateData ?? []) as Array<{ company_id: string; dre_account_id: string; amount: number }>,
    accountCodeById,
  );

  // Compute consolidated account values (sum across all selected companies)
  const consolidatedValues = new Map<string, number>();
  for (const [, companyMap] of Array.from(valuesByCompany)) {
    for (const [code, value] of Array.from(companyMap)) {
      consolidatedValues.set(code, (consolidatedValues.get(code) ?? 0) + value);
    }
  }

  // Compute each KPI value
  const kpiCards = kpis.map((kpi) => ({
    id: kpi.id,
    name: kpi.name,
    description: kpi.description,
    formula_type: kpi.formula_type,
    value: evaluateKpiValue(kpi, consolidatedValues),
  }));

  return (
    <KpiAllView
      filter={filter}
      range={range}
      kpiCards={kpiCards}
      companies={visibleCompanies}
      role={profile?.role ?? "gestor_hero"}
      selectedCompanyIds={filter.selectedCompanyIds}
    />
  );
}
