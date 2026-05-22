import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";
import {
  analyzeOnePageReport,
  OnePageReportError,
} from "@/lib/financeiro/relatorios/one-page-analyzer";
import { saveOnePageHistory } from "@/lib/financeiro/relatorios/one-page-history";
import { buildOnePagePayload } from "@/lib/financeiro/relatorios/one-page-payload";

// ============================================================================
// POST /api/intelligence/one-page
//
// Endpoint oficial do One Page Report. Toda a aritmetica (DRE realizado,
// orcado, variacoes, KPIs, composicao, historico 6m) e feita por
// `buildOnePagePayload` — o mesmo helper usado pela rota dev-only
// "sem IA". A unica diferenca dessa rota e que aqui o `payload.input` e
// enviado ao motor de IA (`analyzeOnePageReport`) que devolve a `analysis`.
//
// Body: { companyId, dateFrom, dateTo, periodLabel? }
//
// Resposta:
//   {
//     analysis,            // OnePageReport (saida da IA)
//     input,               // OnePageInput enviado a IA
//     generatedAt,         // ISO timestamp da geracao
//     kpis,                // 5 cards prontos
//     previstoRealizado,   // 5 indicadores (sem FEE)
//     composicaoResultado, // waterfall
//     historicoResultado,  // 6 meses do Resultado do Exercicio
//   }
// ============================================================================

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface RequestBody {
  companyId?: string;
  dateFrom?: string;
  dateTo?: string;
  periodLabel?: string;
}

export async function POST(request: Request) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user || !profile) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (profile.role !== "admin") {
    return NextResponse.json({ error: "Acesso restrito." }, { status: 403 });
  }

  // ── 1. Validacao basica do body ─────────────────────────────────────────
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

  // ── 2. Constroi payload numerico (compartilhado com dev route) ──────────
  const result = await buildOnePagePayload(supabase, {
    companyId,
    dateFrom,
    dateTo,
    periodLabel,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const { payload } = result;

  // ── 3. Chamada do motor de IA + resposta unica ─────────────────────────
  try {
    const analysis = await analyzeOnePageReport(payload.input);
    const responseBody = { analysis, ...payload };
    // Salva no historico (best-effort, nao bloqueia a resposta em falha).
    await saveOnePageHistory({
      userId: user.id,
      companyId,
      dateFrom,
      dateTo,
      contentJson: responseBody as unknown as Record<string, unknown>,
    });
    return NextResponse.json(responseBody);
  } catch (err) {
    // Em falha do motor devolvemos os blocos numericos — a UI pode
    // renderizar KPIs e graficos enquanto retenta a analise textual.
    if (err instanceof OnePageReportError) {
      return NextResponse.json(
        { error: err.message, ...payload },
        { status: 502 },
      );
    }
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Erro inesperado no motor.",
        ...payload,
      },
      { status: 500 },
    );
  }
}
