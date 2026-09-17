import { NextResponse } from "next/server";

import { isCronAuthorized } from "@/lib/auth/cron";
import { runCaixaSweep } from "@/lib/caixa/sync";
import { createAdminClient } from "@/lib/supabase/admin";
import { todayBR } from "@/lib/ctrl/datetime";

// ============================================================================
// GET /api/cron/caixa-saldos — SALDOS DO MÓDULO CAIXA
//
// Agendado DUAS vezes por dia no vercel.json. A Vercel agenda sempre em UTC:
//
//   "0 7 * * *"   → 04:00 de Brasília
//   "30 15 * * *" → 12:30 de Brasília
//
// A execução da MADRUGADA também sincroniza o CADASTRO antes dos saldos, para
// que uma conta corrente criada na Omie apareça sozinha na manhã seguinte — o
// botão "Sincronizar contas" da tela vira conveniência, não obrigação. Rodar o
// cadastro duas vezes por dia não traria nada (contas não nascem de hora em
// hora) e custaria uma chamada por empresa no horário de expediente.
//
// O corte é por HORA DE BRASÍLIA, não UTC: às 04:00 BRT o servidor já está em
// 07:00 UTC, então comparar a hora UTC classificaria as duas execuções errado.
// ============================================================================

export const runtime = "nodejs";
export const maxDuration = 300;

/** Hora do dia em Brasília (0-23). */
function hourBR(): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  return Number(parts.find((p) => p.type === "hour")?.value ?? "0");
}

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  // ?cadastro=1 força o espelho do cadastro em qualquer horário (útil para
  // rodar à mão depois de criar contas na Omie).
  const forceCadastro = url.searchParams.get("cadastro") === "1";
  const isMorningRun = hourBR() < 8;

  try {
    const admin = createAdminClient();
    let cadastro = null;

    if (isMorningRun || forceCadastro) {
      const sweep = await runCaixaSweep(admin, { kind: "cadastro", trigger: "cron" });
      cadastro = summarize(sweep.results);
    }

    const saldos = await runCaixaSweep(admin, { kind: "saldos", trigger: "cron" });

    return NextResponse.json({
      ok: true,
      day: todayBR(),
      hourBR: hourBR(),
      cadastro,
      saldos: summarize(saldos.results),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Caixa sweep failed.";
    console.error("[caixa-saldos] cron failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function summarize(results: Awaited<ReturnType<typeof runCaixaSweep>>["results"]) {
  return {
    companies: results.length,
    companiesOk: results.filter((r) => r.ok).length,
    accountsOk: results.reduce((s, r) => s + r.accountsOk, 0),
    accountsError: results.reduce((s, r) => s + r.accountsError, 0),
    errors: results
      .filter((r) => r.error)
      .map((r) => ({ company: r.companyName, error: r.error })),
  };
}
