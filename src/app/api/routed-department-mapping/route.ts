import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import {
  refreshDreAggregatesForSource,
  refreshCashFlowAggregatesForSource,
} from "@/lib/dashboard/aggregate-refresh";

// Override de mapeamento de departamento roteado (Fase 2). Para a empresa de
// DESTINO, lista os departamentos roteados PARA ela (de outras empresas), as
// categorias usadas por cada um e o override de conta atual (DRE ou Fluxo).
//
// kind = "dre"      -> tabela routed_category_mapping / coluna dre_account_id
// kind = "cashflow" -> tabela routed_cash_flow_category_mapping / cash_flow_account_id

interface KindConfig {
  table: string;
  accountColumn: string;
}

function resolveKind(raw: string | null): KindConfig | null {
  if (raw === "dre") {
    return { table: "routed_category_mapping", accountColumn: "dre_account_id" };
  }
  if (raw === "cashflow") {
    return {
      table: "routed_cash_flow_category_mapping",
      accountColumn: "cash_flow_account_id",
    };
  }
  return null;
}

interface CategoryItem {
  code: string;
  name: string;
  accountId: string | null;
}

interface Section {
  sourceCompanyId: string;
  sourceCompanyName: string;
  departmentCode: string;
  departmentName: string;
  categories: CategoryItem[];
}

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
  const kind = resolveKind(url.searchParams.get("kind"));
  if (!companyId) {
    return NextResponse.json({ error: "Informe companyId." }, { status: 400 });
  }
  if (!kind) {
    return NextResponse.json({ error: "kind invalido (use dre|cashflow)." }, { status: 400 });
  }

  const db = createAdminClientIfAvailable() ?? supabase;

  // Departamentos roteados PARA esta empresa (origem = company_id da linha).
  const { data: routedDepts, error: routedError } = await db
    .from("company_departments")
    .select("company_id, omie_code, name")
    .eq("routed_to_company_id", companyId);
  if (routedError) {
    return NextResponse.json({ error: routedError.message }, { status: 400 });
  }
  if (!routedDepts || routedDepts.length === 0) {
    return NextResponse.json({ sections: [] as Section[] });
  }

  // Nomes das empresas de origem.
  const sourceIds = Array.from(
    new Set(routedDepts.map((d) => d.company_id as string)),
  );
  const { data: sourceCompanies } = await db
    .from("companies")
    .select("id, name")
    .in("id", sourceIds);
  const sourceNameById = new Map(
    (sourceCompanies ?? []).map((c) => [c.id as string, c.name as string]),
  );

  // Descricoes das categorias por empresa de origem. financial_entries.
  // category_name guarda o proprio codigo, entao a descricao real vem de
  // omie_categories (mesma fonte da tela de mapeamento principal).
  const { data: sourceCategories } = await db
    .from("omie_categories")
    .select("company_id, code, description")
    .in("company_id", sourceIds);
  const descByKey = new Map<string, string>();
  (sourceCategories ?? []).forEach((c) => {
    const description = (c.description as string | null) ?? "";
    if (description) {
      descByKey.set(`${c.company_id as string}|${c.code as string}`, description);
    }
  });

  // Overrides ja gravados para esta empresa de destino.
  const { data: overrides, error: overridesError } = await db
    .from(kind.table)
    .select(`source_company_id, omie_department_code, omie_category_code, ${kind.accountColumn}`)
    .eq("target_company_id", companyId);
  if (overridesError) {
    return NextResponse.json({ error: overridesError.message }, { status: 400 });
  }
  const overrideKey = (source: string, dept: string, category: string) =>
    `${source}|${dept}|${category}`;
  const overrideByKey = new Map<string, string>();
  (overrides ?? []).forEach((raw) => {
    const o = raw as unknown as Record<string, unknown>;
    const accountId = o[kind.accountColumn] as string | null;
    if (accountId) {
      overrideByKey.set(
        overrideKey(
          o.source_company_id as string,
          o.omie_department_code as string,
          o.omie_category_code as string,
        ),
        accountId,
      );
    }
  });

  // Para cada departamento roteado, busca as categorias usadas (via RPC) e
  // monta a secao com o override atual de cada categoria.
  const sections: Section[] = [];
  for (const dept of routedDepts) {
    const sourceCompanyId = dept.company_id as string;
    const departmentCode = dept.omie_code as string;
    const { data: categories, error: catError } = await db.rpc(
      "routed_department_categories",
      {
        p_source_company_id: sourceCompanyId,
        p_department_code: departmentCode,
      },
    );
    if (catError) {
      return NextResponse.json({ error: catError.message }, { status: 400 });
    }

    const categoryItems: CategoryItem[] = (categories ?? []).map(
      (c: { category_code: string; category_name: string | null }) => ({
        code: c.category_code,
        name:
          descByKey.get(`${sourceCompanyId}|${c.category_code}`) ??
          c.category_name ??
          c.category_code,
        accountId:
          overrideByKey.get(
            overrideKey(sourceCompanyId, departmentCode, c.category_code),
          ) ?? null,
      }),
    );

    sections.push({
      sourceCompanyId,
      sourceCompanyName: sourceNameById.get(sourceCompanyId) ?? "Empresa",
      departmentCode,
      departmentName: (dept.name as string) ?? departmentCode,
      categories: categoryItems,
    });
  }

  // Ordena por empresa de origem e depois por nome do departamento.
  sections.sort(
    (a, b) =>
      a.sourceCompanyName.localeCompare(b.sourceCompanyName) ||
      a.departmentName.localeCompare(b.departmentName),
  );

  return NextResponse.json({ sections });
}

