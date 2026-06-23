import type {
  ClassificacaoIndicador,
  OnePageReport,
  StatusGeral,
} from "./one-page-schema";
import type {
  KpiCardPayload,
  KpisPayload,
  OnePagePayload,
  PrevistoRealizadoPayload,
} from "./one-page-payload";

// ============================================================================
// Renderiza o One Page Report como HTML de email — versao alinhada ao novo
// "Relatório Financeiro Mensal" (mesmo sistema visual da tela web), porém
// email-safe: layout em TABELAS, estilos inline, gráficos como barras CSS
// (sem recharts). Compatível com Gmail/Outlook/Apple Mail.
//
// Mesma fonte de dados da tela /financeiro/business-intelligence:
// OnePagePayload (números) + OnePageReport (análise da IA). Usado pelo cron
// mensal de envio aos gestores. A assinatura pública (OnePageEmailArgs /
// renderOnePageEmail) é mantida — nenhum caller muda.
// ============================================================================

export interface OnePageEmailArgs {
  companyName: string;
  periodLabel: string;
  payload: OnePagePayload;
  analysis: OnePageReport;
  appUrl?: string;
}

// ─── Sistema visual (espelha o componente web OnePageReportPreview) ─────────

const FF = "'IBM Plex Sans', Arial, Helvetica, sans-serif";
const FM = "'IBM Plex Mono', 'SFMono-Regular', Consolas, 'Liberation Mono', monospace";

const C = {
  pageBg: "#eceae6",
  cardBg: "#ffffff",
  cardBorder: "#e6e4df",
  rule: "#ecece7",
  grid: "#f1efea",
  previsto: "#aab0bb",
  metaAmber: "#d9a93a",
  ink: "#16191f",
  body: "#3c424d",
  sub: "#717784",
  tertiary: "#9aa0ac",
  darkCard: "#1b2532",
  darkLabel: "#8ba7c9",
  accent: "#1f6fd6",
} as const;

type SevKey = "critical" | "attention" | "positive" | "neutral";
const SEV: Record<SevKey, { text: string; bg: string; border: string }> = {
  critical: { text: "#c0392b", bg: "#fbecec", border: "#f1d3d3" },
  attention: { text: "#a9701a", bg: "#faf1e1", border: "#eee0bf" },
  positive: { text: "#27824f", bg: "#e7f3ec", border: "#cfe7d8" },
  neutral: { text: "#717784", bg: "#f1f1ee", border: "#e3e2db" },
};

function kpiStatusToSev(status: KpiCardPayload["status"]): SevKey {
  switch (status) {
    case "positivo":
      return "positive";
    case "atencao":
      return "attention";
    case "critico":
      return "critical";
    default:
      return "neutral";
  }
}

function classificacaoToSev(c: ClassificacaoIndicador): SevKey {
  switch (c) {
    case "Positivo":
      return "positive";
    case "Atenção":
      return "attention";
    case "Crítico":
      return "critical";
    default:
      return "neutral";
  }
}

function statusGeralToSev(s: StatusGeral): SevKey {
  switch (s) {
    case "Excelente":
    case "Boa":
      return "positive";
    case "Atenção":
      return "attention";
    case "Crítica":
      return "critical";
    default:
      return "neutral";
  }
}

function arrowFor(status: KpiCardPayload["status"], variation: string | null): string {
  if (status === "positivo") return "&#8593;"; // ↑
  if (status === "critico") return "&#8595;"; // ↓
  if ((variation ?? "").trim().startsWith("-")) return "&#8595;";
  if (status === "atencao") return "&#8599;"; // ↗
  return "&#8594;"; // →
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fmt1(v: number): string {
  return v.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 1 });
}

// "currency" é exibido em milhares (mesma convenção da tela web).
function fmtMil(v: number): string {
  return (v / 1000).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 1 });
}

function fmtItemValue(item: PrevistoRealizadoPayload, v: number | null): string {
  if (v === null) return "—";
  if (item.unidade === "percent") return `${fmt1(v)}%`;
  if (item.unidade === "currency") return `${fmtMil(v)} mil`;
  return new Intl.NumberFormat("pt-BR").format(v);
}

