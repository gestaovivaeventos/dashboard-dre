import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

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
  const clearedCodes = mappings
    .filter((m) => !m.dreAccountId)
    .map((m) => m.omieCategoryCode.trim());

  // Identifica codes desmapeados que tem mapeamento GLOBAL (company_id IS NULL).
  // Estes precisam de uma linha company-scoped com dre_account_id = NULL
  // (tombstone) para sobrescrever o global — apenas deletar a linha
  // company-scoped faria o global ressurgir na proxima carga.
  //
  // Codes sem global mapping nao precisam de tombstone — DELETE basta.
  const codesNeedingTombstone = new Set<string>();
  if (clearedCodes.length > 0) {
    const { data: globalMappings, error: globalErr } = await supabase
      .from("category_mapping")
      .select("omie_category_code")
      .is("company_id", null)
      .in("omie_category_code", clearedCodes);
    if (globalErr) {
      return NextResponse.json({ error: globalErr.message }, { status: 400 });
    }
    (globalMappings ?? []).forEach((g) =>
      codesNeedingTombstone.add(g.omie_category_code as string),
    );
  }

  // Deletar mapeamentos existentes para os códigos alterados
  const { error: deleteError } = await supabase
    .from("category_mapping")
    .delete()
    .eq("company_id", companyId)
    .in("omie_category_code", codes);
  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 400 });
  }

  // Inserir novos mapeamentos (com conta DRE) + tombstones (sem conta) para
  // codes que precisam sobrescrever um mapeamento global.
  const toInsert = mappings
    .filter(
      (m) =>
        m.dreAccountId ||
        codesNeedingTombstone.has(m.omieCategoryCode.trim()),
    )
    .map((m) => ({
      omie_category_code: m.omieCategoryCode.trim(),
      omie_category_name: m.omieCategoryName.trim() || m.omieCategoryCode.trim(),
      dre_account_id: m.dreAccountId ?? null,
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

  const savedNonNull = toInsert.filter((r) => r.dre_account_id !== null).length;
  const tombstones = toInsert.filter((r) => r.dre_account_id === null).length;
  revalidatePath("/(app)", "layout");
  return NextResponse.json({
    ok: true,
    saved: savedNonNull,
    cleared: clearedCodes.length,
    tombstones,
  });
}