export async function POST(request: Request) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user || !profile) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (profile.role !== "admin") {
    return NextResponse.json({ error: "Acesso restrito ao admin." }, { status: 403 });
  }

  const body = (await request.json()) as {
    companyId?: string;
    kind?: string;
    items?: Array<{
      sourceCompanyId?: string;
      departmentCode?: string;
      categoryCode?: string;
      categoryName?: string;
      accountId?: string | null;
    }>;
  };

  const companyId = body.companyId?.trim();
  const kind = resolveKind(body.kind ?? null);
  const items = Array.isArray(body.items) ? body.items : [];
  if (!companyId) {
    return NextResponse.json({ error: "Informe companyId." }, { status: 400 });
  }
  if (!kind) {
    return NextResponse.json({ error: "kind invalido (use dre|cashflow)." }, { status: 400 });
  }

  const db = createAdminClientIfAvailable() ?? supabase;

  let saved = 0;
  let cleared = 0;

  for (const item of items) {
    const sourceCompanyId = item.sourceCompanyId?.trim();
    const departmentCode = item.departmentCode?.trim();
    const categoryCode = item.categoryCode?.trim();
    if (!sourceCompanyId || !departmentCode || !categoryCode) continue;
    const accountId = item.accountId?.trim() || null;

    if (!accountId) {
      const { error } = await db
        .from(kind.table)
        .delete()
        .eq("target_company_id", companyId)
        .eq("source_company_id", sourceCompanyId)
        .eq("omie_department_code", departmentCode)
        .eq("omie_category_code", categoryCode);
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      cleared += 1;
      continue;
    }

    const row: Record<string, unknown> = {
      target_company_id: companyId,
      source_company_id: sourceCompanyId,
      omie_department_code: departmentCode,
      omie_category_code: categoryCode,
      omie_category_name: item.categoryName?.trim() ?? categoryCode,
      [kind.accountColumn]: accountId,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    };
    const { error } = await db.from(kind.table).upsert(row, {
      onConflict:
        "target_company_id,source_company_id,omie_department_code,omie_category_code",
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    saved += 1;
  }

  // Override de mapeamento roteado mudou -> recalcula a pre-agregacao da
  // empresa de DESTINO (cujos agregados incluem os lancamentos roteados).
  if (kind.table === "routed_category_mapping") {
    await refreshDreAggregatesForSource(db, companyId);
  } else if (kind.table === "routed_cash_flow_category_mapping") {
    await refreshCashFlowAggregatesForSource(db, companyId);
  }

  revalidatePath("/(app)", "layout");
  return NextResponse.json({ ok: true, saved, cleared });
}
