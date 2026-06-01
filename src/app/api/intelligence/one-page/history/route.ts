import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

// ============================================================================
// GET /api/intelligence/one-page/history
//
// Lista os relatorios One Page gerados pelo usuario logado nos ULTIMOS 30
// DIAS. Cada usuario ve apenas seus proprios relatorios (filtro por
// `created_by`).
//
// Resposta: { reports: Array<{
//   id, empresa, periodo, periodFrom, periodTo, generatedAt, createdAt
// }> }
//
// O JSON completo de cada relatorio NAO e devolvido aqui (so na rota de
// detalhe). Mantem a listagem leve para nao baixar payloads grandes.
// ============================================================================

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_RESULTS = 50;

interface AiReportRow {
  id: string;
  period_from: string;
  period_to: string;
  created_at: string;
  content_json: {
    input?: {
      empresa?: { nome?: string };
      periodo?: { label?: string };
    };
    generatedAt?: string;
  } | null;
}

export async function GET() {
  const { user, profile } = await getCurrentSessionContext();
  if (!user || !profile) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  // A listagem ja e escopada por created_by = user.id, entao cada usuario ve
  // apenas seus proprios relatorios. Exigimos so acesso ao modulo Financeiro.
  if (!profile.can_financeiro) {
    return NextResponse.json({ error: "Acesso restrito." }, { status: 403 });
  }

  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();

  const { data, error } = await admin
    .from("ai_reports")
    .select("id, period_from, period_to, created_at, content_json")
    .eq("type", "one-page")
    .eq("created_by", user.id)
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(MAX_RESULTS);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const reports = ((data ?? []) as AiReportRow[]).map((r) => ({
    id: r.id,
    empresa: r.content_json?.input?.empresa?.nome ?? "—",
    periodo: r.content_json?.input?.periodo?.label ?? "—",
    periodFrom: r.period_from,
    periodTo: r.period_to,
    generatedAt: r.content_json?.generatedAt ?? r.created_at,
    createdAt: r.created_at,
  }));

  return NextResponse.json({ reports });
}
