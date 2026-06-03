import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { getCurrentSessionContext } from "@/lib/auth/session";
import {
  SCOPED_DRE_ACCOUNTS_SELECT,
  fetchAllDreAccountRows,
  scopeDreAccounts,
  type RawDreAccount,
} from "@/lib/dashboard/dre";

interface CategoryMappingRow {
  code: string;
  description: string;
  mappingId: string | null;
  dreAccountId: string | null;
  dreAccountCode: string | null;
  dreAccountName: string | null;
  mappingScope: "company" | "global" | "none";
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
  if (!companyId) {
    return NextResponse.json({ error: "Informe companyId." }, { status: 400 });
  }

  const [
    { data: categories, error: categoriesError },
    { data: manualCategories, error: manualCategoriesError },
    { data: mappings, error: mappingsError },
    dreAccountsData,
  ] = await Promise.all([
    supabase
      .from("omie_categories")
      .select("code,description")
      .eq("company_id", companyId)
      .order("code"),
    // Categorias de lancamentos manuais (manual_entries) — surgem na MESMA
    // lista de mapeamento das categorias Omie para que o admin vincule cada
    // rotulo a uma conta DRE. category_code = rotulo digitado.
    supabase
      .from("manual_entries")
      .select("category_code,category_name")
      .eq("company_id", companyId),
    supabase
      .from("category_mapping")
      .select("id,omie_category_code,omie_category_name,dre_account_id,company_id")
      .or(`company_id.eq.${companyId},company_id.is.null`),
    // Carrega TODO o plano DRE ativo (global + custom de qualquer empresa) —
    // precisamos das duas pontas para conseguir traduzir um dre_account_id
    // global em seu equivalente clonado no plano custom da empresa selecionada.
    // Paginado: o cap de 1000 do PostgREST truncava os codes "8"/"9" (ver
    // fetchAllDreAccountRows).
    fetchAllDreAccountRows<RawDreAccount>((from, to) =>
      supabase
        .from("dre_accounts")
        .select(SCOPED_DRE_ACCOUNTS_SELECT)
        .eq("active", true)
        .order("code")
        .range(from, to),
    ),
  ]);

  if (categoriesError) {
    return NextResponse.json({ error: categoriesError.message }, { status: 400 });
  }
  if (manualCategoriesError) {
    return NextResponse.json({ error: manualCategoriesError.message }, { status: 400 });
  }
  if (mappingsError) {
    return NextResponse.json({ error: mappingsError.message }, { status: 400 });
  }

  // Escopo do plano DRE para esta empresa (mesma regra do Dashboard / Fluxo
  // de Caixa). Se a empresa tem plano custom, `scope.scopedAccounts` contem
  // SOMENTE as contas clonadas dela; `translateToScopedId` converte um id
  // do plano global no id clonado equivalente (matchando por `code`). Se a
  // empresa nao tem plano custom, o tradutor é identidade sobre o plano global.
  //
  // Sem essa traducao, mappings antigos (criados quando a empresa usava o
  // plano global ou via "global mapping" company_id IS NULL) ficariam com
  // `dreAccountId` apontando para um id que NAO aparece no dropdown (apos o
  // fix de dedup), fazendo o vinculo parecer "perdido" na tela.
  const dreScope = scopeDreAccounts(
    dreAccountsData,
    [companyId],
  );
  const accountById = new Map(
    dreScope.scopedAccounts.map((account) => [
      account.id,
      { code: account.code, name: account.name },
    ]),
  );

  const companyMappingByCode = new Map(
    (mappings ?? [])
      .filter((mapping) => (mapping.company_id as string | null) === companyId)
      .map((mapping) => [mapping.omie_category_code as string, mapping]),
  );
  const globalMappingByCode = new Map(
    (mappings ?? [])
      .filter((mapping) => (mapping.company_id as string | null) === null)
      .map((mapping) => [mapping.omie_category_code as string, mapping]),
  );

