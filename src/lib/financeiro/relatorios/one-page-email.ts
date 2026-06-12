import type { OnePageReport, StatusGeral } from "./one-page-schema";
import type { KpiCardPayload, OnePagePayload, PrevistoRealizadoPayload } from "./one-page-payload";

// ============================================================================
// Renderiza o One Page Report como HTML de email (estilos inline, layout em
// tabelas — compativel com Gmail/Outlook). Mesma fonte de dados da tela
// /financeiro/business-intelligence: OnePagePayload (numeros) + OnePageReport
// (analise da IA). Usado pelo cron mensal de envio aos gestores.
// ============================================================================

export interface OnePageEmailArgs {
  companyName: string;
  periodLabel: string;
  payload: OnePagePayload;
  analysis: OnePageReport;
  appUrl?: string;
}

const STATUS_COLORS: Record<StatusGeral, { bg: string; fg: string }> = {
  Excelente: { bg: "#dcfce7", fg: "#166534" },
  Boa: { bg: "#dbeafe", fg: "#1e40af" },
  "Atenção": { bg: "#fef9c3", fg: "#854d0e" },
  "Crítica": { bg: "#fee2e2", fg: "#991b1b" },
};

const KPI_STATUS_COLORS: Record<KpiCardPayload["status"], string> = {
  positivo: "#16a34a",
  neutro: "#64748b",
  atencao: "#ca8a04",
  critico: "#dc2626",
};

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fmtValue(item: PrevistoRealizadoPayload, v: number | null): string {
  if (v === null) return "—";
  if (item.unidade === "currency") return BRL.format(v);
  if (item.unidade === "percent") return `${v.toFixed(1).replace(".", ",")}%`;
  return new Intl.NumberFormat("pt-BR").format(v);
}

function kpiCell(kpi: KpiCardPayload): string {
  const color = KPI_STATUS_COLORS[kpi.status];
  const variation = kpi.variationLabel
    ? `<div style="font-size:12px;color:${color};margin-top:2px;">${esc(kpi.variationLabel)}</div>`
    : "";
  return `
    <td style="padding:10px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;vertical-align:top;">
      <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.04em;">${esc(kpi.label)}</div>
      <div style="font-size:18px;font-weight:700;color:#0f172a;margin-top:2px;">${esc(kpi.formattedValue ?? "—")}</div>
      ${variation}
    </td>`;
}

function sectionTitle(title: string): string {
  return `<h2 style="font-size:14px;color:#0f172a;margin:24px 0 8px;border-bottom:1px solid #e2e8f0;padding-bottom:6px;">${esc(title)}</h2>`;
}

function badge(text: string, bg: string, fg: string): string {
  return `<span style="display:inline-block;background:${bg};color:${fg};font-size:11px;font-weight:600;padding:2px 8px;border-radius:9999px;">${esc(text)}</span>`;
}

const IMPACT_BADGE: Record<string, { bg: string; fg: string }> = {
  Alto: { bg: "#fee2e2", fg: "#991b1b" },
  Alta: { bg: "#fee2e2", fg: "#991b1b" },
  "Médio": { bg: "#fef9c3", fg: "#854d0e" },
  "Média": { bg: "#fef9c3", fg: "#854d0e" },
  Baixo: { bg: "#dcfce7", fg: "#166534" },
  Baixa: { bg: "#dcfce7", fg: "#166534" },
};

function impactBadge(label: string, value: string): string {
  const c = IMPACT_BADGE[value] ?? { bg: "#e2e8f0", fg: "#334155" };
  return badge(`${label}: ${value}`, c.bg, c.fg);
}

