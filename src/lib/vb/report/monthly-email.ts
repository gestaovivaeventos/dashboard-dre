// src/lib/vb/report/monthly-email.ts
// Extrato mensal do credor em HTML de e-mail. Puro: recebe o extrato já
// calculado (monthly-statement.ts) e devolve assunto + HTML. Estilo inline e
// tabelas porque cliente de e-mail não roda CSS externo; o Gmail remove <svg>
// e <style>, então não há nada disso aqui. Nunca menciona planilha nem Omie:
// para o credor, o VB é a fonte.

import type { MonthlyStatement, MonthlyStatementLine } from "@/lib/vb/report/monthly-statement";

const INK = "#1B2430";
const MUTED = "#6B7686";
const GROUND = "#F5F7FA";
const RULE = "#E1E6EE";
const ENTRADA = "#1F7A4D";
const SAIDA = "#B42318";
const RENDIMENTO = "#0B6E99";
const FONT = "'IBM Plex Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif";

const MONTHS = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTHS[m - 1]} de ${y}`;
}

function shortMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTHS[m - 1].slice(0, 3)}/${y}`;
}

function brl(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });
}

/** Valor com sinal explícito para a coluna de lançamentos. */
function signed(value: number): string {
  const abs = Math.abs(value).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${value < 0 ? "−" : "+"} ${abs}`;
}

function day(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function pct(rate: number): string {
  return `${(rate * 100).toLocaleString("pt-BR", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}%`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function kindColor(kind: MonthlyStatementLine["kind"]): string {
  if (kind === "entrada") return ENTRADA;
  if (kind === "saida") return SAIDA;
  return RENDIMENTO;
}

function kindLabel(kind: MonthlyStatementLine["kind"]): string {
  if (kind === "entrada") return "Entrada";
  if (kind === "saida") return "Saída";
  return "Rendimento";
}

function lineRow(line: MonthlyStatementLine, last: boolean): string {
  const border = last ? "" : `border-bottom:1px solid ${RULE};`;
  const color = kindColor(line.kind);
  const detail =
    line.kind === "rendimento" && line.period_start && line.period_end
      ? `<div style="font-size:11px;color:${MUTED};margin-top:2px">${day(line.period_start)} a ${day(line.period_end)}${line.rate != null ? ` · ${pct(line.rate)}` : ""}</div>`
      : "";
  const balanceColor = line.balance < 0 ? SAIDA : INK;
  return `
    <tr>
      <td style="padding:9px 0 9px 20px;${border}font-size:13px;color:${MUTED};white-space:nowrap;vertical-align:top">${day(line.entry_date)}</td>
      <td style="padding:9px 12px;${border}font-size:13px;color:${INK};vertical-align:top">
        <span style="display:inline-block;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:${color};font-weight:600;margin-right:8px">${kindLabel(line.kind)}</span>${escapeHtml(line.description)}${detail}
      </td>
      <td align="right" style="padding:9px 12px;${border}font-size:13px;color:${color};font-weight:600;white-space:nowrap;vertical-align:top;font-variant-numeric:tabular-nums">${signed(line.amount)}</td>
      <td align="right" style="padding:9px 20px 9px 12px;${border}font-size:13px;color:${balanceColor};white-space:nowrap;vertical-align:top;font-variant-numeric:tabular-nums">${brl(line.balance)}</td>
    </tr>`;
}

function statCell(label: string, value: string, color: string, align: "left" | "right" = "left"): string {
  return `
    <td align="${align}" style="padding:0 8px;vertical-align:top">
      <div style="font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:${MUTED};margin-bottom:4px">${label}</div>
      <div style="font-size:15px;font-weight:600;color:${color};font-variant-numeric:tabular-nums;white-space:nowrap">${value}</div>
    </td>`;
}

export interface VbMonthlyEmailInput {
  creditorName: string;
  statement: MonthlyStatement;
  /** 'YYYY-MM-DD' em que o e-mail foi gerado. */
  generatedOn: string;
  /** Tarja no topo (e-mail de TESTE). O envio oficial não passa nada. */
  banner?: { title: string; text: string };
}

export function vbMonthlyEmailSubject(creditorName: string, month: string): string {
  return `VB · Extrato de ${shortMonth(month)} — ${creditorName}`;
}

export function renderVbMonthlyEmail(input: VbMonthlyEmailInput): { subject: string; html: string } {
  const { creditorName, statement: s } = input;
  const subject = vbMonthlyEmailSubject(creditorName, s.month);
  const closingColor = s.closing_balance < 0 ? SAIDA : INK;
  const banner = input.banner
    ? `<div style="max-width:640px;margin:0 auto 14px;background:#FFF4D6;border:1px solid #E8C468;border-radius:6px;padding:12px 16px;font-size:13px;color:#7A5300">
        <strong style="display:block;margin-bottom:2px">${escapeHtml(input.banner.title)}</strong>${escapeHtml(input.banner.text)}
      </div>`
    : "";

  const rows = s.lines.length
    ? s.lines.map((line, i) => lineRow(line, i === s.lines.length - 1)).join("")
    : `<tr><td colspan="4" style="padding:18px 20px;font-size:13px;color:${MUTED}">Nenhuma movimentação neste mês. O saldo permaneceu ${brl(s.opening_balance)}.</td></tr>`;

  const html = `
<div style="background:${GROUND};padding:28px 12px;font-family:${FONT};color:${INK};-webkit-text-size-adjust:100%">
  ${banner}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid ${RULE};border-radius:6px;border-collapse:separate">
    <tr>
      <td style="padding:22px 20px 18px;border-bottom:3px solid ${RENDIMENTO}">
        <div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:${MUTED}">VB · Viva Bank</div>
        <div style="font-size:22px;font-weight:600;line-height:1.2;margin-top:6px">Extrato de ${monthLabel(s.month)}</div>
        <div style="font-size:14px;color:${MUTED};margin-top:4px">${escapeHtml(creditorName)}</div>
      </td>
    </tr>
    <tr>
      <td style="padding:18px 12px 6px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            ${statCell(`Saldo em ${day(s.opening_date)}`, brl(s.opening_balance), s.opening_balance < 0 ? SAIDA : INK)}
            ${statCell(`Saldo em ${day(s.closing_date)}`, brl(s.closing_balance), closingColor, "right")}
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:10px 12px 18px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            ${statCell("Entradas", s.entradas ? `+ ${brl(s.entradas)}` : "—", s.entradas ? ENTRADA : MUTED)}
            ${statCell("Saídas", s.saidas ? `− ${brl(Math.abs(s.saidas))}` : "—", s.saidas ? SAIDA : MUTED)}
            ${statCell("Rendimento no mês", s.rendimento ? `+ ${brl(s.rendimento)}` : "—", s.rendimento ? RENDIMENTO : MUTED, "right")}
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:0">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${RULE}">
          <tr style="background:${GROUND}">
            <th align="left" style="padding:8px 0 8px 20px;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:${MUTED};font-weight:600">Data</th>
            <th align="left" style="padding:8px 12px;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:${MUTED};font-weight:600">Lançamento</th>
            <th align="right" style="padding:8px 12px;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:${MUTED};font-weight:600">Valor</th>
            <th align="right" style="padding:8px 20px 8px 12px;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:${MUTED};font-weight:600">Saldo</th>
          </tr>
          ${rows}
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:16px 20px 8px;border-top:1px solid ${RULE}">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="font-size:12px;color:${MUTED}">Rendimento acumulado em ${s.month.slice(0, 4)}</td>
            <td align="right" style="font-size:13px;font-weight:600;color:${RENDIMENTO};font-variant-numeric:tabular-nums">${brl(s.rendimento_ano)}</td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:8px 20px 22px;font-size:12px;line-height:1.5;color:${MUTED}">
        O saldo rende 100% do CDI diário do Banco Central enquanto fica parado; cada movimentação fecha um período de rendimento.
        Saldo positivo é o valor que o VB deve a você.
      </td>
    </tr>
  </table>
  <div style="max-width:640px;margin:14px auto 0;font-size:11px;color:${MUTED};text-align:center">
    Extrato gerado em ${day(input.generatedOn)} pelo VB. Alguma diferença? Responda este e-mail.
  </div>
</div>`;

  return { subject, html };
}
