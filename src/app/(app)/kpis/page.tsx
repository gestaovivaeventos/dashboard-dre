import { redirect } from "next/navigation";

import { KpiRankingView } from "@/components/app/kpi-ranking-view";
import { getCurrentSessionContext } from "@/lib/auth/session";
import {
  buildDateRange,
  buildFilterState,
  resolveAllowedCompanyIds,
  type DreAccountBase,
} from "@/lib/dashboard/dre";
import {
  buildAccountValuesByCompany,
  buildLastSixMonthRanges,
  evaluateKpiValue,
  median,
  type KpiDefinition,
} from "@/lib/kpi/calc";

interface KpisPageProps {
  searchParams: Record<string, string | string[] | undefined>;
}

export default async function KpisPage({ searchParams }: KpisPageProps) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user) {
    redirect("/login");
  }

  const [{ data: companiesData }, { data: accountsData }, { data: kpisData }] = await Promise.all([
    supabase.from("companies").select("id,name,active").eq("active", true).order("name"),
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
  const range = buildDateRange(filter);
  const selectedKpiId = (searchParams.kpiId as string | undefined) ?? kpis[0].id;
  const selectedKpi = kpis.find((kpi) => kpi.id === selectedKpiId) ?? kpis[0];

  const { data: aggregateData, error: aggregateError } = await supabase.rpc(
    "dashboard_dre_aggregate_by_company",
    {
      p_company_ids: companies.map((company) => company.id),
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

  const monthlyRanges = buildLastSixMonthRanges(range.dateTo);
  const monthlyAggregates = await Promise.all(
    monthlyRanges.map(async (monthRange) => {
      const { data, error } = await supabase.rpc("dashboard_dre_aggregate_by_company", {
        p_company_ids: companies.map((company) => company.id),
        p_date_from: monthRange.dateFrom,
        p_date_to: monthRange.dateTo,
      });
      if (error) throw new Error(error.message);
      return buildAccountValuesByCompany(
        (data ?? []) as Array<{ company_id: string; dre_account_id: string; amount: number }>,
        accountCodeById,
      );
    }),
  );

  const rows = companies.map((company) => {
    const companyValues = valuesByCompany.get(company.id) ?? new Map<string, number>();
    const value = evaluateKpiValue(selectedKpi, companyValues);
    const sparkline = monthlyAggregates.map((monthMap) =>
      evaluateKpiValue(selectedKpi, monthMap.get(company.id) ?? new Map<string, number>()),
    );
    return {
      companyId: company.id,
      companyName: company.name,
      value,
      sparkline,
      isCurrentUserCompany: profile?.company_id === company.id,
    };
  });

  const statsValues = rows.map((row) => row.value);
  const average = statsValues.length > 0 ? statsValues.reduce((sum, value) => sum + value, 0) / statsValues.length : 0;
  const med = median(statsValues);

  return (
    <KpiRankingView
      filter={filter}
      kpis={kpis}
      selectedKpiId={selectedKpi.id}
      rows={rows}
      average={average}
      median={med}
      role={profile?.role ?? "gestor_hero"}
    />
  );
}