export function renderOnePageEmail({ companyName, periodLabel, payload, analysis, appUrl }: OnePageEmailArgs): string {
  const status = STATUS_COLORS[analysis.statusGeral];
  const { kpis } = payload;

  const kpiList = [
    kpis.receita,
    kpis.despesas,
    kpis.resultado,
    kpis.margem,
    kpis.fee_disponivel,
    kpis.sobrevivencia_caixa,
    ...(kpis.margem_media_eventos ? [kpis.margem_media_eventos] : []),
  ];

  // Grid de KPIs em linhas de 3 (email nao tem flexbox confiavel).
  const kpiRows: string[] = [];
  for (let i = 0; i < kpiList.length; i += 3) {
    const cells = kpiList
      .slice(i, i + 3)
      .map((k) => kpiCell(k))
      .join('<td style="width:8px;"></td>');
    kpiRows.push(`<tr>${cells}</tr><tr><td style="height:8px;"></td></tr>`);
  }

  const previstoRows = payload.previstoRealizado
    .map(
      (item) => `
      <tr>
        <td style="padding:6px 8px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#334155;">${esc(item.label)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#0f172a;text-align:right;font-weight:600;">${fmtValue(item, item.realizado)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#64748b;text-align:right;">${fmtValue(item, item.previsto)}</td>
      </tr>`,
    )
    .join("");

  const destaques = analysis.destaques
    .map(
      (d) => `
      <div style="margin-bottom:10px;padding:10px 12px;background:#f0fdf4;border-left:3px solid #16a34a;border-radius:0 6px 6px 0;">
        <div style="font-size:13px;font-weight:600;color:#0f172a;">${esc(d.titulo)} ${impactBadge("Impacto", d.impacto)}</div>
        <div style="font-size:13px;color:#334155;margin-top:4px;">${esc(d.descricao)}</div>
      </div>`,
    )
    .join("");

  const pontosAtencao = analysis.pontosAtencao
    .map(
      (p) => `
      <div style="margin-bottom:10px;padding:10px 12px;background:#fffbeb;border-left:3px solid #ca8a04;border-radius:0 6px 6px 0;">
        <div style="font-size:13px;font-weight:600;color:#0f172a;">${esc(p.titulo)} ${impactBadge("Risco", p.risco)}</div>
        <div style="font-size:13px;color:#334155;margin-top:4px;">${esc(p.descricao)}</div>
      </div>`,
    )
    .join("");

  const acoes = analysis.acoesRecomendadas
    .map(
      (a, i) => `
      <div style="margin-bottom:10px;padding:10px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;">
        <div style="font-size:13px;font-weight:600;color:#0f172a;">${i + 1}. ${esc(a.acao)}</div>
        <div style="font-size:13px;color:#334155;margin-top:4px;">${esc(a.justificativa)}</div>
        <div style="margin-top:6px;">
          ${impactBadge("Impacto", a.impacto)}
          ${impactBadge("Urgência", a.urgencia)}
          ${badge(`Área: ${a.areaResponsavel}`, "#e0e7ff", "#3730a3")}
        </div>
      </div>`,
    )
    .join("");

  const ctaUrl = appUrl ? `${appUrl.replace(/\/$/, "")}/financeiro/business-intelligence` : null;
  const cta = ctaUrl
    ? `<div style="text-align:center;margin:28px 0 8px;">
        <a href="${ctaUrl}" style="display:inline-block;background:#0f172a;color:#ffffff;font-size:13px;font-weight:600;padding:10px 24px;border-radius:8px;text-decoration:none;">Ver relatório completo no Controll Hub</a>
      </div>`
    : "";

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;padding:32px;font-family:Arial,Helvetica,sans-serif;">
        <tr><td>
          <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.08em;">Controll Hub — Business Intelligence</div>
          <h1 style="font-size:20px;color:#0f172a;margin:6px 0 2px;">${esc(companyName)}</h1>
          <div style="font-size:14px;color:#475569;">Relatório mensal — ${esc(periodLabel)}</div>
          <div style="margin-top:12px;">
            ${badge(`Saúde financeira: ${analysis.statusGeral}`, status.bg, status.fg)}
            ${badge(`Nota ${Math.round(analysis.notaGeral)}/100`, "#e2e8f0", "#334155")}
          </div>

          ${sectionTitle("Resumo executivo")}
          <p style="font-size:13px;color:#334155;line-height:1.6;margin:0;">${esc(analysis.resumoExecutivo)}</p>
          <p style="font-size:13px;color:#334155;line-height:1.6;margin:10px 0 0;"><strong>Diagnóstico:</strong> ${esc(analysis.diagnosticoPrincipal)}</p>

          ${sectionTitle("Indicadores do mês")}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${kpiRows.join("")}</table>

          ${sectionTitle("Previsto × Realizado")}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <th style="padding:6px 8px;font-size:11px;color:#64748b;text-align:left;text-transform:uppercase;">Indicador</th>
              <th style="padding:6px 8px;font-size:11px;color:#64748b;text-align:right;text-transform:uppercase;">Realizado</th>
              <th style="padding:6px 8px;font-size:11px;color:#64748b;text-align:right;text-transform:uppercase;">Previsto</th>
            </tr>
            ${previstoRows}
          </table>

          ${destaques ? sectionTitle("Destaques") + destaques : ""}
          ${pontosAtencao ? sectionTitle("Pontos de atenção") + pontosAtencao : ""}
          ${acoes ? sectionTitle("Ações recomendadas") + acoes : ""}

          ${cta}

          <div style="font-size:11px;color:#94a3b8;margin-top:24px;border-top:1px solid #e2e8f0;padding-top:12px;">
            Relatório gerado automaticamente pelo Controll Hub com apoio de IA. Os números vêm do DRE realizado e orçado da unidade; a leitura textual é gerada por IA e deve ser validada pelo gestor.
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
