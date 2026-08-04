import { NextResponse } from "next/server";

import { sendEmail } from "@/lib/email/gmail";
import { getPreviousMonthRange } from "@/lib/financeiro/relatorios/monthly-bi-sender";
import {
  notifyCscPendingValidation,
  runMonthlyGeneration,
  SYSTEM_ACTOR,
} from "@/lib/financeiro/relatorios/validation";
import { createAdminClient } from "@/lib/supabase/admin";

// ============================================================================
// GET /api/cron/bi-monthly-validation   — ROTINA DO DIA 4 (parte 2)
//
// Roda todo dia 4, DEPOIS da sincronizacao ampliada de 6 meses feita pelo
// /api/cron/sync-all do mesmo dia (por isso o horario mais tarde no
// vercel.json). Sequencia do dia 4:
//   1. sync-all sincroniza 6 meses de Omie   (06:00 UTC)
//   2. ESTA rotina gera os relatorios do MES ANTERIOR de cada empresa com
//      destinatarios cadastrados e os coloca na fila de validacao (12:00 UTC)
//   3. cria a pendencia/notificacao no Control Hub para os usuarios CSC
//
// Os relatorios NAO sao enviados aqui: ficam em /financeiro/validacao-relatorio
// aguardando o aceite do CSC. Sem aceite ate o dia 10, o cron
// /api/cron/bi-monthly-autosend envia automaticamente.
//
// RETOMAVEL: `runMonthlyGeneration` pula quem ja tem relatorio pronto no
// periodo. Se esta invocacao estourar o teto de 300s da Vercel no meio da
// lista, basta chama-la de novo (ou esperar o proximo disparo) que ela conclui
// a cauda sem refazer o que ja deu certo — e sem gastar IA duas vezes. Falhas
// individuais sao retentadas uma vez ao final da leva.
// ============================================================================

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

  const admin = createAdminClient();
  const range = getPreviousMonthRange(new Date());

  let results;
  try {
    results = await runMonthlyGeneration(admin, { range, actor: SYSTEM_ACTOR });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao gerar a leva do mês." },
      { status: 400 },
    );
  }

  const generated = results.filter((r) => r.ok && !r.skipped).length;
  const skipped = results.filter((r) => r.skipped).length;
  const failures = results.filter((r) => !r.ok);

  // Pendencia so faz sentido quando ha algo novo na fila.
  const notified =
    generated > 0
      ? await notifyCscPendingValidation(admin, {
          periodLabel: range.periodLabel,
          total: generated,
        })
      : 0;

  // Falha de geracao ficava so na coluna da tela; o admin precisa saber no dia,
  // porque o dia 10 nao envia relatorio sem conteudo.
  if (failures.length > 0 && process.env.ADMIN_EMAIL) {
    const list = failures
      .map((f) => `<li><strong>${f.companyName}</strong>: ${f.error ?? "erro desconhecido"}</li>`)
      .join("");
    await sendEmail({
      to: process.env.ADMIN_EMAIL,
      subject: `[Control Hub] Falhas na geração dos relatórios BI — ${range.periodLabel}`,
      html:
        `<h2>Geração do dia 4 — ${range.periodLabel}</h2>` +
        `<p>${generated} relatório(s) gerados, ${failures.length} com falha.</p>` +
        `<ul>${list}</ul>` +
        `<p>Use "Gerar novamente" em Financeiro &gt; Validação Relatório para refazer as empresas que falharam.</p>`,
    });
  }

  return NextResponse.json({
    ok: failures.length === 0,
    period: range.periodLabel,
    companies: results.length,
    generated,
    skipped,
    failed: failures.length,
    notifiedUsers: notified,
    results,
  });
}
