import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { getCurrentSessionContext } from "@/lib/auth/session";
import {
  refreshCashFlowAggregatesForSource,
  refreshDreAggregatesForSource,
} from "@/lib/dashboard/aggregate-refresh";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";

// ============================================================================
// Projetos desconsiderados por empresa (company_excluded_projects)
//
// Projeto da Omie cujos lancamentos NAO entram em nenhum numero do Financeiro
// da empresa (DRE, Fluxo, Previsto x Realizado, drilldowns). A regra vive no
// banco e e aplicada pelas funcoes SQL de agregacao (ver migration
// 20260916120000): aqui so se cadastra/remove e se dispara o refresh dos
// agregados, para o efeito aparecer na hora — e ser desfeito na hora.
//
// O refresh usa o admin client: desde 20260903120000 as funcoes refresh_* so
// aceitam service_role; com o client do usuario a chamada falha em silencio.
// ============================================================================

export interface ExcludedProjectRow {
  id: string;
  omieProjectCode: string;
  omieProjectName: string | null;
  note: string | null;
  createdAt: string;
}

async function refreshAggregates(companyId: string, fallback: Parameters<typeof refreshDreAggregatesForSource>[0]) {
  const db = createAdminClientIfAvailable() ?? fallback;
  const [dre, cash] = await Promise.all([
    refreshDreAggregatesForSource(db, companyId),
    refreshCashFlowAggregatesForSource(db, companyId),
  ]);
  const errors = [dre, cash].filter((r) => !r.ok).map((r) => r.error);
  return errors.length > 0 ? errors.join(" / ") : null;
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

  const { data, error } = await supabase
    .from("company_excluded_projects")
    .select("id,omie_project_code,omie_project_name,note,created_at")
    .eq("company_id", companyId)
    .order("omie_project_name", { ascending: true, nullsFirst: false })
    .order("omie_project_code");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const rows: ExcludedProjectRow[] = (data ?? []).map((r) => ({
    id: r.id as string,
    omieProjectCode: r.omie_project_code as string,
    omieProjectName: (r.omie_project_name as string | null) ?? null,
    note: (r.note as string | null) ?? null,
    createdAt: r.created_at as string,
  }));
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

  const body = (await request.json().catch(() => ({}))) as {
    companyId?: string;
    omieProjectCode?: string;
    omieProjectName?: string | null;
    note?: string | null;
  };
  const companyId = body.companyId?.trim();
  const omieProjectCode = body.omieProjectCode?.trim();
  if (!companyId || !omieProjectCode) {
    return NextResponse.json({ error: "Informe companyId e omieProjectCode." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("company_excluded_projects")
    .insert({
      company_id: companyId,
      omie_project_code: omieProjectCode,
      omie_project_name: body.omieProjectName?.trim() || null,
      note: body.note?.trim() || null,
      created_by: user.id,
    })
    .select("id,omie_project_code,omie_project_name,note,created_at")
    .single();
  if (error) {
    const msg =
      error.code === "23505"
        ? "Este projeto ja esta na lista de desconsiderados desta empresa."
        : error.message;
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const refreshError = await refreshAggregates(companyId, supabase);
  revalidatePath("/(app)", "layout");
  return NextResponse.json({
    ok: true,
    row: {
      id: data.id,
      omieProjectCode: data.omie_project_code,
      omieProjectName: data.omie_project_name,
      note: data.note,
      createdAt: data.created_at,
    } satisfies ExcludedProjectRow,
    // Projeto ficou gravado mesmo se o refresh falhou — o agregado so fica
    // defasado ate o proximo sync. A tela avisa, em vez de esconder.
    refreshError,
  });
}
