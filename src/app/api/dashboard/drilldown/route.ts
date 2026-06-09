import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { resolveAllowedCompanyIds } from "@/lib/dashboard/dre";
import { getManagerialDrilldownRows } from "@/lib/dashboard/managerial-adjustments";

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

  const { data: companiesData } = await supabase.from("companies").select("id,name");
  const allCompanyIds = (companiesData ?? []).map((company) => company.id as string);
  const companyNameById = new Map(
    (companiesData ?? []).map((company) => [company.id as string, company.name as string]),
  );
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
      aggregateTotal: 0,
    });
  }

  // Resolve o `code` da conta clicada (estável entre planos custom/global).
  const targetCode = await (async () => {
    const { data } = await supabase
      .from("dre_accounts")
      .select("code")
      .eq("id", accountId)
      .maybeSingle<{ code: string }>();
    return data?.code ?? null;
  })();

  // Linhas gerenciais (ex.: VJF "12. Margens Ensino Médio") não têm
  // category_mapping — o drilldown vem da camada de ajuste gerencial, não do
  // RPC. Só dispara para a empresa configurada (ver managerial-adjustments.ts).
  const managerial = getManagerialDrilldownRows({
    companyIds: scopedCompanyIds,
    code: targetCode,
    companyName: companyNameById.get(scopedCompanyIds[0]) ?? "",
    dateFrom,
    dateTo,
    search,
    page,
    pageSize,
  });
  if (managerial) {
    return NextResponse.json(managerial);
  }

  // Roda em paralelo:
  // 1) Pagina pedida do drilldown (pra exibir).
  // 2) Total agregado da MESMA conta no MESMO periodo, mesma snapshot.
  //    Esse aggregateTotal e a "verdade canonica" do que a celula da DRE
  //    DEVE estar mostrando agora. O cliente compara com o valor renderizado
  //    e, se diferirem, mostra alerta + botao para atualizar — garantindo
  //    que dashboard e drilldown nunca exibam totais conflitantes ao usuario.
  const [drillResult, aggregateResult] = await Promise.all([
    supabase.rpc("dashboard_dre_drilldown", {
      p_dre_account_id: accountId,
      p_company_ids: scopedCompanyIds,
      p_date_from: dateFrom,
      p_date_to: dateTo,
      p_search: search,
      p_limit: pageSize,
      p_offset: offset,
    }),
    supabase.rpc("dashboard_dre_aggregate", {
      p_company_ids: scopedCompanyIds,
      p_date_from: dateFrom,
      p_date_to: dateTo,
    }),
  ]);

  if (drillResult.error) {
    return NextResponse.json({ error: drillResult.error.message }, { status: 400 });
  }

  const omieRows = (
    drillResult.data as
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
  // `total`/`totalPages` contam apenas os LANCAMENTOS da Omie (paginados pelo
  // RPC). A linha-base do Google Sheets (injetada abaixo) e um resumo fixado,
  // nao um lancamento.
  const total = omieRows[0]?.total_count ?? 0;
  const totalPages = total > 0 ? Math.ceil(total / pageSize) : 0;

  // Linhas alimentadas por Google Sheets (`dre_accounts.data_source = 'sheets'`
  // — hoje exclusivas da Feat Producoes) compoem o valor final como
  // planilha + Omie elegivel. O drilldown ja lista os lancamentos da Omie
  // elegiveis (RPC casa por `code`, sem filtro de data_source, aplicando a regra
  // de projeto). Aqui acrescentamos UMA linha-base sintetica deixando explicito
  // quanto veio da planilha, para o detalhamento reconciliar com o total da DRE.
  // So na 1a pagina; gated por data_source='sheets' (inerte nas demais linhas).
  let sheetsBaseValue = 0;
  if (targetCode) {
    const { data: sheetAccounts } = await supabase
      .from("dre_accounts")
      .select("id")
      .eq("code", targetCode)
      .eq("data_source", "sheets")
      .in("company_id", scopedCompanyIds);
    const sheetAccountIds = (sheetAccounts ?? []).map((r) => r.id as string);
    if (sheetAccountIds.length > 0) {
      const { data: manualValues } = await supabase
        .from("manual_account_values")
        .select("valor,ano,mes")
        .in("dre_account_id", sheetAccountIds)
        .in("company_id", scopedCompanyIds);
      // Mesma janela de meses usada nas RPCs de agregacao (mes de dateFrom..dateTo).
      const fromKey = Number(dateFrom.slice(0, 4)) * 12 + Number(dateFrom.slice(5, 7)) - 1;
      const toKey = Number(dateTo.slice(0, 4)) * 12 + Number(dateTo.slice(5, 7)) - 1;
      sheetsBaseValue = (manualValues ?? []).reduce((sum, r) => {
        const key = Number(r.ano) * 12 + Number(r.mes) - 1;
        return key >= fromKey && key <= toKey ? sum + Number(r.valor ?? 0) : sum;
      }, 0);
    }
  }

  const rows = [...omieRows];
  if (sheetsBaseValue !== 0 && page === 1) {
    rows.unshift({
      id: `sheets-base-${targetCode}`,
      payment_date: dateTo,
      description: "Valor base (Google Sheets)",
      supplier_customer: "Google Sheets",
      document_number: "",
      value: sheetsBaseValue,
      company_id: scopedCompanyIds[0],
      company_name: companyNameById.get(scopedCompanyIds[0]) ?? "",
      total_count: total,
    });
  }
  const totalValue = rows.reduce((sum, row) => sum + row.value, 0);

  const aggregateRows =
    (aggregateResult.data as Array<{
      dre_account_id: string;
      amount: number | string | null;
    }> | null) ?? [];

  // O dre_account_id retornado pela agregação pode ser tanto o id GLOBAL
  // (quando o mapping é global) quanto o id CLONADO (quando o mapping é
  // específico da empresa após um fork). Para casar com o accountId que o
  // cliente passou (sempre o do plano em escopo), resolvemos pelo `code` —
  // estável entre planos (já resolvido como `targetCode` acima). Sem isso, o
  // aggregateTotal fica zerado e o dashboard alerta "valores divergentes"
  // indevidamente.
  let aggregateTotal = 0;
  if (targetCode) {
    const idsInAggregate = aggregateRows.map((r) => r.dre_account_id);
    const { data: idToCodeRows } = await supabase
      .from("dre_accounts")
      .select("id,code")
      .in("id", idsInAggregate.length > 0 ? idsInAggregate : ["00000000-0000-0000-0000-000000000000"]);
    const codeById = new Map<string, string>();
    (idToCodeRows ?? []).forEach((row) => {
      codeById.set(row.id as string, row.code as string);
    });
    aggregateTotal = aggregateRows.reduce((sum, r) => {
      const code = codeById.get(r.dre_account_id);
      if (code === targetCode) return sum + Number(r.amount ?? 0);
      return sum;
    }, 0);
  }

  return NextResponse.json({
    rows,
    page,
    pageSize,
    total,
    totalPages,
    totalValue,
    aggregateTotal,
  });
}
