// HTML do lembrete diário de aprovações (módulo de Compras).
//
// Layout inspirado no modelo de referência: cartão central, saudação, blocos
// destacados — um por requisição, com os dados centralizados e rotulados — e um
// botão único ao final. Paleta e tipografia seguem os e-mails que o Control Hub
// já envia (one-page-email.ts), para o usuário reconhecer o remetente.
//
// Tudo é table-based com CSS inline: cliente de e-mail não carrega <style>
// externo nem respeita flex/grid de forma confiável.

import { formatDateBR, formatDayBR } from "@/lib/ctrl/datetime";

import type { PendingApprovalRequest } from "./recipients";

/** Destino do botão — página principal do Control Hub (definido na especificação). */
export const CTRL_HOME_URL = "https://controlhub.vivaeventos.com.br/home";

const FF = "'IBM Plex Sans', Arial, Helvetica, sans-serif";

const C = {
  pageBg: "#eceae6",
  cardBg: "#ffffff",
  cardBorder: "#e6e4df",
  blockBg: "#fbfbfa",
  blockBorder: "#e6e4df",
  ink: "#16191f",
  body: "#3c424d",
  sub: "#717784",
  tertiary: "#9aa0ac",
  accent: "#1f6fd6",
  darkCard: "#1b2532",
  fortuneBg: "#f4f7fb",
  fortuneBorder: "#1f6fd6",
  alertText: "#c0392b",
  alertBg: "#fdf1ef",
  alertBorder: "#f3d6d0",
  routeText: "#4338ca",
  routeBg: "#eef0fd",
  routeBorder: "#d8dcfa",
} as const;

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Assunto padronizado, com concordância de singular/plural.
 * "Control Hub - Existe 1 pagamento que precisa da sua aprovação"
 * "Control Hub - Existem 3 pagamentos que precisam da sua aprovação"
 */
export function approvalReminderSubject(count: number): string {
  return count === 1
    ? "Control Hub - Existe 1 pagamento que precisa da sua aprovação"
    : `Control Hub - Existem ${count} pagamentos que precisam da sua aprovação`;
}

/** Primeiro nome, para a saudação soar pessoal sem ficar formal demais. */
function firstName(name: string): string {
  const clean = name.trim();
  if (!clean || clean.includes("@")) return "";
  return clean.split(/\s+/)[0];
}

function badge(text: string, color: string, bg: string, border: string): string {
  return (
    `<span style="display:inline-block;font-family:${FF};font-size:10px;font-weight:700;` +
    `letter-spacing:.4px;text-transform:uppercase;color:${color};background:${bg};` +
    `border:1px solid ${border};border-radius:999px;padding:3px 9px;margin-top:6px;">${esc(text)}</span>`
  );
}

function fieldRow(label: string, value: string, opts: { strong?: boolean } = {}): string {
  const weight = opts.strong ? "700" : "400";
  const color = opts.strong ? C.ink : C.body;
  return (
    `<tr><td align="center" style="font-family:${FF};font-size:13px;line-height:21px;color:${color};padding:1px 0;">` +
    `<span style="color:${C.sub};">${esc(label)}:</span> ` +
    `<span style="font-weight:${weight};">${esc(value)}</span>` +
    `</td></tr>`
  );
}

