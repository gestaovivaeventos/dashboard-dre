// Drilldown da seção "Custódia de Artistas - Análise Competência" (Case Shows).
// Lê os lançamentos por DATA DE REGISTRO (tabela case_shows_custody_competencia_
// entries, alimentada pela ingestão dedicada) — NÃO usa financial_entries, que é
// regime de caixa e não reproduz o relatório por data de registro.

import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { resolveAllowedCompanyIds } from "@/lib/dashboard/cash-flow";

export async function GET(request: Request) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }

  const url = new URL(request.url);
  const companyId = url.searchParams.get("companyId");
  const codes = (url.searchParams.get("codes") ?? "").split(",").map((c) => c.trim()).filter(Boolean);
  const dateFrom = url.searchParams.get("dateFrom");
  const dateTo = url.searchParams.get("dateTo");
  const search = url.searchParams.get("search") ?? "";
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"));
  const pageSize = Math.min(100, Math.max(5, Number(url.searchParams.get("pageSize") ?? "20")));
  const offset = (page - 1) * pageSize;

  if (!companyId || !dateFrom || !dateTo || codes.length === 0) {
    return NextResponse.json(
      { error: "Parametros obrigatorios: companyId, dateFrom, dateTo, codes." },
      { status: 400 },
    );
  }

  // Controle de acesso: o usuário precisa ter acesso à empresa solicitada.
  const { data: companiesData } = await supabase.from("companies").select("id,name");
  const allCompanyIds = (companiesData ?? []).map((company) => company.id as string);
  const allowedCompanyIds = await resolveAllowedCompanyIds(supabase, profile, allCompanyIds);
  if (!allowedCompanyIds.includes(companyId)) {
    return NextResponse.json({ rows: [], page, pageSize, total: 0, totalPages: 0, totalValue: 0 });
  }

  const { data, error } = await supabase.rpc("case_shows_custody_competencia_drilldown", {
    p_company_id: companyId,
    p_category_codes: codes,
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
          entry_id: string;
          registration_date: string;
          description: string | null;
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
    id: row.entry_id as string,
    // Reaproveita o campo payment_date do painel de drilldown para a data de
    // registro — o cabeçalho da coluna troca o rótulo conforme o modo.
    payment_date: row.registration_date as string,
    description: (row.description as string | null) ?? "",
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

  return NextResponse.json({ rows, page, pageSize, total, totalPages, totalValue });
}
