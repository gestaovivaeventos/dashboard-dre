import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";

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
    { data: mappings, error: mappingsError },
  ] = await Promise.all([
    supabase
      .from("omie_categories")
      .select("code,description")
      .eq("company_id", companyId)
      .order("code"),
    supabase
      .from("category_mapping")
      .select("id,omie_category_code,omie_category_name,dre_account_id,company_id")
      .or(`company_id.eq.${companyId},company_id.is.null`),
  ]);

  if (categoriesError) {
    return NextResponse.json({ error: categoriesError.message }, { status: 400 });
  }
  if (mappingsError) {
    return NextResponse.json({ error: mappingsError.message }, { status: 400 });
  }

  const accountIds = Array.from(
    new Set((mappings ?? []).map((item) => item.dre_account_id as string | null).filter(Boolean)),
  ) as string[];
  const { data: accounts, error: accountsError } = accountIds.length
    ? await supabase
        .from("dre_accounts")
        .select("id,code,name")
        .in("id", accountIds)
    : { data: [], error: null };

  if (accountsError) {
    return NextResponse.json({ error: accountsError.message }, { status: 400 });
  }

  const accountById = new Map(
    (accounts ?? []).map((account) => [
      account.id as string,
      { code: account.code as string, name: account.name as string },
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
  const visibleCategories = (categories ?? []).filter(
    (c) => !(c.code as string).startsWith("__fundos_"),
  );

  const rows: CategoryMappingRow[] = visibleCategories.map((category) => {
    const code = category.code as string;
    const companyMapping = companyMappingByCode.get(code);
    const globalMapping = globalMappingByCode.get(code);
    const effective = companyMapping ?? globalMapping ?? null;
    const dreAccountId = (effective?.dre_account_id as string | null) ?? null;
    const account = dreAccountId ? accountById.get(dreAccountId) : null;

    return {
      code,
      description: (category.description as string) || code,
      mappingId: (effective?.id as string | null) ?? null,
      dreAccountId,
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

  return NextResponse.json({ ok: true, mapping: data });
}
