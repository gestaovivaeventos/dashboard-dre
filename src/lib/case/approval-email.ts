// E-mails do fluxo de aprovação dos contratos Case. Falha de envio nunca
// derruba a ação: a pendência continua visível no menu e na lista de contratos.
import "server-only";

import { resolveAppUrl } from "@/lib/app-url";
import { CASE_CONTRACT_APPROVER_EMAIL } from "@/lib/case/contract-config";
import { sendEmailViaResend } from "@/lib/email/resend";

export interface ApprovalEmailContract {
  id: string;
  contractNumber: number;
  clientName: string;
  eventName: string | null;
  eventDate: string | null;
  totalValue: number;
}

const brl = (n: number) => `R$ ${new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;
const dateBR = (d: string | null) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "—");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function layout(title: string, intro: string, c: ApprovalEmailContract, extra: string, cta: string): string {
  const url = `${resolveAppUrl()}/case/contratos/${c.id}`;
  const row = (label: string, value: string) =>
    `<tr><td style="padding:6px 0;color:#6b7280;font-size:13px;width:140px">${label}</td><td style="padding:6px 0;color:#111827;font-size:14px">${esc(value)}</td></tr>`;
  return `<!doctype html><html><body style="margin:0;background:#f5f5f4;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f4;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:8px;border:1px solid #e7e5e4">
<tr><td style="padding:24px 28px 8px"><div style="font-size:12px;color:#b45309;font-weight:bold;letter-spacing:.04em">CASE SHOWS · CONTRATOS</div>
<h1 style="margin:8px 0 0;font-size:20px;color:#111827">${esc(title)}</h1></td></tr>
<tr><td style="padding:8px 28px;color:#374151;font-size:14px;line-height:1.5">${intro}</td></tr>
<tr><td style="padding:4px 28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${row("Contrato", `#${c.contractNumber}`)}${row("Cliente", c.clientName)}${row("Evento", c.eventName ?? "—")}${row("Data do evento", dateBR(c.eventDate))}${row("Valor", brl(c.totalValue))}
</table></td></tr>
${extra}
<tr><td style="padding:16px 28px 28px"><a href="${url}" style="display:inline-block;background:#d97706;color:#ffffff;text-decoration:none;font-size:14px;font-weight:bold;padding:10px 18px;border-radius:6px">${esc(cta)}</a></td></tr>
</table></td></tr></table></body></html>`;
}

export async function sendApprovalRequestedEmail(c: ApprovalEmailContract, requesterName: string): Promise<void> {
  const html = layout(
    "Contrato aguardando sua aprovação",
    `<strong>${esc(requesterName)}</strong> enviou um contrato para a sua aprovação. Depois de aprovado, ele segue para o cliente e a testemunha assinarem na ClickSign — e você assina por último.`,
    c,
    "",
    "Revisar e aprovar",
  );
  const res = await sendEmailViaResend({
    to: CASE_CONTRACT_APPROVER_EMAIL,
    subject: `Contrato Case #${c.contractNumber} aguardando sua aprovação — ${c.clientName}`,
    html,
  });
  if (!res.ok) console.error("[case/aprovacao] falha ao avisar o aprovador:", res.error);
}

export async function sendContractReturnedEmail(c: ApprovalEmailContract, to: string, reason: string): Promise<void> {
  const html = layout(
    "Contrato devolvido para ajuste",
    "O contrato abaixo <strong>não foi aprovado</strong> e voltou para rascunho. Ajuste o que foi apontado e envie para aprovação de novo.",
    c,
    `<tr><td style="padding:8px 28px"><div style="border-left:3px solid #d97706;background:#fffbeb;padding:10px 12px;color:#78350f;font-size:14px;white-space:pre-wrap">${esc(reason)}</div></td></tr>`,
    "Abrir contrato",
  );
  const res = await sendEmailViaResend({
    to,
    subject: `Contrato Case #${c.contractNumber} devolvido para ajuste — ${c.clientName}`,
    html,
  });
  if (!res.ok) console.error("[case/aprovacao] falha ao avisar a devolução:", res.error);
}
