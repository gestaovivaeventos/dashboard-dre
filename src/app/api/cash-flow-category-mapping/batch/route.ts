import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { refreshCashFlowAggregatesForSource } from "@/lib/dashboard/aggregate-refresh";

interface BatchMappingItem {
  omieCategoryCode: string;
  omieCategoryName: string;
  cashFlowAccountId: string | null;
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
    mappings?: BatchMappingItem[];
  };

  const companyId = body.companyId?.trim();
  const mappings = body.mappings;

  if (!companyId || !Array.isArray(mappings) || mappings.length === 0) {
    return NextResponse.json(
      { error: "Informe companyId e ao menos um mapeamento." },
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

  const accountIds = Array.from(
    new Set(mappings.map((m) => m.cashFlowAccountId).filter(Boolean)),
  ) as string[];
  if (accountIds.length > 0) {
    const { data: accounts, error: accountsError } = await supabase
      .from("cash_flow_accounts")
      .select("id,source")
      .in("id", accountIds);
    if (accountsError) {
      return NextResponse.json({ error: accountsError.message }, { status: 400 });
    }
    const sourcedIds = new Set(
      (accounts ?? [])
        .filter((a) => (a.source as string | null))
        .map((a) => a.id as string),
    );
    const invalidSourced = accountIds.filter((id) => sourcedIds.has(id));
    if (invalidSourced.length > 0) {
      return NextResponse.json(
        { error: "Conta com origem especial nao recebe mapeamento." },
        { status: 400 },
      );
    }
    const validIds = new Set((accounts ?? []).map((a) => a.id as string));
    const invalid = accountIds.filter((id) => !validIds.has(id));
    if (invalid.length > 0) {
      return NextResponse.json(
        { error: `Contas de Fluxo de Caixa invalidas: ${invalid.join(", ")}` },
        { status: 400 },
      );
    }
  }

  const codes = mappings.map((m) => m.omieCategoryCode.trim());

  const { error: deleteError } = await supabase
    .from("cash_flow_category_mappings")
    .delete()
    .eq("company_id", companyId)
    .in("omie_category_code", codes);
  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 400 });
  }

  const toInsert = mappings
    .filter((m) => m.cashFlowAccountId)
    .map((m) => ({
      omie_category_code: m.omieCategoryCode.trim(),
      omie_category_name: m.omieCategoryName.trim() || m.omieCategoryCode.trim(),
      cash_flow_account_id: m.cashFlowAccountId,
      company_id: companyId,
      updated_by: user.id,
    }));

  if (toInsert.length > 0) {
    const { error: insertError } = await supabase
      .from("cash_flow_category_mappings")
      .insert(toInsert);
    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 400 });
    }
  }

  // Mudou o mapeamento de fluxo -> recalcula a pre-agregacao do Fluxo desta
  // empresa (e dos destinos de roteamento). Best-effort.
  await refreshCashFlowAggregatesForSource(supabase, companyId);

  revalidatePath("/(app)", "layout");
  return NextResponse.json({
    ok: true,
    saved: toInsert.length,
    cleared: codes.length - toInsert.length,
  });
}
