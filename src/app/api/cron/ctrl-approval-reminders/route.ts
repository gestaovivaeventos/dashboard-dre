import { NextResponse } from "next/server";

import { runApprovalReminders } from "@/lib/ctrl/approval-reminders/send";
import { sendEmail } from "@/lib/email/gmail";
import { createAdminClient } from "@/lib/supabase/admin";

// ============================================================================
// GET /api/cron/ctrl-approval-reminders — LEMBRETE DIÁRIO DE APROVAÇÕES
//
// Roda às 10h de Brasília (13:00 UTC — o Brasil não tem mais horário de verão,
// então o offset é fixo em -03:00 o ano todo), de SEGUNDA A SEXTA. O fim de
// semana é excluído em dois lugares de propósito: no cron (`0 13 * * 1-5`) e na
// própria rotina (guarda por dia da semana em Brasília), para que uma execução
// manual num sábado também não dispare.
//
// Envia, via Resend, UM e-mail por aprovador com TODAS as requisições do módulo
// de Compras que dependem da aprovação dele agora:
//   - status 'pendente'         → gerente / gerente sócio do setor;
//   - status 'pendente_diretor' → diretor (só depois da etapa gerencial).
// Quem não tem pendência não recebe nada.
//
// Duplicidade é travada em ctrl_approval_email_log (unique user_id + run_date),
// então reexecutar o endpoint no mesmo dia não reenvia. Para conferir sem enviar
// use ?dryRun=1 (funciona inclusive no fim de semana). ?force=1 é o override
// manual consciente: reenvia para quem já recebeu hoje E ignora a trava de fim
// de semana.
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

  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") === "1";
  const force = url.searchParams.get("force") === "1";

  const db = createAdminClient();

  try {
    const result = await runApprovalReminders(db, { dryRun, force });

    // Duas situações exigem olho humano e viram alerta interno (Gmail, como nas
    // demais rotinas): falha de envio (o aprovador ficou sem aviso) e requisição
    // pendente sem nenhum aprovador elegível (cadastro a corrigir).
    const failures = result.details.filter((d) => d.outcome === "erro");
    const needsAlert = !result.ok || result.orphans.length > 0;

    if (needsAlert && !dryRun && process.env.ADMIN_EMAIL) {
      const failureList = failures
        .map((f) => `<li><strong>${f.email}</strong>: ${f.error ?? "erro desconhecido"}</li>`)
        .join("");
      const orphanList = result.orphans
        .map(
          (o) =>
            `<li>Requisição <strong>#${o.requestNumber}</strong> (${o.sectorName}) — aguardando ${
              o.stage === "diretor" ? "Diretor" : "Gerente"
            }, sem aprovador elegível cadastrado.</li>`,
        )
        .join("");

      await sendEmail({
        to: process.env.ADMIN_EMAIL,
        subject: `[Control Hub] Lembrete de aprovações — pendências em ${result.runDate}`,
        html:
          `<h2>Lembrete diário de aprovações (Compras) — ${result.runDate}</h2>` +
          `<p>${result.sent} e-mail(s) enviados, ${result.failed} falha(s), ` +
          `${result.duplicated} pulado(s) por já terem recebido hoje.</p>` +
          (result.error ? `<p><strong>${result.error}</strong></p>` : "") +
          (failureList ? `<h3>Destinatários que não receberam</h3><ul>${failureList}</ul>` : "") +
          (orphanList
            ? `<h3>Requisições sem aprovador (ninguém foi notificado)</h3><ul>${orphanList}</ul>`
            : ""),
      });
    }

    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[ctrl-approval-reminders] Falha na rotina:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

// "Rodar agora" pela UI/manual, com o mesmo Bearer.
export async function POST(request: Request) {
  return GET(request);
}