function formatGeradoEm(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `Gerado em ${dd}/${mm}/${d.getFullYear()}`;
}

interface Variacao {
  label: string;
  sev: SevKey;
}
function computeVariacao(item: PrevistoRealizadoPayload): Variacao {
  const r = item.realizado;
  const p = item.previsto;
  if (r === null || p === null) return { label: "—", sev: "neutral" };
  if (item.unidade === "percent") {
    const diff = r - p;
    return { label: `${diff >= 0 ? "+" : ""}${fmt1(diff)} p.p.`, sev: diff >= 0 ? "positive" : "attention" };
  }
  if (p === 0) return { label: "—", sev: "neutral" };
  const pct = ((r - p) / Math.abs(p)) * 100;
  const nome = item.label.toLowerCase();
  const inverte = nome.includes("custo") || nome.includes("despesa");
  const acima = pct >= 0;
  let sev: SevKey;
  if (inverte) sev = acima ? (pct > 10 ? "critical" : "attention") : "positive";
  else sev = acima ? "positive" : pct < -10 ? "critical" : "attention";
  return { label: `${pct >= 0 ? "+" : ""}${fmt1(pct)}%`, sev };
}

// ─── Primitivas de markup ─────────────────────────────────────────────────────

function sectionTitle(title: string): string {
  return `<div style="font-family:${FF};font-size:11px;letter-spacing:0.16em;text-transform:uppercase;font-weight:700;color:${C.ink};border-bottom:1px solid ${C.rule};padding-bottom:8px;margin:26px 0 14px;">${esc(
    title,
  )}</div>`;
}

function sevBadge(text: string, sev: SevKey, mono = false): string {
  const s = SEV[sev];
  return `<span style="display:inline-block;background:${s.bg};border:1px solid ${s.border};color:${s.text};font-family:${
    mono ? FM : FF
  };font-size:11px;font-weight:600;padding:2px 8px;border-radius:5px;white-space:nowrap;">${esc(text)}</span>`;
}

function chip(text: string, sev: SevKey): string {
  const s = SEV[sev];
  return `<span style="display:inline-block;background:${s.bg};border:1px solid ${s.border};color:${s.text};font-family:${FF};font-size:11px;font-weight:600;padding:3px 10px;border-radius:20px;margin:0 4px 4px 0;">${esc(
    text,
  )}</span>`;
}

// Barra horizontal (filled% + resto). font-size:0 evita altura fantasma.
function hbar(pct: number, color: string): string {
  const w = Math.max(1, Math.min(100, Math.round(pct)));
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:${C.grid};border-radius:20px;">
    <tr><td style="height:8px;background:${color};width:${w}%;border-radius:20px;font-size:0;line-height:0;">&nbsp;</td><td style="font-size:0;line-height:0;">&nbsp;</td></tr>
  </table>`;
}

// Linha "label .... valor" + barra. Usada no Acumulado e no VVR acumulado.
function barRow(label: string, valueLabel: string, pct: number, color: string, valueColor: string): string {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;">
      <tr>
        <td style="font-family:${FF};font-size:11px;color:${C.sub};padding-bottom:3px;">${esc(label)}</td>
        <td style="font-family:${FM};font-size:11px;color:${valueColor};font-weight:600;text-align:right;padding-bottom:3px;">${esc(
          valueLabel,
        )}</td>
      </tr>
      <tr><td colspan="2">${hbar(pct, color)}</td></tr>
    </table>`;
}

// ─── KPI card (saúde & caixa) ─────────────────────────────────────────────────

