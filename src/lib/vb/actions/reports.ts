"use server";

// Extrato mensal por e-mail: prévia, teste, envio e reenvio. Só gestor.
// O destinatário é SEMPRE resolvido no servidor (e-mail do credor no
// cadastro; teste vai para o e-mail da sessão) — o cliente manda só ids.

import { revalidatePath } from "next/cache";

import { sendEmailViaResend } from "@/lib/email/resend";
import { todayBR } from "@/lib/ctrl/datetime";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireVbGestor } from "@/lib/vb/auth";
import { renderVbMonthlyEmail } from "@/lib/vb/report/monthly-email";
import { loadMonthlyReportRows, type VbMonthlyReportRow } from "@/lib/vb/report/queries";
import { isMonthKey, VB_REPORT_STATUS_LABELS } from "@/lib/vb/report/status";
import { isUuid, type VbActionResult, type VbReportSendKind } from "@/lib/vb/types";

const REPORTS_PATH = "/vb/relatorios";

async function findRow(creditorId: string, month: string): Promise<VbMonthlyReportRow | null> {
  const rows = await loadMonthlyReportRows(createAdminClient(), month);
  return rows.find((r) => r.creditor.id === creditorId) ?? null;
}

function validate(creditorId: string, month: string): string | null {
  if (!isUuid(creditorId)) return "Identificador inválido.";
  if (!isMonthKey(month)) return "Mês inválido.";
  return null;
}

export async function previewVbMonthlyReport(
  creditorId: string,
  month: string,
): Promise<VbActionResult<{ subject: string; html: string }>> {
  await requireVbGestor();
  const invalid = validate(creditorId, month);
  if (invalid) return { error: invalid };
  try {
    const row = await findRow(creditorId, month);
    if (!row) return { error: "Credor não encontrado ou inativo." };
    const { subject, html } = renderVbMonthlyEmail({
      creditorName: row.creditor.name,
      statement: row.statement,
      generatedOn: todayBR(),
    });
    return { ok: true, subject, html };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Falha ao montar a prévia." };
  }
}

async function dispatch(
  row: VbMonthlyReportRow,
  kind: VbReportSendKind,
  user: { id: string; email: string },
): Promise<VbActionResult<{ sentTo: string }>> {
  const isTest = kind === "teste";
  const to = isTest ? user.email.trim().toLowerCase() : (row.creditor.email ?? "").trim().toLowerCase();
  if (!to) return { error: isTest ? "Seu usuário não tem e-mail cadastrado." : "Credor sem e-mail cadastrado." };

  const stamp = new Date().toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  // Mesma separação do e-mail de teste do BI: hora no assunto + tarja +
  // X-Entity-Ref-ID único, senão o Gmail agrupa o oficial dentro do teste.
  const rendered = renderVbMonthlyEmail({
    creditorName: row.creditor.name,
    statement: row.statement,
    generatedOn: todayBR(),
    banner: isTest
      ? {
          title: "Este é um e-mail de TESTE",
          text: `Enviado só para você em ${stamp}. O credor ${row.creditor.name} não recebeu esta mensagem e ela não conta como envio.`,
        }
      : undefined,
  });
  const subject = isTest ? `[TESTE ${stamp}] ${rendered.subject}` : rendered.subject;

  const result = await sendEmailViaResend({
    to: [to],
    subject,
    html: rendered.html,
    headers: { "X-Entity-Ref-ID": `vb-${kind}-${row.creditor.id}-${row.statement.month}-${Date.now()}` },
  });
  if (!result.ok) return { error: result.error ?? "Falha no envio." };

  const admin = createAdminClient();
  const { error } = await admin.from("vb_report_sends").insert({
    creditor_id: row.creditor.id,
    month: row.statement.month,
    kind,
    sent_to: to,
    sent_by: user.id,
    subject,
    resend_id: result.id ?? null,
    statement: row.statement,
  });
  // O e-mail já foi: o registro que falhou vira erro visível, não silêncio.
  if (error) return { error: `E-mail enviado para ${to}, mas o registro falhou: ${error.message}` };

  revalidatePath(REPORTS_PATH);
  return { ok: true, sentTo: to };
}

/**
 * - teste: qualquer status (menos sem extrato), só para o e-mail da sessão.
 * - oficial: exige status "pronto"; já enviado pede reenvio consciente.
 * - reenvio: exige envio oficial anterior; não altera o primeiro registro.
 */
export async function sendVbMonthlyReport(input: {
  creditorId: string;
  month: string;
  kind: VbReportSendKind;
}): Promise<VbActionResult<{ sentTo: string }>> {
  const user = await requireVbGestor();
  const invalid = validate(input.creditorId, input.month);
  if (invalid) return { error: invalid };
  try {
    const row = await findRow(input.creditorId, input.month);
    if (!row) return { error: "Credor não encontrado ou inativo." };

    if (input.kind === "oficial" && row.status !== "pronto") {
      if (row.status === "enviado") return { error: "Já enviado. Use Reenviar se quiser mandar de novo." };
      return { error: `Não dá para enviar: ${VB_REPORT_STATUS_LABELS[row.status].toLowerCase()}.` };
    }
    if (input.kind === "reenvio" && row.status !== "enviado") {
      return { error: "Ainda não houve envio oficial — use Enviar." };
    }
    return await dispatch(row, input.kind, user);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Falha no envio." };
  }
}

/** Envia de uma vez todos os credores com status "pronto" no mês. */
export async function sendReadyVbMonthlyReports(
  month: string,
): Promise<VbActionResult<{ sent: string[]; failed: Array<{ name: string; error: string }> }>> {
  const user = await requireVbGestor();
  if (!isMonthKey(month)) return { error: "Mês inválido." };
  try {
    const rows = (await loadMonthlyReportRows(createAdminClient(), month)).filter((r) => r.status === "pronto");
    const sent: string[] = [];
    const failed: Array<{ name: string; error: string }> = [];
    for (const row of rows) {
      const result = await dispatch(row, "oficial", user);
      if ("error" in result) failed.push({ name: row.creditor.name, error: result.error });
      else sent.push(row.creditor.name);
    }
    revalidatePath(REPORTS_PATH);
    return { ok: true, sent, failed };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Falha no envio." };
  }
}
