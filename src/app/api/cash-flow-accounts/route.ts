import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";

export async function GET() {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user || !profile) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (profile.role !== "admin") {
    return NextResponse.json({ error: "Acesso restrito ao admin." }, { status: 403 });
  }

  const [{ data: accounts, error: accountsError }, { data: mappings, error: mappingsError }] =
    await Promise.all([
      supabase
        .from("cash_flow_accounts")
        .select("id,code,name,parent_id,level,type,is_summary,formula,source,is_highlight_block,sort_order,active")
        .order("sort_order"),
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
    type: account.type as "receita" | "despesa" | "calculado" | "misto",
    is_summary: account.is_summary as boolean,
    formula: (account.formula as string | null) ?? null,
    source: (account.source as string | null) ?? null,
    is_highlight_block: account.is_highlight_block as boolean,
    sort_order: account.sort_order as number,
    active: account.active as boolean,
    mappings: mappingByAccount.get(account.id as string) ?? [],
  }));

  return NextResponse.json({ accounts: payload });
}
