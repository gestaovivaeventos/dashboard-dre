import { NextResponse } from "next/server";
import { getCurrentSessionContext } from "@/lib/auth/session";

/**
 * Endpoint de diagnostico do gap dashboard vs drilldown.
 *
 * Uso:
 *   /api/debug-prolabore?name=Viva%20Campo%20Grande&code=7.2.17&month=2026-01
 *
 * Retorna:
 *   - dre_account: id/code/name/is_summary/parent/children
 *   - dashboard_aggregate: valor que o dashboard recebe (RPC dashboard_dre_aggregate)
 *   - drilldown_full: TODOS os entries (sem paginacao) que o drilldown retorna
 *   - direct_entries_by_category: entries diretos no DB agrupados por category_code,
 *     com a dre_account a que mapeiam
 *   - children_aggregate: agregados das contas filhas (para detectar is_summary)
 */
export async function GET(request: Request) {
  const { supabase, user } = await getCurrentSessionContext();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  const url = new URL(request.url);
  let companyId = url.searchParams.get("companyId");
  const companyName = url.searchParams.get("name");
  const code = url.searchParams.get("code") ?? "7.2.17";
  const monthParam = url.searchParams.get("month") ?? "2026-01";

  if (!companyId && companyName) {
    const { data: found } = await supabase
      .from("companies")
      .select("id,name")
      .ilike("name", `%${companyName}%`)
      .limit(5);
    companyId = ((found ?? [])[0]?.id as string) ?? null;
  }
  if (!companyId) {
    const { data: all } = await supabase
      .from("companies")
      .select("id,name,active")
      .order("name");
    return NextResponse.json({
      error: "Empresa nao encontrada. Use 'companyId' ou 'name' (substring case-insensitive).",
      hint: "Copie um id (ou parte do nome) da lista abaixo e tente de novo.",
      query_received: { companyId: url.searchParams.get("companyId"), name: companyName },
      companies_available: all ?? [],
    });
  }

  const [year, month] = monthParam.split("-").map(Number);
  const dateFrom = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const dateTo = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  // 1) DRE account alvo + filhos.
  const { data: targetAccount } = await supabase
    .from("dre_accounts")
    .select("id,code,name,parent_id,is_summary,type,formula,active")
    .eq("code", code)
    .maybeSingle();

  if (!targetAccount) {
    return NextResponse.json({ error: `dre_account ${code} nao encontrado` });
  }

  const { data: childrenAccs } = await supabase
    .from("dre_accounts")
    .select("id,code,name,is_summary,type")
    .eq("parent_id", targetAccount.id)
    .eq("active", true)
    .order("code");

  // 2) Dashboard aggregate (mesma RPC que o dashboard usa).
  const { data: rpcAgg } = await supabase.rpc("dashboard_dre_aggregate", {
    p_company_ids: [companyId],
    p_date_from: dateFrom,
    p_date_to: dateTo,
  });
  const aggMap = new Map(
    ((rpcAgg ?? []) as Array<{ dre_account_id: string; amount: number }>).map(
      (r) => [r.dre_account_id as string, Number(r.amount ?? 0)],
    ),
  );

  const targetAggregate = aggMap.get(targetAccount.id as string) ?? 0;
  const childrenAggregate = (childrenAccs ?? []).map((c) => ({
    code: c.code,
    name: c.name,
    is_summary: c.is_summary,
    aggregate: aggMap.get(c.id as string) ?? 0,
  }));
  const childrenSum = childrenAggregate.reduce((s, c) => s + c.aggregate, 0);

  // 3) Drilldown FULL (sem paginacao).
  const { data: drillData } = await supabase.rpc("dashboard_dre_drilldown", {
    p_dre_account_id: targetAccount.id,
    p_company_ids: [companyId],
    p_date_from: dateFrom,
    p_date_to: dateTo,
    p_search: null,
    p_limit: 1000,
    p_offset: 0,
  });
  const drillEntries = (drillData ?? []) as Array<{
    financial_entry_id: string;
    payment_date: string;
    description: string;
    value: number;
    total_count: number;
  }>;
  const drillTotal = drillEntries.reduce((s, e) => s + Number(e.value ?? 0), 0);
  const drillCount = drillEntries[0]?.total_count ?? drillEntries.length;

  // 4) Entries diretos no DB no periodo, agrupados por category_code.
  const { data: rawEntries } = await supabase
    .from("financial_entries")
    .select("id,omie_id,category_code,value,payment_date,description")
    .eq("company_id", companyId)
    .gte("payment_date", dateFrom)
    .lte("payment_date", dateTo);

  const byCategory = new Map<
    string,
    { count: number; sum: number; sample_omie_ids: string[] }
  >();
  for (const e of (rawEntries ?? []) as Array<Record<string, unknown>>) {
    const cat = String((e.category_code as string) ?? "(null)");
    const cur = byCategory.get(cat) ?? { count: 0, sum: 0, sample_omie_ids: [] };
    cur.count += 1;
    cur.sum += Number(e.value ?? 0);
    if (cur.sample_omie_ids.length < 3) {
      cur.sample_omie_ids.push(String(e.omie_id ?? ""));
    }
    byCategory.set(cat, cur);
  }

  // 5) Para cada categoria, descobrir a qual dre_account ela mapeia.
  const cats = Array.from(byCategory.keys()).filter((c) => c !== "(null)");
  const { data: mapData } = cats.length > 0
    ? await supabase
        .from("category_mapping")
        .select("omie_category_code,dre_account_id,company_id")
        .in("omie_category_code", cats)
        .or(`company_id.eq.${companyId},company_id.is.null`)
    : { data: [] };

  // Resolver lateral: prefere mapping company-specific, senao global.
  const mapByCat = new Map<string, string>();
  for (const m of (mapData ?? []) as Array<Record<string, unknown>>) {
    const k = String(m.omie_category_code);
    if (!mapByCat.has(k) || m.company_id) {
      mapByCat.set(k, String(m.dre_account_id));
    }
  }

  const allDreIds = Array.from(new Set(mapByCat.values()));
  const { data: allDre } = allDreIds.length > 0
    ? await supabase.from("dre_accounts").select("id,code,name").in("id", allDreIds)
    : { data: [] };
  const dreById = new Map(
    ((allDre ?? []) as Array<Record<string, unknown>>).map((a) => [
      String(a.id),
      { code: String(a.code), name: String(a.name) },
    ]),
  );

  const directEntriesByCategory = Array.from(byCategory.entries()).map(
    ([cat, agg]) => {
      const dreId = mapByCat.get(cat);
      const dreInfo = dreId ? dreById.get(dreId) : null;
      const mapsToTarget = dreId === targetAccount.id;
      return {
        category_code: cat,
        count: agg.count,
        sum: agg.sum,
        sample_omie_ids: agg.sample_omie_ids,
        maps_to_dre_id: dreId ?? null,
        maps_to_dre_code: dreInfo?.code ?? null,
        maps_to_dre_name: dreInfo?.name ?? null,
        maps_to_target: mapsToTarget,
      };
    },
  );

  // Soma das categorias que mapeiam para o target.
  const targetSumViaCategories = directEntriesByCategory
    .filter((d) => d.maps_to_target)
    .reduce((s, d) => s + d.sum, 0);

  return NextResponse.json({
    period: { dateFrom, dateTo },
    company_id: companyId,
    dre_account: {
      id: targetAccount.id,
      code: targetAccount.code,
      name: targetAccount.name,
      parent_id: targetAccount.parent_id,
      is_summary: targetAccount.is_summary,
      type: targetAccount.type,
      formula: targetAccount.formula,
    },
    children: childrenAggregate,
    children_sum: childrenSum,
    dashboard_aggregate_for_target: targetAggregate,
    drilldown: {
      count: drillCount,
      total_value: drillTotal,
      entries_returned: drillEntries.length,
    },
    direct_entries_summary: {
      target_sum_via_categories: targetSumViaCategories,
      drilldown_minus_aggregate: drillTotal - targetAggregate,
      categories: directEntriesByCategory
        .filter((d) => d.maps_to_target || cats.length < 30)
        .sort((a, b) => b.sum - a.sum),
    },
    diagnosis_hint:
      targetAggregate !== drillTotal
        ? "Dashboard aggregate != drilldown sum. Comparar 'direct_entries_summary.categories' (mapeadas para target) vs entries do drilldown."
        : (Math.abs(targetAggregate - targetSumViaCategories) > 0.01
            ? "Aggregate diverge da soma direta no DB — provavel mapping duplicado ou entries com category_code que mapeia para multiplas dre_accounts."
            : "Aggregate e drilldown batem para a target. Diff vista no UI provavelmente vem de is_summary somando filhos."),
  });
}
