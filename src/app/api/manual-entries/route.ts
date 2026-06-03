import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";

// Lancamentos manuais (Categoria, Data, Valor) de uma empresa. As categorias
// digitadas aqui aparecem na tela de Mapeamento (via union no GET de
// category-mapping) e sao vinculadas a contas DRE pelo mesmo `category_mapping`
// das categorias Omie. O valor entra no DRE pela RPC dashboard_dre_aggregate.

interface ManualEntryItem {
  categoryName?: string;
  entryDate?: string;
  value?: number | string;
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

  const db = createAdminClientIfAvailable() ?? supabase;

  const { data, error } = await db
    .from("manual_entries")
    .select("id, category_code, category_name, entry_date, value")
    .eq("company_id", companyId)
    .order("entry_date", { ascending: true })
    .order("category_name", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const entries = (data ?? []).map((row) => ({
    id: row.id as string,
    categoryName: (row.category_name as string) ?? (row.category_code as string),
    entryDate: row.entry_date as string,
    value: Number(row.value ?? 0),
  }));

  return NextResponse.json({ entries });
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
    entries?: ManualEntryItem[];
  };

  const companyId = body.companyId?.trim();
  const rawEntries = Array.isArray(body.entries) ? body.entries : [];
  if (!companyId) {
    return NextResponse.json({ error: "Informe companyId." }, { status: 400 });
  }

  // Normaliza e descarta linhas incompletas/invalidas.
  const rows = rawEntries
    .map((item) => {
      const categoryName = item.categoryName?.trim() ?? "";
      const entryDate = item.entryDate?.trim() ?? "";
      const value =
        typeof item.value === "number" ? item.value : Number(item.value);
      return { categoryName, entryDate, value };
    })
    .filter(
      (r) =>
        r.categoryName !== "" &&
        /^\d{4}-\d{2}-\d{2}$/.test(r.entryDate) &&
        Number.isFinite(r.value),
    )
    .map((r) => ({
      company_id: companyId,
      category_code: r.categoryName,
      category_name: r.categoryName,
      entry_date: r.entryDate,
      value: r.value,
      created_by: user.id,
    }));

  const db = createAdminClientIfAvailable() ?? supabase;

  // Replace-all: o grid representa o conjunto inteiro da empresa.
  const { error: deleteError } = await db
    .from("manual_entries")
    .delete()
    .eq("company_id", companyId);
  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 400 });
  }

  if (rows.length > 0) {
    const { error: insertError } = await db.from("manual_entries").insert(rows);
    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 400 });
    }
  }

  revalidatePath("/(app)", "layout");
  return NextResponse.json({ ok: true, saved: rows.length });
}
