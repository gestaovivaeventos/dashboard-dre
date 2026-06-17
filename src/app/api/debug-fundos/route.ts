import { NextResponse } from "next/server";
import { getCurrentSessionContext } from "@/lib/auth/session";

export async function GET(request: Request) {
  const { supabase, user } = await getCurrentSessionContext();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  const url = new URL(request.url);
  let companyId = url.searchParams.get("companyId");
  const companyName = url.searchParams.get("name");
  const code = url.searchParams.get("code") ?? "2.08.96";
  const monthParam = url.searchParams.get("month") ?? "2026-01";

  if (!companyId && companyName) {
    const { data: found } = await supabase
      .from("companies")
      .select("id")
      .ilike("name", `%${companyName}%`)
      .limit(1)
      .single();
    companyId = (found?.id as string) ?? null;
  }
  if (!companyId) return NextResponse.json({ error: "Informe companyId ou name" });

  const [year, month] = monthParam.split("-").map(Number);
  const dateFrom = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const dateTo = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  const fundosCodeDesp = `__fundos_desp_${code}`;
  const fundosCodeRec = `__fundos_rec_${code}`;
  const ressarcCodeDesp = `__ressarc_desp_${code}`;
  const ressarcCodeRec = `__ressarc_rec_${code}`;
  const allCodes = [
    code,
    fundosCodeDesp,
    fundosCodeRec,
    ressarcCodeDesp,
    ressarcCodeRec,
  ];

  // 1) Entries no mes para todos os codes relevantes (plain + sinteticos:
  //    __fundos_* = operacional → 5.8/5.9; __ressarc_* = sem projeto/N.O. → 2.4/7.5.5).
  const { data: entriesData } = await supabase
    .from("financial_entries")
    .select("omie_id,category_code,value,payment_date,description,project_code,project_name")
    .eq("company_id", companyId)
    .gte("payment_date", dateFrom)
    .lte("payment_date", dateTo)
    .in("category_code", allCodes);

  // Classificacao N.O. (mesma logica do redirect de Fundos em sync.ts):
  // sem projeto OU nome comeca com "N.O." => fica na linha ressarcivel comum;
  // projeto operacional (nome != N.O.) => vai para Fundos.
  const classifyProject = (pc: string | null, pn: string | null) => {
    if (!pc || !String(pc).trim()) return "sem-projeto";
    if (pn && String(pn).replace(/^\s+/, "").startsWith("N.O.")) return "N.O.";
    if (!pn) return "operacional (nome NAO resolvido)";
    return "operacional";
  };

  // 1b) Diagnostico turnkey (nao depende do parametro `code`): TODOS os
  //     lancamentos do mes que tem projeto vinculado, com project_code,
  //     project_name e a classificacao N.O. Se `nomes_resolvidos` < total,
  //     o catalogo de projetos (ListarProjetos) nao resolveu os nomes e a
  //     regra N.O. nao dispara (causa raiz se a linha "outras despesas"
  //     continuar zerada apos o re-sync).
  const { data: projEntries } = await supabase
    .from("financial_entries")
    .select("category_code,value,project_code,project_name,description")
    .eq("company_id", companyId)
    .gte("payment_date", dateFrom)
    .lte("payment_date", dateTo)
    .not("project_code", "is", null)
    .limit(500);
  const projDiag = (projEntries ?? []).map((e) => ({
    category_code: e.category_code,
    value: e.value,
    project_code: e.project_code ?? null,
    project_name: e.project_name ?? null,
    classificacao: classifyProject(
      (e.project_code as string | null) ?? null,
      (e.project_name as string | null) ?? null,
    ),
    desc: String(e.description ?? "").slice(0, 60),
  }));
  const projResumo = projDiag.reduce<Record<string, number>>((acc, e) => {
    acc[e.classificacao] = (acc[e.classificacao] ?? 0) + Number(e.value ?? 0);
    return acc;
  }, {});
  const projetosNoMes = {
    total: projDiag.length,
    nomes_resolvidos: projDiag.filter((e) => e.project_name).length,
    resumo_por_classificacao: projResumo,
    entries: projDiag,
  };

  // 2) Mapeamentos em category_mapping para esses codes (empresa + global).
  const { data: mappingsData } = await supabase
    .from("category_mapping")
    .select("omie_category_code,dre_account_id,company_id")
    .in("omie_category_code", allCodes)
    .or(`company_id.eq.${companyId},company_id.is.null`);

  // 3) Catalogo local omie_categories para o code.
  const { data: catData } = await supabase
    .from("omie_categories")
    .select("code,description,company_id")
    .eq("company_id", companyId)
    .in("code", allCodes);

  // 4) Resolver dre_accounts envolvidas para mostrar codes 2.4/7.5.5/5.8/5.9.
  const dreIds = Array.from(new Set((mappingsData ?? []).map((m) => m.dre_account_id as string)));
  const { data: dreAccData } = dreIds.length > 0
    ? await supabase.from("dre_accounts").select("id,code,name").in("id", dreIds)
    : { data: [] as Array<{ id: string; code: string; name: string }> };
  const dreIdToInfo = new Map(
    (dreAccData ?? []).map((a) => [a.id as string, { code: a.code as string, name: a.name as string }]),
  );

  // 5) RPC dashboard_dre_aggregate para o mes (filtrado em 2.4/7.5.5/5.8/5.9).
  const { data: targetAccs } = await supabase
    .from("dre_accounts")
    .select("id,code")
    .in("code", ["2.4", "7.5.5", "5.8", "5.9"]);
  const targetIdToCode = new Map((targetAccs ?? []).map((a) => [a.id as string, a.code as string]));

  const { data: rpc } = await supabase.rpc("dashboard_dre_aggregate", {
    p_company_ids: [companyId],
    p_date_from: dateFrom,
    p_date_to: dateTo,
  });
  const rpcRessarc = ((rpc ?? []) as Array<{ dre_account_id: string; amount: number }>)
    .filter((r) => targetIdToCode.has(r.dre_account_id))
    .map((r) => ({ dre_code: targetIdToCode.get(r.dre_account_id), amount: r.amount }));

  // 6) Drilldown 5.9 (Despesas Ressarciveis - Fundos): TODOS os entries do mes.
  const fundosDespId = (targetAccs ?? []).find((a) => a.code === "5.9")?.id;
  let fundosDespEntries: Array<Record<string, unknown>> = [];
  if (fundosDespId) {
    const { data: drillData } = await supabase.rpc("dashboard_dre_drilldown", {
      p_dre_account_id: fundosDespId,
      p_company_ids: [companyId],
      p_date_from: dateFrom,
      p_date_to: dateTo,
      p_search: null,
      p_limit: 200,
      p_offset: 0,
    });
    const drillEntries = (drillData ?? []) as Array<{
      financial_entry_id: string;
      payment_date: string;
      description: string;
      value: number;
    }>;
    const ids = drillEntries.map((e) => e.financial_entry_id);
    let idToCode = new Map<string, string>();
    if (ids.length > 0) {
      const { data: codeRows } = await supabase
        .from("financial_entries")
        .select("id,category_code")
        .in("id", ids);
      idToCode = new Map(
        (codeRows ?? []).map((r) => [r.id as string, (r.category_code as string) ?? ""]),
      );
    }
    fundosDespEntries = drillEntries.map((e) => ({
      payment_date: e.payment_date,
      value: e.value,
      category_code: idToCode.get(e.financial_entry_id) ?? null,
      desc: String(e.description ?? "").slice(0, 80),
    }));
  }

  return NextResponse.json({
    companyId,
    period: { dateFrom, dateTo },
    code,
    projetos_no_mes: projetosNoMes,
    entries: (entriesData ?? []).map((e) => ({
      omie_id: e.omie_id,
      category_code: e.category_code,
      value: e.value,
      payment_date: e.payment_date,
      project_code: e.project_code ?? null,
      project_name: e.project_name ?? null,
      classificacao: classifyProject(
        (e.project_code as string | null) ?? null,
        (e.project_name as string | null) ?? null,
      ),
      desc: String(e.description ?? "").slice(0, 80),
    })),
    category_mapping: (mappingsData ?? []).map((m) => ({
      omie_category_code: m.omie_category_code,
      company_id: m.company_id,
      dre_account_id: m.dre_account_id,
      dre_code: dreIdToInfo.get(m.dre_account_id as string)?.code ?? null,
      dre_name: dreIdToInfo.get(m.dre_account_id as string)?.name ?? null,
    })),
    omie_categories: catData ?? [],
    rpc_ressarciveis: rpcRessarc,
    fundos_desp_drilldown: {
      count: fundosDespEntries.length,
      sum: fundosDespEntries.reduce((s, e) => s + Number(e.value ?? 0), 0),
      entries: fundosDespEntries,
    },
  });
}
