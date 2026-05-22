import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { MOCK_ANALYSIS } from "@/lib/financeiro/relatorios/one-page-mock-analysis";
import { buildOnePagePayload } from "@/lib/financeiro/relatorios/one-page-payload";

// ============================================================================
// POST /api/dev/intelligence/one-page-no-ai
//
// Rota DEV-ONLY que devolve a mesma estrutura da rota oficial
// /api/intelligence/one-page mas substitui a chamada a IA por uma analysis
// MOCKADA (validada pelo OnePageReportSchema na carga do modulo).
//
// Util para validar o fluxo visual com dados financeiros REAIS sem consumir
// creditos da OpenAI.
//
// SEGURANCA:
//   - Em producao (NODE_ENV === "production") a rota retorna 404 — nao
//     existe do ponto de vista do cliente.
//   - Em dev exige usuario autenticado e role admin (mesmas regras da
//     rota oficial), pois acessa dados financeiros reais.
//   - NUNCA chama analyzeOnePageReport. Nenhum import de motor de IA aqui.
// ============================================================================

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface RequestBody {
  companyId?: string;
  dateFrom?: string;
  dateTo?: string;
  periodLabel?: string;
}

export async function POST(request: Request) {
  // Em producao a rota nao existe. Retornamos 404 sem tocar em sessao/db.
  if (process.env.NODE_ENV === "production") {
    return new NextResponse("Not found", { status: 404 });
  }

  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user || !profile) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (profile.role !== "admin") {
    return NextResponse.json({ error: "Acesso restrito." }, { status: 403 });
  }

  // ── Validacao basica do body ────────────────────────────────────────────
  const body = (await request.json().catch(() => ({}))) as RequestBody;
  const { companyId, dateFrom, dateTo, periodLabel } = body;

  if (!companyId || !dateFrom || !dateTo) {
    return NextResponse.json(
      { error: "Campos obrigatorios: companyId, dateFrom, dateTo." },
      { status: 400 },
    );
  }
  if (!ISO_DATE_RE.test(dateFrom) || !ISO_DATE_RE.test(dateTo)) {
    return NextResponse.json(
      { error: "Datas devem estar no formato YYYY-MM-DD." },
      { status: 400 },
    );
  }

  // ── Constroi payload numerico (mesmo helper da rota oficial) ────────────
  const result = await buildOnePagePayload(supabase, {
    companyId,
    dateFrom,
    dateTo,
    periodLabel,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  // ── Devolve payload + analysis mockada (sem chamar IA) ──────────────────
  return NextResponse.json({
    analysis: MOCK_ANALYSIS,
    ...result.payload,
  });
}
