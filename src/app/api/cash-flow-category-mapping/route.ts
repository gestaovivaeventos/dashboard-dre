import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { getCurrentSessionContext } from "@/lib/auth/session";

interface CashFlowMappingRow {
  code: string;
  description: string;
  mappingId: string | null;
  cashFlowAccountId: string | null;
  cashFlowAccountCode: string | null;
  cashFlowAccountName: string | null;
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
      .from("cash_flow_category_mappings")
      .select("id,omie_category_code,omie_category_name,cash_flow_account_id,company_id")
      .or(`company_id.eq.${companyId},company_id.is.null`),
  ]);

  if (categoriesError) {
    return NextResponse.json({ error: categoriesError.message }, { status: 400 });
  }
  if (mappingsError) {
    return NextResponse.json({ error: mappingsError.message }, { status: 400 });
  }

  const accountIds = Array.from(
    new Set((mappings ?? []).map((item) => item.cash_flow_account_id as string | null).filter(Boolean)),
  ) as string[];
  const { data: accounts, error: accountsError } = accountIds.length
    ? await supabase
        .from("cash_flow_accounts")
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

  const visibleCategories = (categories ?? []).filter(
    (c) => !(c.code as string).startsWith("__fundos_"),
  );

  const rows: CashFlowMappingRow[] = visibleCategories.map((category) => {
    const code = category.code as string;
    const companyMapping = companyMappingByCode.get(code);
    const globalMapping = globalMappingByCode.get(code);
    const effective = companyMapping ?? globalMapping ?? null;
    const accountId = (effective?.cash_flow_account_id as string | null) ?? null;
    const account = accountId ? accountById.get(accountId) : null;

    return {
      code,
      description: (category.description as string) || code,
      mappingId: (effective?.id as string | null) ?? null,
      cashFlowAccountId: accountId,
      cashFlowAccountCode: account?.code ?? null,
      cashFlowAccountName: account?.name ?? null,
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
    cashFlowAccountId?: string | null;
  };

  const companyId = body.companyId?.trim();
  const omieCategoryCode = body.omieCategoryCode?.trim();
  const omieCategoryName = body.omieCategoryName?.trim() ?? body.omieCategoryCode?.trim() ?? "";
  const cashFlowAccountId = body.cashFlowAccountId?.trim() ?? null;

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

  if (cashFlowAccountId) {
    const { data: account, error: accountError } = await supabase
      .from("cash_flow_accounts")
      .select("id,source")
      .eq("id", cashFlowAccountId)
      .single();
    if (accountError || !account) {
      return NextResponse.json({ error: "Conta de Fluxo de Caixa invalida." }, { status: 400 });
    }
    if ((account.source as string | null)) {
      return NextResponse.json(
        { error: "Esta conta tem origem especial (ex.: vinda do DRE) e nao recebe mapeamento." },
        { status: 400 },
      );
    }
  }

  const { error: deleteError } = await supabase
    .from("cash_flow_category_mappings")
    .delete()
    .eq("company_id", companyId)
    .eq("omie_category_code", omieCategoryCode);
  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 400 });
  }

  if (!cashFlowAccountId) {
    revalidatePath("/(app)", "layout");
    return NextResponse.json({ ok: true, mapping: null });
  }

  const { data, error } = await supabase
    .from("cash_flow_category_mappings")
    .insert({
      omie_category_code: omieCategoryCode,
      omie_category_name: omieCategoryName,
      cash_flow_account_id: cashFlowAccountId,
      company_id: companyId,
      updated_by: user.id,
    })
    .select("id,omie_category_code,omie_category_name,cash_flow_account_id,company_id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  revalidatePath("/(app)", "layout");
  return NextResponse.json({ ok: true, mapping: data });
}
