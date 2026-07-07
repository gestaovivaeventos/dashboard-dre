import { NextResponse } from "next/server";

import { enqueueMonitorRuns, processPendingSearchRuns } from "@/lib/viagens/process-search";
import { VIAGENS_ENABLED } from "@/lib/viagens/flags";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 300;

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Kill-switch: módulo desativado → nada é buscado nem re-cotado (zero custo).
  if (!VIAGENS_ENABLED) {
    return NextResponse.json({ ok: true, disabled: true });
  }

  const db = createAdminClient();

  // 1) Enfileira re-cotações do monitoramento contínuo (barato; no-op quando nada vence).
  const enqueued = await enqueueMonitorRuns(db);

  // 2) Drena a fila (buscas iniciais + monitor) dentro do time-budget.
  const result = await processPendingSearchRuns(db);

  return NextResponse.json({ ok: true, enqueued, ...result });
}

export async function POST(request: Request) {
  return GET(request);
}
