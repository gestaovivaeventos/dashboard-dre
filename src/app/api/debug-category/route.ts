import { NextResponse } from "next/server";
import { getCurrentSessionContext } from "@/lib/auth/session";

export async function GET(request: Request) {
  const { supabase, user } = await getCurrentSessionContext();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  const url = new URL(request.url);
  let companyId = url.searchParams.get("companyId");
  const companyName = url.searchParams.get("name");
  const codeParam = url.searchParams.get("code");
  const descParam = url.searchParams.get("desc");
  const monthParam = url.searchParams.get("month") ?? "2026-01";
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");

  if (!companyId && companyName) {
    const { data: found } = await supabase
      .from("companies")
      .select("id,name,active")
      .ilike("name", `%${companyName}%`);
    if (!found || found.length === 0) {
      const { data: all } = await supabase
        .from("companies")
        .select("id,name,active")
        .order("name");
      return NextResponse.json(
        {
          error: `Nenhuma empresa encontrada com nome contendo "${companyName}".`,
          available_companies: all,
        },
        { status: 404 },
      );
    }
    if (found.length > 1) {
      return NextResponse.json(
        {
          error: `Múltiplas empresas encontradas com "${companyName}". Use ?companyId=<uuid>`,
          matches: found,
        },
        { status: 400 },
      );
    }
    companyId = found[0].id as string;
  }
  if (!companyId) {
    return NextResponse.json({ error: "Informe companyId ou name" }, { status: 400 });
  }

  // Range de datas: ?from=YYYY-MM-DD&to=YYYY-MM-DD ou ?month=YYYY-MM
  let dateFrom: string;
  let dateTo: string;
  if (fromParam && toParam) {
    dateFrom = fromParam;
    dateTo = toParam;
  } else {
    const [year, month] = monthParam.split("-").map(Number);
    dateFrom = `${year}-${String(month).padStart(2, "0")}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    dateTo = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  }

  // 1) omie_categories: localiza códigos da empresa que batem com code OU descrição
  let catalogQuery = supabase
    .from("omie_categories")
    .select("code,description,company_id")
    .eq("company_id", companyId);
  if (codeParam) catalogQuery = catalogQuery.eq("code", codeParam);
  if (descParam) catalogQuery = catalogQuery.ilike("description", `%${descParam}%`);

  const { data: catalogRows } = await catalogQuery.order("code");
  const candidateCodes = Array.from(
    new Set((catalogRows ?? []).map((r) => r.code as string)),
  );

  // 2) Mapeamentos para esses codes (empresa + global)
  const { data: mappingRows } = candidateCodes.length > 0
    ? await supabase
        .from("category_mapping")
        .select("id,omie_category_code,omie_category_name,dre_account_id,company_id")
        .in("omie_category_code", candidateCodes)
        .or(`company_id.eq.${companyId},company_id.is.null`)
    : { data: [] as Array<Record<string, unknown>> };

  // 3) Resolve dre_accounts envolvidas
  const dreIds = Array.from(
    new Set((mappingRows ?? []).map((m) => m.dre_account_id as string).filter(Boolean)),
  );
  const { data: dreAccData } = dreIds.length > 0
    ? await supabase
        .from("dre_accounts")
        .select("id,code,name,is_summary,parent_id,active")
        .in("id", dreIds)
    : { data: [] as Array<Record<string, unknown>> };
  const dreById = new Map(
    (dreAccData ?? []).map((a) => [
      a.id as string,
      {
        code: a.code as string,
        name: a.name as string,
        is_summary: a.is_summary as boolean,
        parent_id: a.parent_id as string | null,
        active: a.active as boolean,
      },
    ]),
  );

  // 4) Entries no período para os candidate codes
  const { data: entryRows } = candidateCodes.length > 0
    ? await supabase
        .from("financial_entries")
        .select(
          "id,omie_id,category_code,value,payment_date,description,supplier_customer,type",
        )
        .eq("company_id", companyId)
        .in("category_code", candidateCodes)
        .gte("payment_date", dateFrom)
        .lte("payment_date", dateTo)
        .order("payment_date")
    : { data: [] as Array<Record<string, unknown>> };

  // 5) Total de entries (período inteiro, sem filtro de data) para cada code — só pra
  //    saber se existem fora da janela.
  const { data: allTimeRows } = candidateCodes.length > 0
    ? await supabase
        .from("financial_entries")
        .select("category_code,value,payment_date")
        .eq("company_id", companyId)
        .in("category_code", candidateCodes)
    : { data: [] as Array<Record<string, unknown>> };

  const allTimeByCode = new Map<
    string,
    { count: number; sum: number; minDate: string; maxDate: string }
  >();
  (allTimeRows ?? []).forEach((r) => {
    const c = r.category_code as string;
    const cur = allTimeByCode.get(c) ?? {
      count: 0,
      sum: 0,
      minDate: "9999-12-31",
      maxDate: "0000-01-01",
    };
    cur.count += 1;
    cur.sum += Number(r.value ?? 0);
    const d = r.payment_date as string;
    if (d < cur.minDate) cur.minDate = d;
    if (d > cur.maxDate) cur.maxDate = d;
    allTimeByCode.set(c, cur);
  });

  // 6) RPC dashboard_dre_aggregate filtrado nas dre_accounts envolvidas
  const { data: rpcData } = await supabase.rpc("dashboard_dre_aggregate", {
    p_company_ids: [companyId],
    p_date_from: dateFrom,
    p_date_to: dateTo,
  });
  const rpcRelevant = ((rpcData ?? []) as Array<{
    dre_account_id: string;
    amount: number;
  }>)
    .filter((r) => dreById.has(r.dre_account_id))
    .map((r) => ({
      dre_account_id: r.dre_account_id,
      dre_code: dreById.get(r.dre_account_id)?.code ?? null,
      dre_name: dreById.get(r.dre_account_id)?.name ?? null,
      amount: r.amount,
    }));

  return NextResponse.json({
    companyId,
    period: { dateFrom, dateTo },
    queryFilters: { code: codeParam, desc: descParam },
    omie_categories: (catalogRows ?? []).map((r) => ({
      code: r.code,
      description: r.description,
      all_time: allTimeByCode.get(r.code as string) ?? null,
    })),
    category_mappings: (mappingRows ?? []).map((m) => ({
      id: m.id,
      omie_category_code: m.omie_category_code,
      omie_category_name: m.omie_category_name,
      company_id: m.company_id,
      scope: (m.company_id as string | null) === null ? "global" : "company",
      dre_account_id: m.dre_account_id,
      dre_code: dreById.get(m.dre_account_id as string)?.code ?? null,
      dre_name: dreById.get(m.dre_account_id as string)?.name ?? null,
      dre_is_summary: dreById.get(m.dre_account_id as string)?.is_summary ?? null,
      dre_active: dreById.get(m.dre_account_id as string)?.active ?? null,
    })),
    entries_in_period: {
      count: (entryRows ?? []).length,
      sum: (entryRows ?? []).reduce((s, e) => s + Number(e.value ?? 0), 0),
      rows: (entryRows ?? []).map((e) => ({
        omie_id: e.omie_id,
        category_code: e.category_code,
        type: e.type,
        value: e.value,
        payment_date: e.payment_date,
        supplier_customer: e.supplier_customer,
        desc: String(e.description ?? "").slice(0, 100),
      })),
    },
    rpc_aggregate_relevant_accounts: rpcRelevant,
  });
}
