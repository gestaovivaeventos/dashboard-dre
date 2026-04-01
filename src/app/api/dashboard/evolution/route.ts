import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";
import {
  buildDashboardRows,
  filterCoreDreAccounts,
  resolveAllowedCompanyIds,
  type DreAccountBase,
} from "@/lib/dashboard/dre";

function monthRange(date: Date) {
  const from = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const to = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
  return {
    dateFrom: from.toISOString().slice(0, 10),
    dateTo: to.toISOString().slice(0, 10),
    label: `${String(from.getUTCMonth() + 1).padStart(2, "0")}/${from.getUTCFullYear()}`,
  };
}

export async function GET(request: Request) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }

  const url = new URL(request.url);
  const accountId = url.searchParams.get("accountId");
  const endDateRaw = url.searchParams.get("endDate");
  const requestedCompanyIds = url.searchParams.get("companyIds")?.split(",").filter(Boolean) ?? [];
  if (!accountId || !endDateRaw) {
    return NextResponse.json({ error: "Parametros obrigatorios: accountId e endDate." }, { status: 400 });
  }

  const [{ data: companiesData }, { data: accountsData }] = await Promise.all([
    supabase.from("companies").select("id,name,active").eq("active", true).order("name"),
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
  const scopedCompanyIds =
    requestedCompanyIds.length > 0
      ? requestedCompanyIds.filter((id) => allowedCompanyIds.includes(id))
      : allowedCompanyIds;
  if (scopedCompanyIds.length === 0) {
    return NextResponse.json({ points: [] });
  }

  const accounts = filterCoreDreAccounts((accountsData ?? []) as DreAccountBase[]);
  const endDate = new Date(`${endDateRaw}T00:00:00Z`);
  const ranges = Array.from({ length: 12 }).map((_, index) =>
    monthRange(new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth() - (11 - index), 1))),
  );

  const points = await Promise.all(
    ranges.map(async (range) => {
      const { data, error } = await supabase.rpc("dashboard_dre_aggregate_by_company", {
        p_company_ids: scopedCompanyIds,
        p_date_from: range.dateFrom,
        p_date_to: range.dateTo,
      });
      if (error) {
        throw new Error(error.message);
      }

      const byCompany = new Map<string, Map<string, number>>();
      (
        data as Array<{ company_id: string; dre_account_id: string; amount: number | string | null }> | null
      ?? []
      ).forEach((row) => {
        const map = byCompany.get(row.company_id) ?? new Map<string, number>();
        map.set(row.dre_account_id, Number(row.amount ?? 0));
        byCompany.set(row.company_id, map);
      });

      const point: Record<string, string | number> = { label: range.label };
      scopedCompanyIds.forEach((companyId) => {
        const map = byCompany.get(companyId) ?? new Map<string, number>();
        const rows = buildDashboardRows(accounts, map).rows;
        const selected = rows.find((row) => row.id === accountId);
        point[companyId] = selected?.value ?? 0;
      });
      return point;
    }),
  );

  return NextResponse.json({
    points,
    companies: companies.filter((company) => scopedCompanyIds.includes(company.id)),
  });
}
