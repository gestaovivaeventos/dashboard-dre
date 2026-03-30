import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";

interface BatchMappingItem {
  omieCategoryCode: string;
  omieCategoryName: string;
  dreAccountId: string | null;
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

  // Validar empresa
  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("id")
    .eq("id", companyId)
    .single();
  if (companyError || !company) {
    return NextResponse.json({ error: "Empresa nao encontrada." }, { status: 404 });
  }

  // Validar contas DRE referenciadas
  const dreAccountIds = Array.from(
    new Set(mappings.map((m) => m.dreAccountId).filter(Boolean)),
  ) as string[];
  if (dreAccountIds.length > 0) {
    const { data: accounts, error: accountsError } = await supabase
      .from("dre_accounts")
      .select("id")
      .in("id", dreAccountIds);
    if (accountsError) {
      return NextResponse.json({ error: accountsError.message }, { status: 400 });
    }
    const validIds = new Set((accounts ?? []).map((a) => a.id as string));
    const invalid = dreAccountIds.filter((id) => !validIds.has(id));
    if (invalid.length > 0) {
      return NextResponse.json(
        { error: `Contas DRE invalidas: ${invalid.join(", ")}` },
        { status: 400 },
      );
    }
  }

  // Processar cada mapeamento
  const codes = mappings.map((m) => m.omieCategoryCode.trim());

  // Deletar mapeamentos existentes para os códigos alterados
  const { error: deleteError } = await supabase
    .from("category_mapping")
    .delete()
    .eq("company_id", companyId)
    .in("omie_category_code", codes);
  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 400 });
  }

  // Inserir novos mapeamentos (apenas os que têm conta DRE)
  const toInsert = mappings
    .filter((m) => m.dreAccountId)
    .map((m) => ({
      omie_category_code: m.omieCategoryCode.trim(),
      omie_category_name: m.omieCategoryName.trim() || m.omieCategoryCode.trim(),
      dre_account_id: m.dreAccountId,
      company_id: companyId,
      updated_by: user.id,
    }));

  if (toInsert.length > 0) {
    const { error: insertError } = await supabase
      .from("category_mapping")
      .insert(toInsert);
    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 400 });
    }
  }

  return NextResponse.json({
    ok: true,
    saved: toInsert.length,
    cleared: codes.length - toInsert.length,
  });
}
