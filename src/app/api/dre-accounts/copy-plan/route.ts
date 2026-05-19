import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";

interface SourceAccount {
  id: string;
  code: string;
  name: string;
  parent_id: string | null;
  level: number;
  type: "receita" | "despesa" | "calculado" | "misto";
  is_summary: boolean;
  formula: string | null;
  sort_order: number;
  active: boolean;
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
    sourceCompanyId?: string | null;
    targetCompanyId?: string;
    force?: boolean;
  };

  const targetCompanyId = body.targetCompanyId;
  const sourceCompanyId = body.sourceCompanyId ?? null;
  const force = body.force === true;

  if (!targetCompanyId) {
    return NextResponse.json(
      { error: "Empresa destino e obrigatoria." },
      { status: 400 },
    );
  }
  if (sourceCompanyId === targetCompanyId) {
    return NextResponse.json(
      { error: "Empresa origem e destino devem ser diferentes." },
      { status: 400 },
    );
  }

  // Resolve which plan to copy from:
  // - If sourceCompanyId is provided AND that company has custom accounts, use those.
  // - Otherwise (null or no custom accounts), copy the global plan.
  let scopeQuery = supabase
    .from("dre_accounts")
    .select("id,code,name,parent_id,level,type,is_summary,formula,sort_order,active");

  if (sourceCompanyId) {
    const { count } = await supabase
      .from("dre_accounts")
      .select("id", { count: "exact", head: true })
      .eq("company_id", sourceCompanyId);
    if ((count ?? 0) > 0) {
      scopeQuery = scopeQuery.eq("company_id", sourceCompanyId);
    } else {
      scopeQuery = scopeQuery.is("company_id", null);
    }
  } else {
    scopeQuery = scopeQuery.is("company_id", null);
  }

  const { data: sourceAccounts, error: sourceError } = await scopeQuery.order("code");
  if (sourceError) {
    return NextResponse.json({ error: sourceError.message }, { status: 400 });
  }
  if (!sourceAccounts || sourceAccounts.length === 0) {
    return NextResponse.json({ error: "Plano origem esta vazio." }, { status: 400 });
  }

  // Check whether target already has custom accounts.
  const { data: existingTarget, error: existingError } = await supabase
    .from("dre_accounts")
    .select("id")
    .eq("company_id", targetCompanyId);
  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 400 });
  }
  const targetHasAccounts = (existingTarget?.length ?? 0) > 0;

  if (targetHasAccounts && !force) {
    return NextResponse.json(
      {
        error: "A empresa destino ja possui plano customizado.",
        existingCount: existingTarget?.length ?? 0,
        hint: "Reenvie a requisicao com { force: true } para substituir todas as contas atuais. Isso tambem remove os mapeamentos que apontam para essas contas.",
      },
      { status: 409 },
    );
  }

  // If forcing, delete existing custom accounts (cascade deletes mappings).
  if (targetHasAccounts && force) {
    const { error: deleteError } = await supabase
      .from("dre_accounts")
      .delete()
      .eq("company_id", targetCompanyId);
    if (deleteError) {
      return NextResponse.json(
        { error: `Falha ao limpar plano destino: ${deleteError.message}` },
        { status: 400 },
      );
    }
  }

  // Two-pass insert to preserve parent_id relationships:
  //   1) Insert all rows with parent_id = NULL to get new IDs
  //   2) Update parent_id for rows that had a parent in the source

  const accounts = sourceAccounts as SourceAccount[];

  // Sort by hierarchy (parents before children) so we can resolve parents
  // in the second pass even if Postgres returns rows in a different order.
  accounts.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));

  const insertRows = accounts.map((account) => ({
    code: account.code,
    name: account.name,
    parent_id: null as string | null,
    type: account.type,
    is_summary: account.is_summary,
    formula: account.formula,
    sort_order: account.sort_order,
    active: account.active,
    company_id: targetCompanyId,
    level: account.code.split(".").length,
  }));

  const { data: inserted, error: insertError } = await supabase
    .from("dre_accounts")
    .insert(insertRows)
    .select("id,code");

  if (insertError) {
    return NextResponse.json(
      { error: `Falha ao copiar contas: ${insertError.message}` },
      { status: 400 },
    );
  }

  // Build a code → newId map for the freshly inserted rows.
  const newIdByCode = new Map<string, string>();
  (inserted ?? []).forEach((row) => {
    newIdByCode.set(row.code as string, row.id as string);
  });

  // Build parent updates: each source account that had a parent_id now
  // needs to point to the newly-inserted account with the parent's code.
  const oldIdToCode = new Map<string, string>();
  accounts.forEach((account) => {
    oldIdToCode.set(account.id, account.code);
  });

  const parentUpdates: Array<{ id: string; parent_id: string }> = [];
  accounts.forEach((account) => {
    if (!account.parent_id) return;
    const parentCode = oldIdToCode.get(account.parent_id);
    if (!parentCode) return;
    const newChildId = newIdByCode.get(account.code);
    const newParentId = newIdByCode.get(parentCode);
    if (newChildId && newParentId) {
      parentUpdates.push({ id: newChildId, parent_id: newParentId });
    }
  });

  for (const update of parentUpdates) {
    const { error: updateError } = await supabase
      .from("dre_accounts")
      .update({ parent_id: update.parent_id })
      .eq("id", update.id);
    if (updateError) {
      return NextResponse.json(
        {
          error: `Falha ao restabelecer hierarquia: ${updateError.message}`,
          partial: true,
          copied: inserted?.length ?? 0,
        },
        { status: 400 },
      );
    }
  }

  return NextResponse.json({
    ok: true,
    copied: inserted?.length ?? 0,
  });
}
