import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/auth/cron";

import { sendEmail } from "@/lib/email/gmail";
import { getPreviousMonthRange } from "@/lib/financeiro/relatorios/monthly-bi-sender";
import { BI_GENERATION_DAY } from "@/lib/financeiro/relatorios/schedule";
import {
  notifyCscPendingValidation,
  runMonthlyGeneration,
  SYSTEM_ACTOR,
} from "@/lib/financeiro/relatorios/validation";
import { createAdminClient } from "@/lib/supabase/admin";

// ============================================================================
// GET /api/cron/bi-monthly-validation   — ROTINA DA GERACAO (parte 2)
//
// Roda no dia BI_GENERATION_DAY (ver @/lib/financeiro/relatorios/schedule),
// DEPOIS da sincronizacao ampliada de 6 meses feita pelo /api/cron/sync-all do
// mesmo dia (por isso o horario mais tarde no vercel.json). Sequencia do dia:
//   1. sync-all sincroniza 6 meses de Omie   (06:00 UTC / 03:00 BRT)
//   2. ESTA rotina gera os relatorios do MES ANTERIOR de TODAS as empresas
//      ativas com sync ligado (ter destinatario cadastrado NAO e requisito —
//      o e-mail so importa no envio) e os coloca na fila de validacao
//      (a cada 10 min entre 12:00 e 13:50 UTC / 09:00–10:50 BRT)
//   3. cria a pendencia/notificacao no Control Hub para os usuarios CSC
//
// Os relatorios NAO sao enviados aqui: ficam em /financeiro/validacao-relatorio
// aguardando o aceite do CSC. Sem aceite ate o dia BI_AUTOSEND_DAY, o cron
// /api/cron/bi-monthly-autosend envia automaticamente.
//
// RETOMAVEL — E POR ISSO DISPARA VARIAS VEZES NO DIA: a leva inteira (~30
// empresas x 20–50s de IA cada) NAO cabe nos 300s da Vercel. Em 05/10/2026 o
// disparo unico foi cortado depois da 9a empresa (ordem alfabetica) e as
// outras 21 ficaram sem relatorio, sem alerta nenhum. `runMonthlyGeneration`
// pula quem ja tem relatorio pronto no periodo, entao cada disparo do
// vercel.json ("*/10 12-13 D * *") conclui um pedaco da cauda sem refazer o
// que ja deu certo — e sem gastar IA duas vezes; quando tudo ja esta pronto o
// disparo nao faz nada. Falhas individuais sao retentadas uma vez ao final da
// leva (e de novo no disparo seguinte).
// ============================================================================

export const runtime = "nodejs";
export const maxDuration = 300;

function isAuthorized(request: Request) {
  return isCronAuthorized(request);
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
  // porque o envio automatico nao manda relatorio sem conteudo.
  if (failures.length > 0 && process.env.ADMIN_EMAIL) {
    const list = failures
      .map((f) => `<li><strong>${f.companyName}</strong>: ${f.error ?? "erro desconhecido"}</li>`)
      .join("");
    await sendEmail({
      to: process.env.ADMIN_EMAIL,
      subject: `[Control Hub] Falhas na geração dos relatórios BI — ${range.periodLabel}`,
      html:
        `<h2>Geração do dia ${BI_GENERATION_DAY} — ${range.periodLabel}</h2>` +
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
