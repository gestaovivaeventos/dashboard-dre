import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { getCurrentSessionContext } from "@/lib/auth/session";

type CashFlowType = "receita" | "despesa" | "calculado" | "misto";

export async function GET(request: Request) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user || !profile) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (profile.role !== "admin") {
    return NextResponse.json({ error: "Acesso restrito ao admin." }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get("companyId");

  // Scope resolution: if a companyId is given AND that company has any
  // customized rows, return the per-company plan; otherwise return the
  // global plan (company_id IS NULL). This preserves current behavior for
  // companies that have not been customized yet.
  let scopeCompanyId: string | null = null;
  let usingCustomPlan = false;

  if (companyId) {
    const { count } = await supabase
      .from("cash_flow_accounts")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId);
    if ((count ?? 0) > 0) {
      scopeCompanyId = companyId;
      usingCustomPlan = true;
    }
  }

  let accountsQuery = supabase
    .from("cash_flow_accounts")
    .select("id,code,name,parent_id,level,type,is_summary,formula,source,is_highlight_block,sort_order,active,company_id")
    .order("sort_order");
  accountsQuery = usingCustomPlan
    ? accountsQuery.eq("company_id", scopeCompanyId)
    : accountsQuery.is("company_id", null);

  const [{ data: accounts, error: accountsError }, { data: mappings, error: mappingsError }] =
    await Promise.all([
      accountsQuery,
      supabase
        .from("cash_flow_category_mappings")
        .select("id,omie_category_code,omie_category_name,cash_flow_account_id,company_id")
        .order("omie_category_code"),
    ]);

  if (accountsError) {
    return NextResponse.json({ error: accountsError.message }, { status: 400 });
  }
  if (mappingsError) {
    return NextResponse.json({ error: mappingsError.message }, { status: 400 });
  }

  const mappingByAccount = new Map<
    string,
    Array<{ id: string; code: string; name: string; company_id: string | null }>
  >();
  (mappings ?? []).forEach((mapping) => {
    const accountId = mapping.cash_flow_account_id as string;
    const arr = mappingByAccount.get(accountId) ?? [];
    arr.push({
      id: mapping.id as string,
      code: mapping.omie_category_code as string,
      name: mapping.omie_category_name as string,
      company_id: (mapping.company_id as string | null) ?? null,
    });
    mappingByAccount.set(accountId, arr);
  });

  const payload = (accounts ?? []).map((account) => ({
    id: account.id as string,
    code: account.code as string,
    name: account.name as string,
    parent_id: (account.parent_id as string | null) ?? null,
    level: account.level as number,
    type: account.type as CashFlowType,
    is_summary: account.is_summary as boolean,
    formula: (account.formula as string | null) ?? null,
    source: (account.source as string | null) ?? null,
    is_highlight_block: account.is_highlight_block as boolean,
    sort_order: account.sort_order as number,
    active: account.active as boolean,
    company_id: (account.company_id as string | null) ?? null,
    mappings: mappingByAccount.get(account.id as string) ?? [],
  }));

  return NextResponse.json({
    accounts: payload,
    scope: {
      companyId: scopeCompanyId,
      usingCustomPlan,
    },
  });
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
    company_id?: string | null;
    code?: string;
    name?: string;
    type?: CashFlowType;
    parent_id?: string | null;
    is_summary?: boolean;
    formula?: string | null;
    sort_order?: number;
    active?: boolean;
  };

  const code = body.code?.trim();
  const name = body.name?.trim();
  const type = body.type ?? "despesa";
  const companyId = body.company_id ?? null;
  const parentId = body.parent_id ?? null;
  const formula = body.formula?.trim() || null;
  const isSummary = type === "calculado" ? true : Boolean(body.is_summary);

  if (!code) {
    return NextResponse.json({ error: "Codigo e obrigatorio." }, { status: 400 });
  }
  if (!/^\d+(\.\d+)*$/.test(code)) {
    return NextResponse.json(
      { error: "Codigo deve seguir o formato '1', '1.1', '1.1.1' etc." },
      { status: 400 },
    );
  }
  if (!name) {
    return NextResponse.json({ error: "Nome e obrigatorio." }, { status: 400 });
  }
  if (type === "calculado" && !formula) {
    return NextResponse.json(
      { error: "Conta calculada exige formula obrigatoria." },
      { status: 400 },
    );
  }

  // Per the editor rule, new accounts are always created as leaves and must
  // attach to an existing parent in the same scope. Top-level creation is
  // disallowed (use the global plan for that).
  if (!parentId) {
    return NextResponse.json(
      { error: "Selecione uma conta pai. Novas contas so podem ser criadas no ultimo nivel da estrutura." },
      { status: 400 },
    );
  }

  const { data: parent, error: parentError } = await supabase
    .from("cash_flow_accounts")
    .select("id,company_id")
    .eq("id", parentId)
    .maybeSingle<{ id: string; company_id: string | null }>();
  if (parentError) {
    return NextResponse.json({ error: parentError.message }, { status: 400 });
  }
  if (!parent) {
    return NextResponse.json({ error: "Conta pai nao encontrada." }, { status: 400 });
  }
  if ((parent.company_id ?? null) !== companyId) {
    return NextResponse.json(
      { error: "Conta pai pertence a outro escopo (global ou empresa diferente)." },
      { status: 400 },
    );
  }

  const insertPayload = {
    code,
    name,
    type,
    parent_id: parentId,
    is_summary: isSummary,
    formula,
    source: null,
    is_highlight_block: false,
    sort_order: typeof body.sort_order === "number" ? body.sort_order : 0,
    active: body.active ?? true,
    company_id: companyId,
    // `level` is recomputed by cash_flow_accounts_set_level trigger.
    level: code.split(".").length,
  };

  const { data, error } = await supabase
    .from("cash_flow_accounts")
    .insert(insertPayload)
    .select("id,code,name,parent_id,level,type,is_summary,formula,source,is_highlight_block,sort_order,active,company_id")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Falha ao criar conta." },
      { status: 400 },
    );
  }

  // Garante que a tela de mapeamento (server-render) recarregue a lista
  // de contas e passe a oferecer a nova conta no select da empresa dona.
  revalidatePath("/(app)", "layout");
  return NextResponse.json({ account: data });
}