  // Filtrar categorias internas geradas automaticamente pelo sync (fundos ressarciveis)
  const omieVisible = (categories ?? []).filter(
    (c) => !(c.code as string).startsWith("__fundos_"),
  );

  // Mescla as categorias de lancamentos manuais (distinct por code). Quando um
  // code existe nas duas fontes, a categoria Omie tem precedencia.
  const seenCodes = new Set(omieVisible.map((c) => c.code as string));
  const manualVisible: Array<{ code: string; description: string }> = [];
  (manualCategories ?? []).forEach((c) => {
    const code = (c.category_code as string)?.trim();
    if (!code || seenCodes.has(code)) return;
    seenCodes.add(code);
    manualVisible.push({
      code,
      description: (c.category_name as string)?.trim() || code,
    });
  });

  const visibleCategories = [...omieVisible, ...manualVisible];

  const rows: CategoryMappingRow[] = visibleCategories.map((category) => {
    const code = category.code as string;
    const companyMapping = companyMappingByCode.get(code);
    const globalMapping = globalMappingByCode.get(code);
    const effective = companyMapping ?? globalMapping ?? null;
    const rawDreAccountId = (effective?.dre_account_id as string | null) ?? null;
    // Traduz para o id no escopo da empresa selecionada. Quando a empresa
    // tem plano custom, isso converte um id global em seu clone. Quando nao
    // tem, devolve o proprio id global. Retorna null se a conta nao existe
    // mais (inativa/removida) — nesse caso o vinculo aparece como "nao
    // mapeado" e o admin pode remapear.
    const scopedDreAccountId = rawDreAccountId
      ? dreScope.translateToScopedId(rawDreAccountId)
      : null;
    const account = scopedDreAccountId ? accountById.get(scopedDreAccountId) : null;

    return {
      code,
      description: (category.description as string) || code,
      mappingId: (effective?.id as string | null) ?? null,
      dreAccountId: scopedDreAccountId,
      dreAccountCode: account?.code ?? null,
      dreAccountName: account?.name ?? null,
      mappingScope: companyMapping ? "company" : globalMapping ? "global" : "none",
    };
  });

  return NextResponse.json({ rows });
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
    omieCategoryCode?: string;
    omieCategoryName?: string;
    dreAccountId?: string | null;
  };

  const companyId = body.companyId?.trim();
  const omieCategoryCode = body.omieCategoryCode?.trim();
  const omieCategoryName = body.omieCategoryName?.trim() ?? body.omieCategoryCode?.trim() ?? "";
  const dreAccountId = body.dreAccountId?.trim() ?? null;

  if (!companyId || !omieCategoryCode) {
    return NextResponse.json(
      { error: "Informe companyId e omieCategoryCode." },
      { status: 400 },
    );
  }

  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("id")
    .eq("id", companyId)
    .single();
  if (companyError || !company) {
    return NextResponse.json({ error: "Empresa nao encontrada." }, { status: 404 });
  }

  if (dreAccountId) {
    const { data: account, error: accountError } = await supabase
      .from("dre_accounts")
      .select("id")
      .eq("id", dreAccountId)
      .single();
    if (accountError || !account) {
      return NextResponse.json({ error: "Conta DRE invalida." }, { status: 400 });
    }
  }

  const { error: deleteError } = await supabase
    .from("category_mapping")
    .delete()
    .eq("company_id", companyId)
    .eq("omie_category_code", omieCategoryCode);
  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 400 });
  }

  if (!dreAccountId) {
    revalidatePath("/(app)", "layout");
    return NextResponse.json({ ok: true, mapping: null });
  }

  const { data, error } = await supabase
    .from("category_mapping")
    .insert({
      omie_category_code: omieCategoryCode,
      omie_category_name: omieCategoryName,
      dre_account_id: dreAccountId,
      company_id: companyId,
      updated_by: user.id,
    })
    .select("id,omie_category_code,omie_category_name,dre_account_id,company_id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  revalidatePath("/(app)", "layout");
  return NextResponse.json({ ok: true, mapping: data });
}
