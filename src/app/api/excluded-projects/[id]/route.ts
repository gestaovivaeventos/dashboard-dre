import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { getCurrentSessionContext } from "@/lib/auth/session";
import {
  refreshCashFlowAggregatesForSource,
  refreshDreAggregatesForSource,
} from "@/lib/dashboard/aggregate-refresh";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";

// Remove um projeto da lista de desconsiderados e recalcula os agregados da
// empresa: os lancamentos nunca sairam de financial_entries, entao voltam a
// ser somados no mesmo instante — sem re-sync.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user || !profile) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (profile.role !== "admin") {
    return NextResponse.json({ error: "Acesso restrito ao admin." }, { status: 403 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Informe id." }, { status: 400 });
  }

  // Precisamos da empresa ANTES de apagar, para saber o que recalcular.
  const { data: row, error: readError } = await supabase
    .from("company_excluded_projects")
    .select("company_id")
    .eq("id", id)
    .maybeSingle<{ company_id: string }>();
  if (readError) {
    return NextResponse.json({ error: readError.message }, { status: 400 });
  }
  if (!row) {
    return NextResponse.json({ error: "Registro nao encontrado." }, { status: 404 });
  }

  const { error } = await supabase.from("company_excluded_projects").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const db = createAdminClientIfAvailable() ?? supabase;
  const [dre, cash] = await Promise.all([
    refreshDreAggregatesForSource(db, row.company_id),
    refreshCashFlowAggregatesForSource(db, row.company_id),
  ]);
  const refreshError =
    [dre, cash].filter((r) => !r.ok).map((r) => r.error).join(" / ") || null;

  revalidatePath("/(app)", "layout");
  return NextResponse.json({ ok: true, refreshError });
}