function kpiCell(kpi: KpiCardPayload, comparison: string | null): string {
  const sev = kpiStatusToSev(kpi.status);
  const s = SEV[sev];
  const arrow = arrowFor(kpi.status, kpi.variationLabel);
  const comp = comparison ? `<span style="color:${C.tertiary};font-weight:400;"> vs ${esc(comparison)}</span>` : "";
  const variation = kpi.variationLabel
    ? `<div style="font-family:${FF};font-size:11px;color:${s.text};font-weight:600;margin-top:6px;">${esc(
        kpi.variationLabel,
      )}${comp}</div>`
    : "";
  return `
    <td width="25%" style="background:${C.cardBg};border:1px solid ${C.cardBorder};border-radius:9px;padding:12px;vertical-align:top;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="font-family:${FF};font-size:10px;letter-spacing:0.08em;text-transform:uppercase;font-weight:600;color:${C.sub};vertical-align:top;">${esc(
          kpi.label,
        )}</td>
        <td width="22" style="text-align:right;vertical-align:top;">
          <span style="display:inline-block;width:22px;height:22px;line-height:22px;text-align:center;border-radius:6px;background:${s.bg};border:1px solid ${s.border};color:${s.text};font-size:13px;font-weight:700;">${arrow}</span>
        </td>
      </tr></table>
      <div style="font-family:${FM};font-size:18px;font-weight:600;color:${C.ink};margin-top:10px;">${esc(
        kpi.formattedValue ?? "—",
      )}</div>
      ${variation}
    </td>`;
}

// ─── Semáforo / chips de drivers ──────────────────────────────────────────────

function buildSemaforo(
  analysis: OnePageReport,
  kpis: KpisPayload,
): Array<{ indicador: string; sev: SevKey }> {
  const config: Array<{ indicador: string; terms: string[]; kpi?: KpiCardPayload }> = [
    { indicador: "Receita", terms: ["receita operacional bruta", "receita bruta", "receita"], kpi: kpis.receita },
    { indicador: "Despesas", terms: ["despesas operacionais", "despesas"] },
    { indicador: "Resultado", terms: ["resultado do exercicio", "resultado do exercício", "resultado"], kpi: kpis.resultado },
    { indicador: "Margem", terms: ["margem"], kpi: kpis.margem },
    { indicador: "FEE disponível", terms: ["fee disponível", "fee disponivel"], kpi: kpis.fee_disponivel },
    { indicador: "VVR", terms: ["vvr"], kpi: kpis.vvr },
  ];
  return config.map(({ indicador, terms, kpi }) => {
    for (const term of terms) {
      const match = analysis.leituraPorIndicador.find((l) => l.indicador.toLowerCase().includes(term));
      if (match) return { indicador, sev: classificacaoToSev(match.classificacao) };
    }
    return { indicador, sev: kpi ? kpiStatusToSev(kpi.status) : "neutral" };
  });
}

// ─── Render principal ──────────────────────────────────────────────────────────

