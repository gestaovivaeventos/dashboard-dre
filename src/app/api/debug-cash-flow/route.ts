// Diagnostico para casos onde o usuario mapeou uma categoria no Fluxo de Caixa
// mas nao ve o valor aparecer na tela. Devolve, para um termo de busca:
//
//   1. Categorias Omie encontradas (omie_categories) na empresa.
//   2. Mapeamentos de Fluxo de Caixa existentes para essa empresa cujos codigos
//      casam com os termos.
//   3. Lancamentos (financial_entries) cujo category_code casa, no periodo
//      pedido, com soma e contagem por codigo + flag de mapeamento + flag do
//      filtro de departamento.
//   4. Configuracao da empresa (has_department_apportionment, departments
//      incluidos).
//
// Uso: /api/debug-cash-flow?name=viva%20volta&search=dividendo&from=2026-01-01&to=2026-12-31
//
// Restrito a admin. Read-only.

import { NextResponse } from "next/server";
import { getCurrentSessionContext } from "@/lib/auth/session";

export async function GET(request: Request) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user || !profile) {
    return NextResponse.json({ error: "auth" }, { status: 401 });
  }
  if (profile.role !== "admin") {
    return NextResponse.json({ error: "admin only" }, { status: 403 });
  }

  const url = new URL(request.url);
  const name = url.searchParams.get("name");
  const companyIdParam = url.searchParams.get("companyId");
  const search = (url.searchParams.get("search") ?? "").trim();
  const from = url.searchParams.get("from") ?? "2026-01-01";
  const to = url.searchParams.get("to") ?? "2026-12-31";

  if (!name && !companyIdParam) {
    return NextResponse.json(
      { error: "Informe ?name=<parte do nome> ou ?companyId=<uuid>" },
      { status: 400 },
    );
  }

  let companyId = companyIdParam;
  if (!companyId && name) {
    const { data: matches } = await supabase
      .from("companies")
      .select("id,name,active,has_department_apportionment")
      .ilike("name", `%${name}%`);
    if (!matches || matches.length === 0) {
      return NextResponse.json({ error: `Empresa nao encontrada: ${name}` }, { status: 404 });
    }
    if (matches.length > 1) {
      return NextResponse.json(
        { error: "Multiplas empresas. Use ?companyId=<uuid>", matches },
        { status: 400 },
      );
    }
    companyId = matches[0].id as string;
  }

  const { data: company } = await supabase
    .from("companies")
    .select("id,name,active,has_department_apportionment")
    .eq("id", companyId!)
    .single();

  // 1. Categorias Omie batendo com search
  const categoriesQuery = supabase
    .from("omie_categories")
    .select("code,description")
    .eq("company_id", companyId!);
  const { data: omieCategories } = search
    ? await categoriesQuery.or(`code.ilike.%${search}%,description.ilike.%${search}%`)
    : await categoriesQuery;

  // 2. Mapeamentos do Cash Flow (empresa + global) batendo com search
  const mappingsBase = supabase
    .from("cash_flow_category_mappings")
    .select("id,omie_category_code,omie_category_name,cash_flow_account_id,company_id")
    .or(`company_id.eq.${companyId},company_id.is.null`);
  const { data: cashFlowMappings } = search
    ? await mappingsBase.or(`omie_category_code.ilike.%${search}%,omie_category_name.ilike.%${search}%`)
    : await mappingsBase;

  // Resolve account names
  const accountIds = Array.from(
    new Set((cashFlowMappings ?? []).map((m) => m.cash_flow_account_id as string)),
  );
  const { data: accounts } = accountIds.length
    ? await supabase
        .from("cash_flow_accounts")
        .select("id,code,name")
        .in("id", accountIds)
    : { data: [] };
  const accountById = new Map(
    (accounts ?? []).map((a) => [a.id as string, { code: a.code as string, name: a.name as string }]),
  );

  const mappingsEnriched = (cashFlowMappings ?? []).map((m) => {
    const acc = accountById.get(m.cash_flow_account_id as string);
    return {
      id: m.id,
      omie_category_code: m.omie_category_code,
      omie_category_name: m.omie_category_name,
      cash_flow_account_id: m.cash_flow_account_id,
      cash_flow_account_code: acc?.code ?? null,
      cash_flow_account_name: acc?.name ?? null,
      scope: m.company_id ? "company" : "global",
    };
  });

  // 3. Departamentos incluidos
  const { data: departments } = await supabase
    .from("company_departments")
    .select("omie_code,name,included")
    .eq("company_id", companyId!);
  const includedDepts = new Set(
    (departments ?? []).filter((d) => d.included).map((d) => d.omie_code as string),
  );

  // 4. Lancamentos no periodo cujo category_code casa com search ou com
  //    qualquer codigo retornado em omieCategories.
  const codesToCheck = Array.from(
    new Set([
      ...(omieCategories ?? []).map((c) => c.code as string),
      ...((cashFlowMappings ?? []).map((m) => m.omie_category_code as string)),
    ]),
  );

  const entriesQuery = supabase
    .from("financial_entries")
    .select("category_code,department_code,value")
    .eq("company_id", companyId!)
    .gte("payment_date", from)
    .lte("payment_date", to);

  // Para descobrir tambem entries com __fundos_*<codigo>, fazemos uma busca
  // ampla por LIKE no codigo
  const filteredEntries = codesToCheck.length
    ? await entriesQuery.in("category_code", [
        ...codesToCheck,
        ...codesToCheck.map((c) => `__fundos_rec_${c}`),
        ...codesToCheck.map((c) => `__fundos_desp_${c}`),
      ])
    : await entriesQuery.ilike("category_code", `%${search}%`);

  const entriesByCode = new Map<
    string,
    { count: number; sum: number; deptCounts: Record<string, number>; deptIncluded: Record<string, boolean> }
  >();
  (filteredEntries.data ?? []).forEach((e) => {
    const code = (e.category_code as string) ?? "(null)";
    const dept = (e.department_code as string | null) ?? "__none__";
    const value = Number(e.value ?? 0);
    const bucket = entriesByCode.get(code) ?? {
      count: 0,
      sum: 0,
      deptCounts: {},
      deptIncluded: {},
    };
    bucket.count += 1;
    bucket.sum += value;
    bucket.deptCounts[dept] = (bucket.deptCounts[dept] ?? 0) + 1;
    bucket.deptIncluded[dept] = company?.has_department_apportionment
      ? includedDepts.has(dept)
      : true;
    entriesByCode.set(code, bucket);
  });

  // Para cada codigo de entry, verifica se ha mapping (apos strip do prefixo __fundos_)
  const mappingByCleanCode = new Map<string, { account_code: string | null; account_name: string | null; scope: string }>();
  mappingsEnriched.forEach((m) => {
    const code = m.omie_category_code as string;
    if (!mappingByCleanCode.has(code) || m.scope === "company") {
      mappingByCleanCode.set(code, {
        account_code: m.cash_flow_account_code,
        account_name: m.cash_flow_account_name,
        scope: m.scope,
      });
    }
  });

  const entriesSummary = Array.from(entriesByCode.entries()).map(([code, info]) => {
    const cleanCode = code.replace(/^__fundos_(rec|desp)_/, "");
    const mapping = mappingByCleanCode.get(cleanCode);
    return {
      category_code: code,
      effective_code_for_match: cleanCode,
      has_fundos_prefix: code !== cleanCode,
      entry_count: info.count,
      sum_value: info.sum,
      mapping,
      mapped: !!mapping,
      department_breakdown: Object.entries(info.deptCounts).map(([dept, count]) => ({
        department_code: dept,
        count,
        included_in_dre_filter: info.deptIncluded[dept],
      })),
    };
  });

  // 5. Chama o RPC cash_flow_aggregate diretamente para essa empresa+periodo
  //    e enriquece com nome da conta. Se o RPC retornar a linha mas a tela
  //    nao mostrar, e cache/UI; se nao retornar, e bug do RPC.
  const { data: rpcRows, error: rpcError } = await supabase.rpc("cash_flow_aggregate", {
    p_company_ids: [companyId!],
    p_date_from: from,
    p_date_to: to,
  });

  const rpcAccountIds = Array.from(
    new Set(((rpcRows as Array<{ cash_flow_account_id: string }> | null) ?? []).map((r) => r.cash_flow_account_id)),
  );
  const { data: rpcAccounts } = rpcAccountIds.length
    ? await supabase
        .from("cash_flow_accounts")
        .select("id,code,name")
        .in("id", rpcAccountIds)
    : { data: [] };
  const rpcAccountById = new Map(
    (rpcAccounts ?? []).map((a) => [a.id as string, { code: a.code as string, name: a.name as string }]),
  );

  const rpcOutput = ((rpcRows as Array<{ cash_flow_account_id: string; amount: number | string }> | null) ?? []).map((r) => ({
    cash_flow_account_id: r.cash_flow_account_id,
    cash_flow_account_code: rpcAccountById.get(r.cash_flow_account_id)?.code ?? null,
    cash_flow_account_name: rpcAccountById.get(r.cash_flow_account_id)?.name ?? null,
    amount: Number(r.amount ?? 0),
  }));

  return NextResponse.json({
    company,
    department_filter: {
      enabled: !!company?.has_department_apportionment,
      included_departments: Array.from(includedDepts),
      total_departments: departments?.length ?? 0,
    },
    period: { from, to },
    search,
    omie_categories_matching: omieCategories ?? [],
    cash_flow_mappings: mappingsEnriched,
    entries_summary: entriesSummary,
    rpc_cash_flow_aggregate: {
      error: rpcError?.message ?? null,
      rows: rpcOutput,
    },
  });
}
