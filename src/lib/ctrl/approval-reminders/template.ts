// HTML do lembrete diário de aprovações (módulo de Compras) — design Modernist.
//
// Estrutura: faixa vermelha com a mensagem do dia no topo, saudação com a
// contagem em destaque sutil, uma seção por requisição com os campos rotulados
// em duas colunas alinhadas à esquerda, CTA único e rodapé escuro.
//
// Regras de HTML de e-mail seguidas aqui (não "simplifique" nenhuma delas):
//   - só <table role="presentation">, coluna única, wrapper de 600px. Nada de
//     flex/grid/float/position, que Outlook e Gmail app ignoram ou quebram;
//   - TODO estilo inline no próprio elemento. O <style> do <head> carrega apenas
//     as media queries — o e-mail tem que ficar correto se o bloco for removido
//     (Gmail app remove <style> em várias situações);
//   - sem imagens, sem web fonts, sem JS, sem corner radius: o desenho é feito
//     de células coloridas, réguas e tipografia;
//   - larguras explícitas e `mso-line-height-rule:exactly` junto de todo
//     line-height, senão o Outlook desktop recalcula a entrelinha;
//   - preheader oculto como primeiro elemento do <body>.

import { formatDateBR, formatDayBR, todayBR } from "@/lib/ctrl/datetime";

import type { PendingApprovalRequest } from "./recipients";

/** Destino do botão — página principal do Control Hub (definido na especificação). */
export const CTRL_HOME_URL = "https://controlhub.vivaeventos.com.br/home";

const FF = "Archivo,'Helvetica Neue',Helvetica,Arial,sans-serif";