export function renderOnePageEmail({
  companyName,
  periodLabel,
  payload,
  analysis,
  appUrl,
}: OnePageEmailArgs): string {
  const { kpis } = payload;
  const statusSev = statusGeralToSev(analysis.statusGeral);
  const statusS = SEV[statusSev];

  // 1. Header (eyebrow + empresa + geradoEm; período escuro + status + nota).
  const header = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-bottom:1px solid ${C.rule};padding-bottom:18px;">
      <tr>
        <td style="vertical-align:top;">
          <div style="font-family:${FF};font-size:10px;letter-spacing:0.18em;text-transform:uppercase;font-weight:700;color:${C.tertiary};">Relatório Financeiro Mensal</div>
          <div style="font-family:${FF};font-size:24px;font-weight:700;color:${C.ink};margin:6px 0 4px;">${esc(companyName)}</div>
          <div style="font-family:${FF};font-size:12px;color:${C.sub};">${esc(formatGeradoEm(payload.generatedAt))}</div>
        </td>
        <td style="vertical-align:top;text-align:right;">
          <table role="presentation" cellpadding="0" cellspacing="0" align="right"><tr>
            <td style="background:${C.darkCard};border-radius:8px;padding:12px 16px;vertical-align:top;">
              <div style="font-family:${FF};font-size:9px;letter-spacing:0.16em;text-transform:uppercase;font-weight:600;color:${C.darkLabel};">Período</div>
              <div style="font-family:${FF};font-size:16px;font-weight:700;color:#ffffff;margin-top:4px;white-space:nowrap;">${esc(periodLabel)}</div>
            </td>
            <td style="width:8px;"></td>
            <td style="background:${statusS.bg};border:1px solid ${statusS.border};border-radius:8px;padding:12px 16px;text-align:center;vertical-align:top;">
              <div style="font-family:${FF};font-size:9px;letter-spacing:0.16em;text-transform:uppercase;font-weight:600;color:${statusS.text};">Status</div>
              <div style="font-family:${FF};font-size:16px;font-weight:700;color:${statusS.text};margin-top:4px;white-space:nowrap;">${esc(
                analysis.statusGeral,
              )}</div>
            </td>
            <td style="width:8px;"></td>
            <td style="background:${C.cardBg};border:1px solid ${C.cardBorder};border-radius:8px;padding:12px 16px;text-align:center;vertical-align:top;">
              <div style="font-family:${FF};font-size:9px;letter-spacing:0.16em;text-transform:uppercase;font-weight:600;color:${C.sub};">Nota</div>
              <div style="font-family:${FM};font-size:22px;font-weight:600;color:${C.ink};margin-top:2px;">${Math.round(
                analysis.notaGeral,
              )}<span style="font-size:13px;color:${C.tertiary};font-weight:500;">/100</span></div>
            </td>
          </tr></table>
        </td>
      </tr>
    </table>`;

  // 2. Resumo executivo (resultado grande + diagnóstico + chips).
  const resultadoKpi = kpis.resultado;
  const resultadoNeg =
    (resultadoKpi.formattedValue ?? "").trim().startsWith("-") || resultadoKpi.status === "critico";
  const resultadoColor = resultadoNeg ? SEV.critical.text : C.ink;
  const semaforo = buildSemaforo(analysis, kpis);
  const chips = semaforo.map((s) => chip(s.indicador, s.sev)).join("");
  const resumo = `
    ${sectionTitle("Resumo Executivo")}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td width="38%" style="background:${C.cardBg};border:1px solid ${C.cardBorder};border-radius:9px;padding:16px;vertical-align:top;">
        <div style="font-family:${FF};font-size:10px;letter-spacing:0.12em;text-transform:uppercase;font-weight:600;color:${C.sub};">Resultado operacional do mês</div>
        <div style="font-family:${FM};font-size:30px;font-weight:600;color:${resultadoColor};margin:10px 0 6px;">${esc(
          resultadoKpi.formattedValue ?? "—",
        )}</div>
        ${
          resultadoKpi.variationLabel
            ? `<div style="font-family:${FF};font-size:12px;color:${C.sub};"><span style="font-family:${FM};color:${resultadoColor};font-weight:600;">${esc(
                resultadoKpi.variationLabel,
              )}</span> vs orçado</div>`
            : ""
        }
      </td>
      <td style="width:12px;"></td>
      <td style="background:${C.cardBg};border:1px solid ${C.cardBorder};border-radius:9px;padding:16px;vertical-align:top;">
        <div style="font-family:${FF};font-size:10px;letter-spacing:0.12em;text-transform:uppercase;font-weight:600;color:${C.accent};">Diagnóstico Principal</div>
        <div style="font-family:${FF};font-size:13px;line-height:1.55;color:${C.body};margin:8px 0 12px;">${esc(
          analysis.diagnosticoPrincipal || analysis.resumoExecutivo,
        )}</div>
        <div>${chips}</div>
      </td>
    </tr></table>`;

  // 3. Tabela desempenho vs orçamento.
  const desempenhoRows = payload.previstoRealizado
    .map((item) => {
      const isResultado = item.label.toLowerCase().includes("resultado");
      const v = computeVariacao(item);
      const sufMargem = item.unidade === "percent" ? `<span style="color:${C.tertiary};">*</span>` : "";
      const rowBg = isResultado ? "#f7f8fa" : "transparent";
      const labelWeight = isResultado ? 700 : 500;
      const labelColor = isResultado ? C.ink : C.body;
      return `
      <tr style="background:${rowBg};">
        <td style="font-family:${FF};font-size:13px;font-weight:${labelWeight};color:${labelColor};padding:9px 10px;border-bottom:1px solid ${C.grid};">${esc(
          item.label,
        )}${sufMargem}</td>
        <td style="font-family:${FM};font-size:12px;color:${C.sub};text-align:right;padding:9px 10px;border-bottom:1px solid ${C.grid};white-space:nowrap;">${fmtItemValue(
          item,
          item.previsto,
        )}</td>
        <td style="font-family:${FM};font-size:12px;font-weight:${isResultado ? 700 : 600};color:${
          isResultado ? C.ink : C.body
        };text-align:right;padding:9px 10px;border-bottom:1px solid ${C.grid};white-space:nowrap;">${fmtItemValue(
          item,
          item.realizado,
        )}</td>
        <td style="text-align:right;padding:9px 10px;border-bottom:1px solid ${C.grid};">${sevBadge(v.label, v.sev, true)}</td>
      </tr>`;
    })
    .join("");
  const thStyle = `font-family:${FF};font-size:9px;letter-spacing:0.1em;text-transform:uppercase;font-weight:700;color:${C.sub};padding:0 10px 8px;border-bottom:1px solid ${C.rule};`;
  const desempenho = `
    ${sectionTitle("Desempenho do mês vs orçamento")}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.cardBg};border:1px solid ${C.cardBorder};border-radius:9px;padding:14px 16px;border-collapse:separate;">
      <tr>
        <td style="${thStyle}text-align:left;">Indicador</td>
        <td style="${thStyle}text-align:right;">Orçado</td>
        <td style="${thStyle}text-align:right;">Realizado</td>
        <td style="${thStyle}text-align:right;">Variação</td>
      </tr>
      ${desempenhoRows}
      <tr><td colspan="4" style="font-family:${FF};font-size:10px;color:${C.tertiary};padding-top:10px;line-height:1.5;">Valores monetários em milhares de R$ (mil). *Margem expressa em % da receita bruta.</td></tr>
    </table>`;

  // 4. KPIs de saúde & caixa (4 por linha).
  // FEE disponível, Sobrevivência de caixa e VVR são específicos de Franquias
  // Viva e podem não vir (templates Real Estate/genérico os omitem). Inclui só
  // quando presentes — senão o card renderizaria vazio (e o tipo é opcional).
  const saudeKpis: Array<{ kpi: KpiCardPayload; comparison: string | null }> = [
    ...(kpis.fee_disponivel ? [{ kpi: kpis.fee_disponivel, comparison: null }] : []),
    ...(kpis.sobrevivencia_caixa ? [{ kpi: kpis.sobrevivencia_caixa, comparison: null }] : []),
    ...(kpis.vvr ? [{ kpi: kpis.vvr, comparison: "meta" as string | null }] : []),
    ...(kpis.margem_media_eventos ? [{ kpi: kpis.margem_media_eventos, comparison: null }] : []),
  ];
  const saudeRows: string[] = [];
  for (let i = 0; i < saudeKpis.length; i += 4) {
    const cells = saudeKpis
      .slice(i, i + 4)
      .map((k) => kpiCell(k.kpi, k.comparison))
      .join('<td style="width:10px;"></td>');
    saudeRows.push(`<tr>${cells}</tr><tr><td style="height:10px;"></td></tr>`);
  }
  const saude = `
    ${sectionTitle("Saúde financeira & caixa")}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${saudeRows.join("")}</table>`;

  // 5a. Acumulado do ano (barras horizontais Previsto × Realizado).
  const acumItems = payload.acumuladoAno.filter((i) => i.unidade === "currency");
  const acumMargem = payload.acumuladoAno.find((i) => i.unidade === "percent");
  const acumMax = Math.max(
    1,
    ...acumItems.flatMap((i) => [Math.abs(i.realizado ?? 0), Math.abs(i.previsto ?? 0)]),
  );
  const acumBlocks = acumItems
    .map((i) => {
      const prevPct = ((Math.abs(i.previsto ?? 0)) / acumMax) * 100;
      const realPct = ((Math.abs(i.realizado ?? 0)) / acumMax) * 100;
      return `
      <div style="margin-bottom:14px;">
        <div style="font-family:${FF};font-size:12px;font-weight:600;color:${C.ink};margin-bottom:6px;">${esc(i.label)}</div>
        ${barRow("Previsto", fmtItemValue(i, i.previsto), prevPct, C.previsto, C.sub)}
        ${barRow("Realizado", fmtItemValue(i, i.realizado), realPct, C.accent, C.accent)}
      </div>`;
    })
    .join("");
  const acumNota = acumMargem
    ? `<div style="font-family:${FM};font-size:11px;color:${C.body};margin-bottom:10px;">Margem acum. ${fmtItemValue(
        acumMargem,
        acumMargem.realizado,
      )} · orçado ${fmtItemValue(acumMargem, acumMargem.previsto)}</div>`
    : "";
  const acumulado = `
    ${sectionTitle("Acumulado do Ano")}
    <div style="background:${C.cardBg};border:1px solid ${C.cardBorder};border-radius:9px;padding:16px;">
      <div style="font-family:${FF};font-size:11px;color:${C.sub};margin-bottom:10px;">Janeiro do ano selecionado até o mês de análise — Previsto × Realizado</div>
      ${acumNota}
      ${acumBlocks || `<div style="font-family:${FF};font-size:12px;color:${C.tertiary};">Sem dados acumulados disponíveis.</div>`}
    </div>`;

  // 5b. VVR (tabela mensal + acumulado) e 5c. Resultado do exercício (tabela).
  const vvrMonthRows = payload.vvrSerieAnual
    .map(
      (p) => `
      <tr>
        <td style="font-family:${FF};font-size:11px;color:${C.body};padding:4px 6px;border-bottom:1px solid ${C.grid};">${esc(p.mes)}</td>
        <td style="font-family:${FM};font-size:11px;color:${C.accent};font-weight:600;text-align:right;padding:4px 6px;border-bottom:1px solid ${C.grid};">${
          p.realizado === null ? "—" : fmtMil(p.realizado) + " mil"
        }</td>
        <td style="font-family:${FM};font-size:11px;color:#a9701a;text-align:right;padding:4px 6px;border-bottom:1px solid ${C.grid};">${
          p.meta === null ? "—" : fmtMil(p.meta) + " mil"
        }</td>
      </tr>`,
    )
    .join("");
  const acumMeta = payload.vvrSerieAnual.reduce((s, p) => s + (p.meta ?? 0), 0);
  const acumReal = payload.vvrSerieAnual.reduce((s, p) => s + (p.realizado ?? 0), 0);
  const acumVvrMax = Math.max(acumMeta, acumReal, 1);
  const acumVvrAcima = acumReal >= acumMeta;
  const vvrPanel = `
    <td width="50%" style="background:${C.cardBg};border:1px solid ${C.cardBorder};border-radius:9px;padding:14px;vertical-align:top;">
      <div style="font-family:${FF};font-size:12px;font-weight:700;color:${C.ink};">VVR — Realizado × Meta</div>
      <div style="font-family:${FF};font-size:10px;color:${C.sub};margin-bottom:8px;">Jan até o mês de análise.</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="font-family:${FF};font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:${C.sub};padding:0 6px 4px;text-align:left;">Mês</td>
          <td style="font-family:${FF};font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:${C.sub};padding:0 6px 4px;text-align:right;">Realizado</td>
          <td style="font-family:${FF};font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:${C.sub};padding:0 6px 4px;text-align:right;">Meta</td>
        </tr>
        ${vvrMonthRows}
      </table>
      <div style="border-top:1px solid ${C.grid};margin-top:10px;padding-top:10px;">
        <div style="font-family:${FF};font-size:9px;text-transform:uppercase;letter-spacing:0.12em;font-weight:700;color:${C.sub};margin-bottom:8px;">VVR Acumulado</div>
        ${barRow("Meta", fmtMil(acumMeta) + " mil", (acumMeta / acumVvrMax) * 100, C.metaAmber, C.body)}
        ${barRow(
          "Realizado",
          fmtMil(acumReal) + " mil",
          (acumReal / acumVvrMax) * 100,
          acumVvrAcima ? SEV.positive.text : SEV.critical.text,
          acumVvrAcima ? SEV.positive.text : SEV.critical.text,
        )}
      </div>
    </td>`;

  const resultadoMonthRows = payload.historicoResultado
    .map(
      (p) => `
      <tr>
        <td style="font-family:${FF};font-size:11px;color:${C.body};padding:4px 6px;border-bottom:1px solid ${C.grid};">${esc(p.mes)}</td>
        <td style="font-family:${FM};font-size:11px;color:${C.sub};text-align:right;padding:4px 6px;border-bottom:1px solid ${C.grid};">${
          p.previsto === null ? "—" : fmtMil(p.previsto) + " mil"
        }</td>
        <td style="font-family:${FM};font-size:11px;color:${C.accent};font-weight:600;text-align:right;padding:4px 6px;border-bottom:1px solid ${C.grid};">${
          p.realizado === null ? "—" : fmtMil(p.realizado) + " mil"
        }</td>
      </tr>`,
    )
    .join("");
  const resultadoPanel = `
    <td width="50%" style="background:${C.cardBg};border:1px solid ${C.cardBorder};border-radius:9px;padding:14px;vertical-align:top;">
      <div style="font-family:${FF};font-size:12px;font-weight:700;color:${C.ink};">Resultado do Exercício</div>
      <div style="font-family:${FF};font-size:10px;color:${C.sub};margin-bottom:8px;">Previsto × Realizado — últimos meses.</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="font-family:${FF};font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:${C.sub};padding:0 6px 4px;text-align:left;">Mês</td>
          <td style="font-family:${FF};font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:${C.sub};padding:0 6px 4px;text-align:right;">Previsto</td>
          <td style="font-family:${FF};font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:${C.sub};padding:0 6px 4px;text-align:right;">Realizado</td>
        </tr>
        ${resultadoMonthRows}
      </table>
    </td>`;
  const tendencia = `
    ${sectionTitle("Tendência & Acumulado")}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${vvrPanel}<td style="width:12px;"></td>${resultadoPanel}</tr></table>`;

  // 6. Alertas (pontosAtencao prioritários, depois destaques — máx. 3).
  interface AlertaView {
    titulo: string;
    texto: string;
    sev: SevKey;
    label: string;
    icon: string;
  }
  const alertas: AlertaView[] = [];
  for (const p of analysis.pontosAtencao) {
    if (alertas.length >= 3) break;
    const sev: SevKey = p.risco === "Alto" ? "critical" : "attention";
    alertas.push({
      titulo: p.titulo,
      texto: p.descricao,
      sev,
      label: sev === "critical" ? "Crítico" : "Atenção",
      icon: sev === "critical" ? "&#9650;" : "!",
    });
  }
  for (const d of analysis.destaques) {
    if (alertas.length >= 3) break;
    alertas.push({ titulo: d.titulo, texto: d.descricao, sev: "positive", label: "Positivo", icon: "&#10003;" });
  }
  const alertaCells = alertas
    .map((a) => {
      const s = SEV[a.sev];
      return `
      <td width="33%" style="background:${s.bg};border:1px solid ${s.border};border-radius:8px;padding:14px;vertical-align:top;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td><span style="display:inline-block;width:22px;height:22px;line-height:22px;text-align:center;border-radius:6px;background:#ffffff;border:1px solid ${s.border};color:${s.text};font-size:12px;font-weight:700;">${a.icon}</span></td>
          <td style="text-align:right;">${sevBadge(a.label, a.sev)}</td>
        </tr></table>
        <div style="font-family:${FF};font-size:13px;font-weight:700;color:${C.ink};margin:8px 0 4px;">${esc(a.titulo)}</div>
        <div style="font-family:${FF};font-size:11px;line-height:1.5;color:${C.body};">${esc(a.texto)}</div>
      </td>`;
    })
    .join('<td style="width:10px;"></td>');
  const alertasBlock = alertas.length
    ? `${sectionTitle("Alertas")}<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${alertaCells}</tr></table>`
    : "";

  // 7. Ações recomendadas (máx. 3, em 2 colunas — quebra para nova linha).
  const impactoSev: Record<string, SevKey> = { Alto: "critical", "Médio": "attention", Baixo: "neutral" };
  const urgenciaSev: Record<string, SevKey> = { Alta: "critical", "Média": "attention", Baixa: "neutral" };
  const acoesList = analysis.acoesRecomendadas.slice(0, 3);
  // Monta linhas de 2 colunas (a última ação ímpar ganha célula vazia à direita).
  const acaoRows: string[] = [];
  const cellsArr = acoesList.map(
    (a) => `
      <td width="50%" style="background:${C.cardBg};border:1px solid ${C.cardBorder};border-radius:9px;padding:14px;vertical-align:top;">
        <div style="font-family:${FF};font-size:9px;letter-spacing:0.12em;text-transform:uppercase;font-weight:700;color:${C.tertiary};margin-bottom:6px;">Ação Recomendada</div>
        <div style="font-family:${FF};font-size:13px;font-weight:600;line-height:1.4;color:${C.ink};margin-bottom:6px;">${esc(a.acao)}</div>
        <div style="font-family:${FF};font-size:11px;line-height:1.5;color:${C.body};margin-bottom:8px;">${esc(a.justificativa)}</div>
        <div style="margin-bottom:8px;">${sevBadge(`Impacto: ${a.impacto}`, impactoSev[a.impacto] ?? "neutral")} ${sevBadge(
      `Urgência: ${a.urgencia}`,
      urgenciaSev[a.urgencia] ?? "neutral",
    )}</div>
        <div style="font-family:${FF};font-size:11px;color:${C.sub};">Área: <span style="font-weight:600;color:${C.body};">${esc(
      a.areaResponsavel,
    )}</span></div>
      </td>`,
  );
  for (let i = 0; i < cellsArr.length; i += 2) {
    const pair = cellsArr.slice(i, i + 2).join('<td style="width:12px;"></td>');
    const filler = cellsArr.slice(i, i + 2).length === 1 ? '<td style="width:12px;"></td><td width="50%"></td>' : "";
    acaoRows.push(`<tr>${pair}${filler}</tr><tr><td style="height:12px;"></td></tr>`);
  }
  const acoesBlock = acoesList.length
    ? `${sectionTitle("Ações Recomendadas")}<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${acaoRows.join(
        "",
      )}</table>`
    : "";

  // CTA + footer.
  const ctaUrl = appUrl ? `${appUrl.replace(/\/$/, "")}/financeiro/business-intelligence` : null;
  const cta = ctaUrl
    ? `<div style="text-align:center;margin:24px 0 4px;">
        <a href="${ctaUrl}" style="display:inline-block;background:${C.darkCard};color:#ffffff;font-family:${FF};font-size:13px;font-weight:600;padding:11px 26px;border-radius:8px;text-decoration:none;">Ver relatório completo no Controll Hub</a>
      </div>`
    : "";

  const footer = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${C.rule};margin-top:18px;padding-top:14px;">
      <tr>
        <td style="font-family:${FF};font-size:11px;color:${C.tertiary};">${esc(companyName)}</td>
        <td style="font-family:${FF};font-size:11px;color:${C.tertiary};text-align:right;">${esc(periodLabel)}</td>
      </tr>
    </table>
    <div style="font-family:${FF};font-size:10px;color:${C.tertiary};margin-top:12px;line-height:1.5;">
      Relatório gerado automaticamente pelo Controll Hub com apoio de IA. Os números vêm do DRE realizado e orçado da unidade; a leitura textual é gerada por IA e deve ser validada pelo gestor.
    </div>`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap');
  </style>
</head>
<body style="margin:0;padding:0;background:${C.pageBg};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.pageBg};padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="760" cellpadding="0" cellspacing="0" style="background:${C.cardBg};border:1px solid ${C.cardBorder};border-radius:7px;padding:32px 34px;max-width:760px;width:100%;">
        <tr><td>
          ${header}
          ${resumo}
          ${desempenho}
          ${saude}
          ${acumulado}
          ${tendencia}
          ${alertasBlock}
          ${acoesBlock}
          ${cta}
          ${footer}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
