import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { resolveAllowedCompanyIds } from "@/lib/dashboard/dre";

export async function GET(request: Request) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }

  const url = new URL(request.url);
  const accountId = url.searchParams.get("accountId");
  const dateFrom = url.searchParams.get("dateFrom");
  const dateTo = url.searchParams.get("dateTo");
  const search = url.searchParams.get("search") ?? "";
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"));
  const pageSize = Math.min(100, Math.max(5, Number(url.searchParams.get("pageSize") ?? "20")));
  const offset = (page - 1) * pageSize;
  const requestedCompanyIds =
    url.searchParams.get("companyIds")?.split(",").filter(Boolean) ?? [];

  if (!accountId || !dateFrom || !dateTo) {
    return NextResponse.json(
      { error: "Parametros obrigatorios: accountId, dateFrom, dateTo." },
      { status: 400 },
    );
  }

  const { data: companiesData } = await supabase.from("companies").select("id");
  const allCompanyIds = (companiesData ?? []).map((company) => company.id as string);
  const allowedCompanyIds = await resolveAllowedCompanyIds(supabase, profile, allCompanyIds);
  const scopedCompanyIds =
    requestedCompanyIds.length > 0
      ? requestedCompanyIds.filter((id) => allowedCompanyIds.includes(id))
      : allowedCompanyIds;

  if (scopedCompanyIds.length === 0) {
    return NextResponse.json({
      rows: [],
      page,
      pageSize,
      total: 0,
      totalPages: 0,
      totalValue: 0,
    });
  }

  const { data, error } = await supabase.rpc("dashboard_dre_drilldown", {
    p_dre_account_id: accountId,
    p_company_ids: scopedCompanyIds,
    p_date_from: dateFrom,
    p_date_to: dateTo,
    p_search: search,
    p_limit: pageSize,
    p_offset: offset,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const rows = (
    data as
      | Array<{
          financial_entry_id: string;
          payment_date: string;
          description: string;
          supplier_customer: string | null;
          document_number: string | null;
          value: number | string | null;
          company_id: string;
          company_name: string;
          total_count: number | string | null;
        }>
      | null
  ?? []
  ).map((row) => ({
    id: row.financial_entry_id as string,
    payment_date: row.payment_date as string,
    description: row.description as string,
    supplier_customer: (row.supplier_customer as string | null) ?? "",
    document_number: (row.document_number as string | null) ?? "",
    value: Number(row.value ?? 0),
    company_id: row.company_id as string,
    company_name: row.company_name as string,
    total_count: Number(row.total_count ?? 0),
  }));
  const total = rows[0]?.total_count ?? 0;
  const totalPages = total > 0 ? Math.ceil(total / pageSize) : 0;
  const totalValue = rows.reduce((sum, row) => sum + row.value, 0);

  return NextResponse.json({
    rows,
    page,
    pageSize,
    total,
    totalPages,
    totalValue,
  });
}
