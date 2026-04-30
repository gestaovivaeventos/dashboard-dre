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
  const startDateRaw = url.searchParams.get("startDate");
  const mode = url.searchParams.get("mode") ?? "compare"; // "compare" | "projecao"
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
  const startDate = startDateRaw
    ? new Date(`${startDateRaw}T00:00:00Z`)
    : new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth() - 11, 1));

  // Build month ranges from startDate (first of month) to endDate (inclusive of its month).
  const ranges: Array<{ dateFrom: string; dateTo: string; label: string }> = [];
  let cursor = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1));
  const last = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), 1));
  while (cursor.getTime() <= last.getTime()) {
    ranges.push(monthRange(cursor));
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }

  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1;

  const points = await Promise.all(
    ranges.map(async (range) => {
      const rangeYear = Number(range.label.split("/")[1]);
      const rangeMonth = Number(range.label.split("/")[0]);
      const isFuture = rangeYear > currentYear || (rangeYear === currentYear && rangeMonth > currentMonth);

      if (mode === "projecao") {
        // Single combined series: realized for past/current months, budget for future months.
        const rpc = isFuture ? "budget_aggregate" : "dashboard_dre_aggregate";
        const { data, error } = await supabase.rpc(rpc, {
          p_company_ids: scopedCompanyIds,
          p_date_from: range.dateFrom,
          p_date_to: range.dateTo,
        });
        if (error) throw new Error(error.message);
        const amounts = new Map<string, number>();
        ((data as Array<{ dre_account_id: string; amount: number | string | null }> | null) ?? []).forEach((row) => {
          amounts.set(row.dre_account_id, Number(row.amount ?? 0));
        });
        const builtRows = buildDashboardRows(accounts, amounts).rows;
        const selected = builtRows.find((r) => r.id === accountId);
        return {
          label: range.label,
          valor: selected?.value ?? 0,
          tipo: isFuture ? "Orcamento" : "Realizado",
        };
      }

      const [{ data: realizedData, error: realizedErr }, { data: budgetData, error: budgetErr }] = await Promise.all([
        supabase.rpc("dashboard_dre_aggregate", {
          p_company_ids: scopedCompanyIds,
          p_date_from: range.dateFrom,
          p_date_to: range.dateTo,
        }),
        supabase.rpc("budget_aggregate", {
          p_company_ids: scopedCompanyIds,
          p_date_from: range.dateFrom,
          p_date_to: range.dateTo,
        }),
      ]);
      if (realizedErr) throw new Error(realizedErr.message);
      if (budgetErr) throw new Error(budgetErr.message);

      const realizedAmounts = new Map<string, number>();
      ((realizedData as Array<{ dre_account_id: string; amount: number | string | null }> | null) ?? []).forEach((row) => {
        realizedAmounts.set(row.dre_account_id, Number(row.amount ?? 0));
      });
      const budgetAmounts = new Map<string, number>();
      ((budgetData as Array<{ dre_account_id: string; amount: number | string | null }> | null) ?? []).forEach((row) => {
        budgetAmounts.set(row.dre_account_id, Number(row.amount ?? 0));
      });

      const realizedRows = buildDashboardRows(accounts, realizedAmounts).rows;
      const budgetRows = buildDashboardRows(accounts, budgetAmounts).rows;
      const realizedRow = realizedRows.find((r) => r.id === accountId);
      const budgetRow = budgetRows.find((r) => r.id === accountId);

      return {
        label: range.label,
        realizado: realizedRow?.value ?? 0,
        previsto: budgetRow?.value ?? 0,
      };
    }),
  );

  return NextResponse.json({ points });
}
