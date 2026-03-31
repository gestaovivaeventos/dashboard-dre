import { redirect } from "next/navigation";

import { KpiAllView } from "@/components/app/kpi-all-view";
import { getCurrentSessionContext } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
import {
  buildDateRange,
  buildFilterState,
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

  const [{ data: companiesData }, { data: accountsData }, { data: kpisData }] = await Promise.all([
    companiesQuery.order("name"),
    supabase.from("dre_accounts").select("id,code").eq("active", true),
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
    ((accountsData ?? []) as Pick<DreAccountBase, "id" | "code">[]).map((account) => [
      account.id,
      account.code,
    ]),
  );
  const kpis = ((kpisData ?? []) as KpiDefinition[]) ?? [];
  if (kpis.length === 0) {
    return <div className="rounded-xl border bg-background p-4">Nenhum KPI ativo cadastrado.</div>;
  }

  const allowedCompanyIds = resolveAllowedCompanyIds(
    profile,
    companies.map((company) => company.id),
  );
  const filter = buildFilterState(searchParams, allowedCompanyIds);
  if (profile?.role === "gestor_unidade") {
    filter.selectedCompanyIds = allowedCompanyIds;
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
      companies={companies.filter((c) => allowedCompanyIds.includes(c.id))}
      role={profile?.role ?? "gestor_hero"}
      selectedCompanyIds={filter.selectedCompanyIds}
    />
  );
}
