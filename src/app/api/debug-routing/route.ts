import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";

// Diagnostico do roteamento de departamento. Para a empresa de DESTINO e um
// intervalo, mostra os lancamentos roteados PARA ela, agregados por categoria,
// e onde cada um resolve (override / destino / origem / global / NENHUM).
//
// Uso: /api/debug-routing?companyId=<destino>&from=2026-05-01&to=2026-05-31

export async function GET(request: Request) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user || !profile) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (profile.role !== "admin") {
    return NextResponse.json({ error: "Acesso restrito ao admin." }, { status: 403 });
  }

  const url = new URL(request.url);
  const companyId = url.searchParams.get("companyId");
  const from = url.searchParams.get("from") ?? "2026-01-01";
  const to = url.searchParams.get("to") ?? "2026-12-31";

  const db = createAdminClientIfAvailable() ?? supabase;

  const isUuid = (v: string | null): v is string =>
    !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

  // Quando nao vem um companyId valido, devolve um panorama de TODAS as rotas
  // configuradas no sistema (com nomes e IDs) — para o usuario achar o ID de
  // destino correto e conferir se o roteamento existe.
  if (!isUuid(companyId)) {
    const { data: allRoutes } = await db
      .from("company_departments")
      .select("company_id, omie_code, name, routed_to_company_id")
      .not("routed_to_company_id", "is", null);
    const ids = new Set<string>();
    (allRoutes ?? []).forEach((r) => {
      ids.add(r.company_id as string);
      if (r.routed_to_company_id) ids.add(r.routed_to_company_id as string);
    });
    const { data: companiesData } = ids.size
      ? await db.from("companies").select("id, name").in("id", Array.from(ids))
      : { data: [] as Array<Record<string, unknown>> };
    const nameById = new Map(
      (companiesData ?? []).map((c) => [c.id as string, c.name as string]),
    );
    return NextResponse.json({
      aviso:
        "companyId ausente ou invalido. Abaixo, todas as rotas configuradas. Use o 'destinoId' na URL: /api/debug-routing?companyId=<destinoId>&from=2026-05-01&to=2026-05-31",
      rotasConfiguradas: (allRoutes ?? []).map((r) => ({
        origem: nameById.get(r.company_id as string) ?? r.company_id,
        departamento: r.name,
        departmentCode: r.omie_code,
        destino: nameById.get(r.routed_to_company_id as string) ?? r.routed_to_company_id,
        destinoId: r.routed_to_company_id,
      })),
    });
  }

  // 1) Departamentos roteados PARA esta empresa.
  const { data: routedDepts } = await db
    .from("company_departments")
    .select("company_id, omie_code, name, included")
    .eq("routed_to_company_id", companyId);

  if (!routedDepts || routedDepts.length === 0) {
    return NextResponse.json({
      companyId,
      from,
      to,
      diagnostico: "NENHUM departamento roteado para esta empresa. Configure o roteamento na empresa de ORIGEM (Configuracoes > Departamentos > Enviar para).",
      routedDepartments: [],
    });
  }

  const sourceIds = Array.from(new Set(routedDepts.map((d) => d.company_id as string)));

  // Flag de rateio das empresas de origem (afeta o filtro por departamento).
  const { data: sourceCompanies } = await db
    .from("companies")
    .select("id, name, has_department_apportionment")
    .in("id", sourceIds);
  const sourceById = new Map(
    (sourceCompanies ?? []).map((c) => [
      c.id as string,
      { name: c.name as string, hasFlag: Boolean(c.has_department_apportionment) },
    ]),
  );

  // 2) Mapeamentos relevantes (target/source/global) e overrides.
  const { data: catMappings } = await db
    .from("category_mapping")
    .select("omie_category_code, dre_account_id, company_id")
    .or(`company_id.eq.${companyId},company_id.in.(${sourceIds.join(",")}),company_id.is.null`);
  const { data: overrides } = await db
    .from("routed_category_mapping")
    .select("source_company_id, omie_department_code, omie_category_code, dre_account_id")
    .eq("target_company_id", companyId);

  const accountIds = new Set<string>();
  (catMappings ?? []).forEach((m) => m.dre_account_id && accountIds.add(m.dre_account_id as string));
  (overrides ?? []).forEach((o) => o.dre_account_id && accountIds.add(o.dre_account_id as string));
  const { data: accounts } = accountIds.size
    ? await db.from("dre_accounts").select("id, code, name").in("id", Array.from(accountIds))
    : { data: [] as Array<Record<string, unknown>> };
  const accountById = new Map(
    (accounts ?? []).map((a) => [a.id as string, `${a.code as string} - ${a.name as string}`]),
  );

  const destMap = new Map<string, string>();
  const srcMap = new Map<string, string>(); // key: `${company}|${code}`
  const globalMap = new Map<string, string>();
  (catMappings ?? []).forEach((m) => {
    const code = m.omie_category_code as string;
    const cid = (m.company_id as string | null) ?? null;
    const acc = (m.dre_account_id as string | null) ?? null;
    if (!acc) return;
    if (cid === companyId) destMap.set(code, acc);
    else if (cid === null) globalMap.set(code, acc);
    else srcMap.set(`${cid}|${code}`, acc);
  });
  const overrideMap = new Map<string, string>(); // `${source}|${dept}|${code}`
  (overrides ?? []).forEach((o) => {
    if (o.dre_account_id) {
      overrideMap.set(
        `${o.source_company_id as string}|${o.omie_department_code as string}|${o.omie_category_code as string}`,
        o.dre_account_id as string,
      );
    }
  });

  // 3) Lancamentos roteados, agregados por categoria.
  const result = [];
  for (const dept of routedDepts) {
    const sourceCompanyId = dept.company_id as string;
    const departmentCode = dept.omie_code as string;
    const src = sourceById.get(sourceCompanyId);

    const { data: entries } = await db
      .from("financial_entries")
      .select("category_code, category_name, value, department_code")
      .eq("company_id", sourceCompanyId)
      .gte("payment_date", from)
      .lte("payment_date", to);

    // Panorama dos departamentos que a ORIGEM tem no periodo — revela se o
    // lancamento existe sob outro codigo (sub-departamento) ou se a origem nao
    // foi sincronizada (lista vazia).
    const deptBreakdownMap = new Map<string, { count: number; total: number }>();
    (entries ?? []).forEach((e) => {
      const code = (e.department_code as string | null) ?? "__none__";
      const cur = deptBreakdownMap.get(code) ?? { count: 0, total: 0 };
      cur.count += 1;
      cur.total += Number(e.value ?? 0);
      deptBreakdownMap.set(code, cur);
    });
    const origemDepartmentCodes = Array.from(deptBreakdownMap.entries())
      .map(([code, v]) => ({ code, lancamentos: v.count, total: Number(v.total.toFixed(2)) }))
      .sort((a, b) => b.lancamentos - a.lancamentos);

    // Filtra pelo departamento (COALESCE null -> __none__) no app, para casar
    // exatamente a logica das RPCs.
    const ofDept = (entries ?? []).filter(
      (e) => (e.department_code ?? "__none__") === departmentCode,
    );

    const byCat = new Map<string, { code: string; total: number; count: number }>();
    ofDept.forEach((e) => {
      const code = (e.category_code as string | null) ?? "(sem categoria)";
      const cur = byCat.get(code) ?? { code, total: 0, count: 0 };
      cur.total += Number(e.value ?? 0);
      cur.count += 1;
      byCat.set(code, cur);
    });

    const categorias = Array.from(byCat.values()).map((c) => {
      const overrideAcc = overrideMap.get(`${sourceCompanyId}|${departmentCode}|${c.code}`);
      const destAcc = destMap.get(c.code);
      const srcAcc = srcMap.get(`${sourceCompanyId}|${c.code}`);
      const globalAcc = globalMap.get(c.code);
      const resolvedId = overrideAcc ?? destAcc ?? srcAcc ?? globalAcc ?? null;
      let camada: string;
      if (overrideAcc) camada = "override";
      else if (destAcc) camada = "destino";
      else if (srcAcc) camada = "origem";
      else if (globalAcc) camada = "global";
      else camada = "NENHUM (descartado)";
      return {
        categoria: c.code,
        total: Number(c.total.toFixed(2)),
        lancamentos: c.count,
        resolvePor: camada,
        conta: resolvedId ? accountById.get(resolvedId) ?? resolvedId : null,
      };
    });

    result.push({
      origem: src?.name ?? sourceCompanyId,
      departamento: dept.name,
      departmentCode,
      origemTemRateio: src?.hasFlag ?? false,
      departamentoIncluido: Boolean(dept.included),
      filtroOk:
        !(src?.hasFlag ?? false) || Boolean(dept.included)
          ? "passa"
          : "BLOQUEADO (origem tem rateio e este departamento NAO esta incluido)",
      origemTotalLancamentosNoPeriodo: (entries ?? []).length,
      origemDepartmentCodes,
      categorias,
    });
  }

  return NextResponse.json({ companyId, from, to, routedDepartments: result });
}
