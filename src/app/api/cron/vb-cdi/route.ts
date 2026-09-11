import { NextResponse } from "next/server";

import { isCronAuthorized } from "@/lib/auth/cron";
import { syncCdiRates } from "@/lib/vb/cdi/sync";

// ============================================================================
// GET /api/cron/vb-cdi — CDI DIÁRIO DO VB
//
// Roda às 08:00 de Brasília (11:00 UTC), de segunda a sexta, e só BAIXA as
// taxas do Banco Central que faltam. NÃO lança rendimento: se lançasse, o
// extrato ganharia uma linha por dia. O lançamento é sempre por decisão — o
// botão "Calcular rendimento" na Visão geral, ou o fechamento automático
// quando um lançamento manual é gravado.
// ============================================================================

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await syncCdiRates();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "CDI sync failed.";
    console.error("[vb-cdi] cron failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