const C = {
  ground: "#e9e6e4",
  card: "#fbfaf9",
  ink: "#201e1d",
  body: "#6b6663",
  footerText: "#a9a4a1",
  accent: "#ec3013",
  accentDark: "#b3230f",
  accentSoft: "#ffd9d2",
  ruleStrong: "#201e1d",
  ruleField: "#e0dddb",
  ruleRequest: "#cdc9c7",
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

/** Coluna de data pura: vence exatamente hoje (em Brasília). */
function isDueToday(dueDate: string | null, today: string): boolean {
  return Boolean(dueDate) && dueDate!.slice(0, 10) === today;
}

/** Régua horizontal entre blocos. */
function rule(color: string, weight: 1 | 2, padTop: number): string {
  return `<tr><td class="px" style="padding:${padTop}px 32px 0;"><div style="border-top:${weight}px solid ${color};font-size:0;line-height:0;">&nbsp;</div></td></tr>`;
}

interface FieldOptions {
  /** Primeira linha da tabela: carrega a largura da coluna de rótulos. */
  first?: boolean;
  strong?: boolean;
  danger?: boolean;
}

function fieldRow(label: string, value: string, opts: FieldOptions = {}): string {
  const labelAttrs = opts.first ? ` class="lbl" width="160"` : "";
  const labelWidth = opts.first ? "width:160px;" : "";
  const valueStyle =
    (opts.strong ? "font-weight:700;" : "") + (opts.danger ? `color:${C.accentDark};` : "");
  return (
    `<tr>` +
    `<td${labelAttrs} style="${labelWidth}padding:6px 8px 6px 0;color:${C.body};border-top:1px solid ${C.ruleField};" valign="top">${esc(label)}:</td>` +
    `<td style="padding:6px 0;${valueStyle}border-top:1px solid ${C.ruleField};" valign="top">${esc(value)}</td>` +
    `</tr>`
  );
}

function requestSection(req: PendingApprovalRequest, today: string): string {
  const dueToday = isDueToday(req.dueDate, today);
  const dueLabel = dueToday
    ? `${formatDayBR(req.dueDate)} (hoje)`
    : formatDayBR(req.dueDate);

  const kicker =
    req.requestNumber > 0 ? `Requisição #${req.requestNumber}` : "Requisição";

  return `
        <tr><td class="px" style="padding:22px 32px 0;font-family:${FF};">
          <div style="font-size:11px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:${C.accentDark};padding-bottom:6px;mso-line-height-rule:exactly;line-height:14px;">${esc(kicker)}</div>
          <div style="font-size:17px;line-height:23px;font-weight:700;color:${C.ink};padding-bottom:14px;mso-line-height-rule:exactly;">${esc(req.title)}</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-family:${FF};font-size:13px;line-height:19px;color:${C.ink};">
            ${fieldRow("Setor", req.sectorName, { first: true })}
            ${fieldRow("Categoria", req.category)}
            ${fieldRow("Data de criação", formatDateBR(req.createdAt))}
            ${fieldRow("Data de vencimento", dueLabel, { strong: dueToday, danger: dueToday })}
            ${fieldRow("Valor", BRL.format(req.amount), { strong: true })}
            ${fieldRow("Fornecedor", req.supplier)}
          </table>
        </td></tr>`;
}

/** "uma delas vence hoje" / "3 vencem hoje" — só quando houver. */
function dueTodayNote(total: number, dueToday: number): string {
  if (dueToday === 0) return "";
  if (total === 1) return " &middot; vence hoje";
  if (dueToday === 1) return " &middot; uma delas vence hoje";
  return ` &middot; ${dueToday} vencem hoje`;
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
  const today = todayBR();
  const count = requests.length;
  const total = requests.reduce((sum, r) => sum + r.amount, 0);
  const dueToday = requests.filter((r) => isDueToday(r.dueDate, today)).length;
  const greetName = firstName(recipientName);

  const countPhrase = count === 1 ? "1 pagamento" : `${count} pagamentos`;
  const greeting = greetName ? `Oi, ${esc(greetName)} 👋 Você tem` : "Você tem";
  const preheader =
    `${count === 1 ? "1 requisição aguarda" : `${count} requisições aguardam`} a sua aprovação` +
    ` — ${BRL.format(total)} no total. Leva menos de um minuto.`;

  // Réguas 1px entre requisições; a primeira já vem depois da régua 2px do topo.
  const sections = requests
    .map((req, i) => (i === 0 ? "" : rule(C.ruleRequest, 1, 22)) + requestSection(req, today))
    .join("");

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>${esc(approvalReminderSubject(count))}</title>
  <style>
    @media only screen and (max-width:620px){
      .px{padding-left:22px !important;padding-right:22px !important;}
      .lbl{width:auto !important;}
    }
  </style>
</head>
<body style="margin:0;padding:0;background:${C.ground};-webkit-text-size-adjust:100%;">
  <span style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.ground};font-size:1px;">${esc(preheader)}</span>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.ground};">
    <tr><td align="center" style="padding:28px 12px 40px;">

      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:${C.card};">

        <!-- mensagem do dia (topo) -->
        <tr><td bgcolor="${C.accent}" class="px" style="background:${C.accent};padding:24px 32px 26px;font-family:${FF};">
          <div style="font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${C.accentSoft};padding-bottom:10px;mso-line-height-rule:exactly;line-height:14px;">Mensagem do dia</div>
          <div style="font-size:19px;line-height:27px;font-weight:600;color:#ffffff;mso-line-height-rule:exactly;">&ldquo;${esc(fortune)}&rdquo;</div>
        </td></tr>

        <!-- cabeçalho / contagem -->
        <tr><td class="px" style="padding:26px 32px 0;font-family:${FF};">
          <div style="font-size:11px;font-weight:700;letter-spacing:1.8px;text-transform:uppercase;color:${C.body};padding-bottom:12px;mso-line-height-rule:exactly;line-height:14px;">Control Hub &middot; Compras</div>
          <div style="font-size:22px;line-height:29px;font-weight:700;color:${C.ink};mso-line-height-rule:exactly;">${greeting} <span style="color:${C.accentDark};">${esc(countPhrase)}</span> aguardando a sua aprovação.</div>
          <div style="font-size:14px;line-height:21px;color:${C.body};padding-top:8px;mso-line-height-rule:exactly;">Total de <strong style="color:${C.ink};">${esc(BRL.format(total))}</strong>${dueTodayNote(count, dueToday)}</div>
        </td></tr>

        ${rule(C.ruleStrong, 2, 22)}
        ${sections}
        ${rule(C.ruleStrong, 2, 24)}

        <!-- CTA -->
        <tr><td class="px" style="padding:22px 32px 28px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr><td bgcolor="${C.accent}" style="background:${C.accent};padding:15px 24px;">
              <a href="${CTRL_HOME_URL}" style="display:block;font-family:${FF};font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;mso-line-height-rule:exactly;line-height:18px;">Aprovar no Control Hub&nbsp;&nbsp;&rarr;</a>
            </td></tr>
          </table>
          <div style="font-family:${FF};font-size:12px;line-height:18px;color:${C.body};padding-top:11px;mso-line-height-rule:exactly;">Leva menos de um minuto e libera o time para seguir com as compras.</div>
        </td></tr>

        <!-- rodapé -->
        <tr><td bgcolor="${C.ink}" class="px" style="background:${C.ink};padding:22px 32px 24px;font-family:${FF};font-size:11px;line-height:18px;color:${C.footerText};mso-line-height-rule:exactly;">
          Você recebe este aviso porque estas requisições dependem da sua aprovação no Control Hub. Envio automático, uma vez por dia, às 10h (Brasília).<br><br>
          Viva Eventos &middot; Control Hub
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