function requestBlock(req: PendingApprovalRequest): string {
  const heading =
    req.requestNumber > 0 ? `#${req.requestNumber} — ${req.title}` : req.title;

  const tag = req.outOfBudget
    ? badge("Fora do orçamento", C.alertText, C.alertBg, C.alertBorder)
    : req.forcedDirector
      ? badge("Direto ao Diretor", C.routeText, C.routeBg, C.routeBorder)
      : "";

  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.blockBg};border:1px solid ${C.blockBorder};border-radius:8px;margin:0 0 14px;">
    <tr><td style="padding:18px 20px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr><td align="center" style="font-family:${FF};font-size:16px;font-weight:700;color:${C.accent};line-height:22px;padding-bottom:2px;">${esc(heading)}</td></tr>
        ${tag ? `<tr><td align="center" style="padding-bottom:8px;">${tag}</td></tr>` : `<tr><td style="height:8px;line-height:8px;">&nbsp;</td></tr>`}
        ${fieldRow("Setor", req.sectorName)}
        ${fieldRow("Categoria", req.category)}
        ${fieldRow("Data de criação", formatDateBR(req.createdAt))}
        ${fieldRow("Data de vencimento", formatDayBR(req.dueDate))}
        ${fieldRow("Valor", BRL.format(req.amount), { strong: true })}
        ${fieldRow("Fornecedor", req.supplier)}
      </table>
    </td></tr>
  </table>`;
}

export interface ApprovalReminderEmailInput {
  recipientName: string;
  /** Mensagem do dia ("biscoito da sorte") sorteada para este usuário hoje. */
  fortune: string;
  requests: PendingApprovalRequest[];
}

export function renderApprovalReminderEmail({
  recipientName,
  fortune,
  requests,
}: ApprovalReminderEmailInput): string {
  const count = requests.length;
  const total = requests.reduce((sum, r) => sum + r.amount, 0);
  const greetName = firstName(recipientName);

  const intro =
    count === 1
      ? "Este e-mail é para avisar que <strong>existe 1 pagamento que precisa da sua aprovação</strong> no módulo de Compras."
      : `Este e-mail é para avisar que <strong>existem ${count} pagamentos que precisam da sua aprovação</strong> no módulo de Compras.`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(approvalReminderSubject(count))}</title>
</head>
<body style="margin:0;padding:0;background:${C.pageBg};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(
    count === 1
      ? "1 requisição aguarda a sua aprovação no Control Hub."
      : `${count} requisições aguardam a sua aprovação no Control Hub.`,
  )}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.pageBg};padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="620" cellpadding="0" cellspacing="0" style="background:${C.cardBg};border:1px solid ${C.cardBorder};border-radius:8px;padding:30px 34px 28px;max-width:620px;width:100%;">
        <tr><td>

          <div style="font-family:${FF};font-size:12px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:${C.tertiary};padding-bottom:4px;">Control Hub</div>
          <div style="font-family:${FF};font-size:19px;font-weight:700;color:${C.ink};padding-bottom:18px;">Compras &middot; Aprovações pendentes</div>

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.fortuneBg};border-left:3px solid ${C.fortuneBorder};border-radius:4px;margin:0 0 20px;">
            <tr><td style="padding:13px 16px;">
              <div style="font-family:${FF};font-size:11px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:${C.sub};padding-bottom:4px;">Mensagem do dia para você</div>
              <div style="font-family:${FF};font-size:14px;line-height:21px;color:${C.ink};font-style:italic;">&ldquo;${esc(fortune)}&rdquo;</div>
            </td></tr>
          </table>

          <div style="font-family:${FF};font-size:14px;line-height:22px;color:${C.body};padding-bottom:10px;">${
            greetName ? `Saudações, ${esc(greetName)}!` : "Saudações!"
          }</div>
          <div style="font-family:${FF};font-size:14px;line-height:22px;color:${C.body};padding-bottom:10px;">${intro}</div>
          <div style="font-family:${FF};font-size:14px;line-height:22px;color:${C.body};padding-bottom:6px;">Confira abaixo as requisições que aguardam a sua aprovação:</div>
          <div style="font-family:${FF};font-size:12px;line-height:20px;color:${C.sub};padding-bottom:18px;">Valor total: <strong style="color:${C.ink};">${esc(BRL.format(total))}</strong></div>

          ${requests.map(requestBlock).join("")}

          <div style="text-align:center;margin:22px 0 6px;">
            <a href="${CTRL_HOME_URL}" style="display:inline-block;background:${C.darkCard};color:#ffffff;font-family:${FF};font-size:14px;font-weight:700;padding:14px 30px;border-radius:999px;text-decoration:none;">Visualizar pagamentos pendentes de aprovação</a>
          </div>

          <div style="font-family:${FF};font-size:11px;line-height:18px;color:${C.tertiary};text-align:center;padding-top:16px;border-top:1px solid ${C.cardBorder};margin-top:20px;">
            Você recebeu este e-mail porque estas requisições dependem da sua aprovação no Control Hub.<br>
            Mensagem automática enviada uma vez por dia, às 10h (horário de Brasília).
          </div>

        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
