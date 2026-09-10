import type {
  AlertaCard,
  BreakdownBlock,
  Consolidated,
  CustodyClosingBlock,
  DividendosSociosBlock,
  DividendosUnidadesBlock,
  DreIndicatorsBlock,
  FeatContasReceberAbertoBlock,
  FeatEventosBlock,
  HoldingComparativoBlock,
  IsolatedResult,
  KpiCard,
  MutuosBlock,
  OnePageReportPreviewData,
  PartnerPerformance,
  PrevRealChart,
  PrevistoRealizadoItem,
} from "@/components/financeiro/relatorios/OnePageReportPreview";
import { svgToPng } from "@/lib/financeiro/relatorios/one-page-chart-png";
import {
  columnsChartSvg,
  comboChartSvg,
  horizontalBarsSvg,
  lineChartSvg,
  type ChartPalette,
  type ChartSeries,
} from "@/lib/financeiro/relatorios/one-page-chart-svg";

// ============================================================================
// Renderiza o One Page Report como HTML de e-mail A PARTIR DO MESMO OBJETO
// exibido na tela de Business Intelligence.
//
// PRINCÍPIO (regra de negócio): o relatório enviado por e-mail tem de ser
// IDÊNTICO ao gerado na tela. Para isso, este renderer NÃO recebe o payload
// cru: recebe `OnePageReportPreviewData` — exatamente o que
// `mapOnePageApiResponseToPreviewData` entrega ao componente
// `OnePageReportPreview`. Como consequência:
//
//   • a ORDEM dos blocos espelha a ordem do componente;
//   • a allowlist `data.blocks` (particularidade por template/empresa) é
//     respeitada aqui pela mesma função `show()`;
//   • blocos exclusivos de uma empresa (holding, mútuos, dividendos, eventos
//     da Feat, custódia da Case, indicadores do Terrazzo, parceiros da Young
//     Med, breakdowns da Spot, consolidado do grupo…) aparecem no e-mail
//     quando — e só quando — aparecem na tela;
//   • campos ocultos na tela continuam ocultos no e-mail, porque simplesmente
//     não existem no objeto.
//
// A única diferença é o MEIO: e-mail não roda recharts nem CSS moderno. Os
// textos, números, rótulos, arredondamentos e regras de cor são os mesmos do
// componente; o que muda é como o GRÁFICO chega ao leitor.
//
// Gráficos: cada bloco é desenhado em SVG (`one-page-chart-svg.ts`) e
// rasterizado em PNG (`one-page-chart-png.ts`), embutido como anexo inline
// (`cid:`) — imagem é o único formato que abre em Gmail, Outlook e Apple Mail
// (o Gmail remove `<svg>`). Por isso `renderOnePageEmail` é async e devolve
// `{ html, attachments }`: quem envia PRECISA repassar os anexos, senão as
// imagens chegam quebradas.
//
// Se a rasterização falhar (wasm ausente, fonte ausente, SVG inválido), cada
// bloco cai no HTML de tabela/barra que existia antes — este código roda no
// cron de envio automático e um gráfico não pode derrubar o relatório. Pelo
// mesmo motivo todo `<img>` leva `alt` com os números: leitor que bloqueia
// imagem (padrão em parte do Outlook) continua recebendo a informação.
// ============================================================================

export interface OnePageEmailArgs {
  /** Mesmo objeto renderizado por <OnePageReportPreview data={...} />. */
  data: OnePageReportPreviewData;
  /** Base URL do Control Hub, para o botão "ver no sistema". */
  appUrl?: string;
}

// ─── Sistema visual (espelha o componente web) ──────────────────────────────

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
  emphasisBg: "#f7f8fa",
} as const;

type SevKey = "critical" | "attention" | "positive" | "neutral";
const SEV: Record<SevKey, { text: string; bg: string; border: string }> = {
  critical: { text: "#c0392b", bg: "#fbecec", border: "#f1d3d3" },
  attention: { text: "#a9701a", bg: "#faf1e1", border: "#eee0bf" },
  positive: { text: "#27824f", bg: "#e7f3ec", border: "#cfe7d8" },
  neutral: { text: "#717784", bg: "#f1f1ee", border: "#e3e2db" },
};

// ─── Gráficos como imagem inline ────────────────────────────────────────────

/** Anexo inline (`cid:`) que o remetente precisa repassar ao Resend. */
export interface OnePageEmailAttachment {
  filename: string;
  contentId: string;
  contentType: string;
  content: Buffer;
}

/** Larguras de exibição, derivadas do card de 880px com 38px de padding. */
const CHART_W_FULL = 752;
const CHART_W_HALF = 352;

const CHART_PALETTE: ChartPalette = {
  axis: "#c8c5be",
  grid: C.grid,
  label: C.sub,
  valueLabel: C.body,
  background: C.cardBg,
};

/**
 * Coleta os PNGs gerados e devolve o `<img>` correspondente. Falhou a
 * rasterização? Devolve o `fallback` (a tabela/barra de antes) — nunca lança.
 */
class ChartAssets {
  private readonly items: OnePageEmailAttachment[] = [];
  private seq = 0;

  async image(args: {
    svg: string;
    width: number;
    alt: string;
    fallback: string;
  }): Promise<string> {
    const png = await svgToPng(args.svg, args.width);
    if (!png) return args.fallback;
    this.seq += 1;
    const contentId = `onepage-chart-${this.seq}`;
    this.items.push({
      filename: `grafico-${this.seq}.png`,
      contentId,
      contentType: "image/png",
      content: png,
    });
    return `<img src="cid:${contentId}" alt="${esc(args.alt)}" width="${args.width}" style="display:block;width:100%;max-width:${args.width}px;height:auto;border:0;outline:none;text-decoration:none;">`;
  }

  list(): OnePageEmailAttachment[] {
    return this.items;
  }
}

/**
 * "Acumulado no ano" — Previsto × Realizado em barras, espelhando o
 * `AcumPrevRealFooter` da tela (rótulo + valor em cima, barra cheia embaixo).
 *
 * Aqui NÃO usamos imagem: a forma da tela é exatamente uma barra de progresso,
 * que HTML de tabela reproduz igual — e assim este bloco continua visível mesmo
 * com imagem bloqueada. Antes isto era uma linha de texto ("Acumulado no ano ·
 * orçado X · realizado Y"), que é o que sumia em relação à tela.
 */
function acumPrevRealFooter(
  acum: { previsto: number | null; realizado: number | null },
  fmt: (value: number | null) => string,
): string {
  const { previsto, realizado } = acum;
  const max = Math.max(1, Math.abs(previsto ?? 0), Math.abs(realizado ?? 0));
  const variation =
    previsto !== null && previsto !== 0 && realizado !== null
      ? ((realizado - previsto) / Math.abs(previsto)) * 100
      : null;
  const variationHtml =
    variation === null
      ? ""
      : `<span style="font-family:${FF};font-size:10px;font-weight:600;color:${
          variation >= 0 ? SEV.positive.text : SEV.critical.text
        };margin-left:6px;">${esc(
          `${variation >= 0 ? "+" : ""}${fmtNum(variation, 1)}% vs previsto`,
        )}</span>`;

  const row = (
    label: string,
    value: number | null,
    color: string,
    valueColor: string,
    suffix: string,
  ) => `
    <div style="margin-bottom:9px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="font-family:${FF};font-size:12px;color:${C.body};">${esc(label)}</td>
        <td style="text-align:right;white-space:nowrap;"><span style="font-family:${FM};font-size:12px;font-weight:600;color:${valueColor};">${esc(
          fmt(value),
        )}</span>${suffix}</td>
      </tr></table>
      <div style="height:4px;line-height:4px;font-size:0;">&nbsp;</div>
      ${hbar((Math.abs(value ?? 0) / max) * 100, color)}
    </div>`;

  return `
    <div style="margin-top:10px;border-top:1px solid ${C.grid};padding-top:10px;">
      <div style="font-family:${FF};font-size:9px;letter-spacing:0.12em;text-transform:uppercase;font-weight:700;color:${C.sub};margin-bottom:8px;">Acumulado no ano</div>
      ${row("Realizado", realizado, C.accent, C.ink, variationHtml)}
      ${row("Previsto", previsto, C.previsto, C.sub, "")}
    </div>`;
}

/**
 * "Acumulado no ano" de N séries — uma barra por série, com a variação % em
 * relação à série base (a orçada). Espelha o rodapé do `GraficoLinhasMulti`
 * da tela; antes o e-mail resumia isso numa linha de texto.
 */
function acumSeriesFooter(
  values: Array<number | null | undefined>,
  labels: string[],
  colors: string[],
  baseIndex: number | undefined,
  fmt: (value: number | null) => string,
): string {
  const max = Math.max(1, ...values.map((v) => Math.abs(v ?? 0)));
  const base = baseIndex !== undefined ? values[baseIndex] : null;
  const rows = values
    .map((v, i) => {
      let suffix = "";
      if (
        baseIndex !== undefined &&
        i !== baseIndex &&
        v !== null &&
        v !== undefined &&
        base !== null &&
        base !== undefined &&
        base !== 0
      ) {
        const pct = ((v - base) / Math.abs(base)) * 100;
        suffix = `<span style="font-family:${FF};font-size:10px;font-weight:600;color:${
          pct >= 0 ? SEV.positive.text : SEV.critical.text
        };margin-left:6px;">${esc(`${pct >= 0 ? "+" : ""}${fmtNum(pct, 1)}% vs orçado`)}</span>`;
      }
      return `
      <div style="margin-bottom:9px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="font-family:${FF};font-size:12px;color:${C.body};">${esc(
            labels[i] ?? `Série ${i + 1}`,
          )}</td>
          <td style="text-align:right;white-space:nowrap;"><span style="font-family:${FM};font-size:12px;font-weight:600;color:${C.ink};">${esc(
            fmt(v ?? null),
          )}</span>${suffix}</td>
        </tr></table>
        <div style="height:4px;line-height:4px;font-size:0;">&nbsp;</div>
        ${hbar((Math.abs(v ?? 0) / max) * 100, colors[i % colors.length])}
      </div>`;
    })
    .join("");

  return `
    <div style="margin-top:10px;border-top:1px solid ${C.grid};padding-top:10px;">
      <div style="font-family:${FF};font-size:9px;letter-spacing:0.12em;text-transform:uppercase;font-weight:700;color:${C.sub};margin-bottom:8px;">Acumulado no ano</div>
      ${rows}
    </div>`;
}

/** Texto do `alt` — mantém os números legíveis se a imagem for bloqueada. */
function altFromSeries(
  title: string,
  categories: string[],
  series: Array<{ label: string; values: (number | null)[] }>,
  format: (v: number) => string,
): string {
  const body = series
    .map(
      (s) =>
        `${s.label}: ${categories
          .map((c, i) => {
            const v = s.values[i];
            return `${c} ${v === null || v === undefined ? "—" : format(v)}`;
          })
          .join("; ")}`,
    )
    .join(" | ");
  return `${title}. ${body}`;
}

type ImpactSign = "Positivo" | "Atenção" | "Neutro" | "Crítico";

function signToSev(sign: ImpactSign): SevKey {
  switch (sign) {
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

/** Seta direcional do KPI — mesma regra do componente. */
function arrowFor(sign: ImpactSign, variation: string): string {
  if (sign === "Positivo") return "&#8593;"; // ↑
  if (sign === "Crítico") return "&#8595;"; // ↓
  if (variation.trim().startsWith("-")) return "&#8595;";
  if (sign === "Atenção") return "&#8599;"; // ↗
  return "&#8594;"; // →
}

// ─── Helpers de formatação (idênticos ao componente) ────────────────────────

function esc(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function fmtNum(value: number, fractionDigits = 1): string {
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits,
  });
}

function fmtValueWithUnit(value: number, unidade: "mil" | "%"): string {
  if (unidade === "%") {
    return `${value.toLocaleString("pt-BR", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    })}%`;
  }
  return `${fmtNum(value)} mil`;
}

function fmtMoneyFull(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtMoneyInt(value: number): string {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });
}

function fmtPctPtBr(value: number): string {
  return `${value.toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

function fmtPctMeta(value: number): string {
  return `${value.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}

function fmtMil(value: number | null): string {
  return value === null || value === undefined ? "—" : `${fmtNum(value, 1)} mil`;
}

function formatGeradoEm(raw: string): string {
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(raw ?? "");
  if (iso) return `Gerado em: ${iso[3]}/${iso[2]}/${iso[1].slice(-2)}`;
  const br = /(\d{2})\/(\d{2})\/(\d{2,4})/.exec(raw ?? "");
  if (br) return `Gerado em: ${br[1]}/${br[2]}/${br[3].slice(-2)}`;
  return raw ?? "";
}

/** Variação da tabela de desempenho — mesma heurística do componente. */
function variationCell(item: PrevistoRealizadoItem): { label: string; sev: SevKey } {
  if (item.unidade === "%") {
    const diff = item.realizado - item.previsto;
    return {
      label: `${diff >= 0 ? "+" : ""}${fmtNum(diff)} p.p.`,
      sev: diff >= 0 ? "positive" : "attention",
    };
  }
  if (item.previsto === 0) return { label: "—", sev: "neutral" };
  const pct = ((item.realizado - item.previsto) / Math.abs(item.previsto)) * 100;
  const nome = item.indicador.toLowerCase();
  const inverte = nome.includes("custo") || nome.includes("despesa");
  const acima = pct >= 0;
  let sev: SevKey;
  if (inverte) sev = acima ? (pct > 10 ? "critical" : "attention") : "positive";
  else sev = acima ? "positive" : pct < -10 ? "critical" : "attention";
  return { label: `${pct >= 0 ? "+" : ""}${fmtNum(pct)}%`, sev };
}

// ─── Primitivas de markup (tabelas + inline styles = email-safe) ────────────

function sectionTitle(title: string): string {
  return `<div style="font-family:${FF};font-size:10px;letter-spacing:0.18em;text-transform:uppercase;font-weight:700;color:${C.ink};border-bottom:1px solid ${C.rule};padding-bottom:8px;margin:24px 0 14px;">${esc(
    title,
  )}</div>`;
}

function caption(text: string): string {
  return `<div style="font-family:${FF};font-size:10px;color:${C.sub};margin:-6px 0 8px;line-height:1.5;">${text}</div>`;
}

function sevBadge(text: string, sev: SevKey, mono = false): string {
  const s = SEV[sev];
  return `<span style="display:inline-block;font-family:${
    mono ? FM : FF
  };font-size:10.5px;font-weight:600;color:${s.text};background:${s.bg};border:1px solid ${
    s.border
  };border-radius:6px;padding:2px 7px;white-space:nowrap;">${esc(text)}</span>`;
}

function chip(text: string, sev: SevKey): string {
  const s = SEV[sev];
  return `<span style="display:inline-block;font-family:${FF};font-size:11px;font-weight:600;color:${s.text};background:${s.bg};border:1px solid ${s.border};border-radius:20px;padding:3px 10px;margin:0 6px 6px 0;">${esc(
    text,
  )}</span>`;
}

/** Painel branco (equivalente ao `panelStyle` do componente). */
function panel(inner: string, padding = "16px"): string {
  return `<div style="border:1px solid ${C.cardBorder};border-radius:9px;background:${C.cardBg};padding:${padding};">${inner}</div>`;
}

function thCell(label: string, align: "left" | "right" | "center" = "left", width?: string): string {
  return `<th style="font-family:${FF};font-size:9px;letter-spacing:0.12em;text-transform:uppercase;font-weight:700;color:${C.sub};padding:0 10px 8px;text-align:${align};border-bottom:1px solid ${C.rule};${
    width ? `width:${width};` : ""
  }">${esc(label)}</th>`;
}

/** Barra horizontal proporcional (substitui os gráficos do recharts). */
function hbar(pct: number, color: string): string {
  const w = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0));
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.grid};border-radius:4px;"><tr><td style="width:${w}%;background:${color};height:8px;line-height:8px;font-size:0;border-radius:4px;">&nbsp;</td><td style="height:8px;line-height:8px;font-size:0;">&nbsp;</td></tr></table>`;
}

function barRow(
  label: string,
  valueLabel: string,
  pct: number,
  color: string,
  valueColor: string,
): string {
  return `
    <div style="margin-bottom:9px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="font-family:${FF};font-size:12px;color:${C.body};">${esc(label)}</td>
        <td style="font-family:${FM};font-size:12px;font-weight:600;color:${valueColor};text-align:right;">${esc(
          valueLabel,
        )}</td>
      </tr></table>
      <div style="height:4px;line-height:4px;font-size:0;">&nbsp;</div>
      ${hbar(pct, color)}
    </div>`;
}

/** Grade de N colunas usando tabela (email-safe). */
function grid(cells: string[], columns: number, gap = 12): string {
  if (cells.length === 0) return "";
  const cols = Math.max(1, columns);
  const width = `${Math.floor(100 / cols)}%`;
  const rows: string[] = [];
  for (let i = 0; i < cells.length; i += cols) {
    const slice = cells.slice(i, i + cols);
    const tds = slice
      .map((c) => `<td width="${width}" style="vertical-align:top;">${c}</td>`)
      .join(`<td style="width:${gap}px;font-size:0;">&nbsp;</td>`);
    // Completa a última linha para manter as larguras estáveis.
    const missing = cols - slice.length;
    const fillers = Array.from(
      { length: missing },
      () => `<td style="width:${gap}px;font-size:0;">&nbsp;</td><td width="${width}"></td>`,
    ).join("");
    rows.push(
      `<tr>${tds}${fillers}</tr>`,
      `<tr><td colspan="${cols * 2 - 1}" style="height:${gap}px;font-size:0;line-height:${gap}px;">&nbsp;</td></tr>`,
    );
  }
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.join("")}</table>`;
}

/** Card de indicador simples (espelha o `FeatIndicador` do componente). */
function indicatorCard(
  label: string,
  valueLabel: string,
  opts: { meta?: string; hint?: string; footer?: string; critical?: boolean } = {},
): string {
  return panel(
    `
    <div style="font-family:${FF};font-size:9px;letter-spacing:0.1em;text-transform:uppercase;font-weight:600;color:${C.sub};">${esc(
      label,
    )}</div>
    <div style="font-family:${FM};font-size:16px;font-weight:700;color:${
      opts.critical ? SEV.critical.text : C.ink
    };margin-top:6px;white-space:nowrap;">${esc(valueLabel)}</div>
    ${opts.meta ? `<div style="font-family:${FF};font-size:10px;color:${C.body};margin-top:4px;">${esc(opts.meta)}</div>` : ""}
    ${opts.hint ? `<div style="font-family:${FF};font-size:9.5px;color:${C.sub};margin-top:3px;">${esc(opts.hint)}</div>` : ""}
    ${opts.footer ? `<div style="font-family:${FF};font-size:9.5px;color:${C.tertiary};margin-top:6px;padding-top:4px;border-top:1px dashed ${C.grid};">${esc(opts.footer)}</div>` : ""}
  `,
    "14px",
  );
}

// ─── Blocos ─────────────────────────────────────────────────────────────────

function renderHeader(cab: OnePageReportPreviewData["cabecalho"]): string {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-bottom:1px solid ${C.rule};padding-bottom:18px;">
      <tr>
        <td style="vertical-align:top;">
          <div style="font-family:${FF};font-size:10px;letter-spacing:0.18em;text-transform:uppercase;font-weight:700;color:${C.tertiary};">Relatório Financeiro</div>
          <div style="font-family:${FF};font-size:26px;line-height:1.1;font-weight:700;color:${C.ink};margin:6px 0 4px;">${esc(
            cab.empresa,
          )}</div>
          <div style="font-family:${FF};font-size:12px;color:${C.sub};">${esc(
            formatGeradoEm(cab.geradoEm),
          )}</div>
        </td>
        <td style="vertical-align:top;text-align:right;">
          <div style="display:inline-block;background:${C.darkCard};border-radius:8px;padding:12px 16px;min-width:130px;text-align:left;">
            <div style="font-family:${FF};font-size:9px;letter-spacing:0.16em;text-transform:uppercase;font-weight:600;color:${C.darkLabel};">Período</div>
            <div style="font-family:${FF};font-size:18px;font-weight:700;color:#ffffff;margin-top:4px;">${esc(
              cab.periodo,
            )}</div>
          </div>
        </td>
      </tr>
    </table>`;
}

function renderResumo(data: OnePageReportPreviewData, showSemaforo: boolean): string {
  const resultadoKpi =
    data.kpis.find((k) => k.label.toLowerCase() === "resultado") ?? null;
  const valor = resultadoKpi?.value ?? "—";
  const variacao = resultadoKpi?.variation ?? "";
  const negativo = valor.trim().startsWith("-") || resultadoKpi?.sign === "Crítico";
  const valueColor = negativo ? SEV.critical.text : C.ink;

  const resultadoPanel = resultadoKpi
    ? panel(`
        <div style="font-family:${FF};font-size:10px;letter-spacing:0.14em;text-transform:uppercase;font-weight:600;color:${C.sub};">Resultado operacional do período</div>
        <div style="font-family:${FM};font-size:32px;font-weight:600;line-height:1.1;color:${valueColor};margin:10px 0 6px;">${esc(
          valor,
        )}</div>
        ${
          variacao
            ? `<div style="font-family:${FF};font-size:12px;color:${C.sub};"><span style="font-family:${FM};color:${valueColor};font-weight:600;">${esc(
                variacao,
              )}</span> vs orçado</div>`
            : ""
        }
        ${
          // Segunda leitura do mesmo indicador (Hero Holding): resultado do DRE
          // + dividendos recebidos. Idêntica à da tela — mesmo objeto de dados.
          data.resultadoComplemento
            ? `<div style="margin-top:10px;padding-top:8px;border-top:1px solid ${C.cardBorder};">
          <div style="font-family:${FF};font-size:11px;color:${C.sub};">${esc(
            data.resultadoComplemento.label,
          )}</div>
          <div style="font-family:${FM};font-size:20px;font-weight:600;color:${C.ink};margin-top:2px;">${esc(
            data.resultadoComplemento.value,
          )}</div>
        </div>`
            : ""
        }`)
    : "";

  const chips =
    showSemaforo && data.semaforo.length > 0
      ? `<div style="margin-top:10px;">${data.semaforo
          .map((s) => chip(s.indicador, signToSev(s.classificacao)))
          .join("")}</div>`
      : "";

  const diagnosticoPanel = panel(`
    <div style="font-family:${FF};font-size:10px;letter-spacing:0.14em;text-transform:uppercase;font-weight:600;color:${C.accent};">Diagnóstico Principal</div>
    <p style="font-family:${FF};margin:8px 0 0;font-size:13px;line-height:1.55;color:${C.body};">${esc(
      data.diagnosticoPrincipal || "Sem diagnóstico disponível para o período.",
    )}</p>
    ${chips}`);

  const body = resultadoKpi
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td width="41%" style="vertical-align:top;">${resultadoPanel}</td>
        <td style="width:16px;font-size:0;">&nbsp;</td>
        <td width="59%" style="vertical-align:top;">${diagnosticoPanel}</td>
      </tr></table>`
    : diagnosticoPanel;

  return `${sectionTitle("Resumo Executivo")}${body}`;
}

function renderTabelaDesempenho(data: OnePageReportPreviewData, showSemaforo: boolean): string {
  const items = data.previstoRealizado;
  if (items.length === 0) return "";

  const semaforoMap = new Map<string, SevKey>();
  if (showSemaforo) {
    for (const s of data.semaforo) {
      semaforoMap.set(s.indicador.toLowerCase(), signToSev(s.classificacao));
    }
  }

  const hasGroups = items.some((i) => i.group);
  const hasPercent = items.some((i) => i.unidade === "%");
  const footnotes = items.map((i) => i.footnote).filter((f): f is string => !!f);

  const rows: string[] = [];
  items.forEach((item, idx) => {
    if (item.group && item.group !== items[idx - 1]?.group) {
      rows.push(`<tr><td colspan="4" style="font-family:${FF};font-size:9px;letter-spacing:0.12em;text-transform:uppercase;font-weight:700;color:${C.tertiary};padding:${
        idx === 0 ? "2px 10px 6px" : "16px 10px 6px"
      };${idx === 0 ? "" : `border-top:1px solid ${C.rule};`}">${esc(item.group)}</td></tr>`);
    }
    const isResultado = item.indicador.toLowerCase().includes("resultado");
    const v = variationCell(item);
    const sev = semaforoMap.get(item.indicador.toLowerCase()) ?? v.sev;
    const suf = item.unidade === "%" || item.footnote ? "*" : "";
    const realNeg = hasGroups && item.unidade !== "%" && item.realizado < 0;
    const realColor = realNeg ? SEV.critical.text : isResultado ? C.ink : C.body;
    rows.push(`
      <tr style="background:${isResultado ? C.emphasisBg : "transparent"};">
        <td style="font-family:${FF};font-size:13px;font-weight:${
          isResultado ? 700 : 500
        };color:${isResultado ? C.ink : C.body};padding:9px 10px;border-bottom:1px solid ${C.grid};">${esc(
          item.indicador,
        )}${suf ? `<span style="color:${C.tertiary};">${suf}</span>` : ""}</td>
        <td style="font-family:${FM};font-size:12.5px;color:${C.sub};padding:9px 10px;text-align:right;border-bottom:1px solid ${C.grid};white-space:nowrap;">${esc(
          fmtValueWithUnit(item.previsto, item.unidade),
        )}</td>
        <td style="font-family:${FM};font-size:12.5px;font-weight:${
          isResultado ? 700 : 600
        };color:${realColor};padding:9px 10px;text-align:right;border-bottom:1px solid ${C.grid};white-space:nowrap;">${esc(
          fmtValueWithUnit(item.realizado, item.unidade),
        )}</td>
        <td style="padding:9px 10px;text-align:right;border-bottom:1px solid ${C.grid};">${sevBadge(
          v.label,
          sev,
          true,
        )}</td>
      </tr>`);
  });

  const notas =
    hasPercent || footnotes.length > 0
      ? `<div style="font-family:${FF};font-size:10px;color:${C.tertiary};margin-top:10px;line-height:1.5;">${
          hasPercent ? "*Margem expressa em % da receita bruta." : ""
        }${footnotes.map((t) => ` *${esc(t)}`).join("")}</div>`
      : "";

  return `${sectionTitle("Desempenho do período vs orçamento")}${panel(
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      <thead><tr>${thCell("Indicador")}${thCell("Orçado", "right")}${thCell(
        "Realizado",
        "right",
      )}${thCell("Variação", "right")}</tr></thead>
      <tbody>${rows.join("")}</tbody>
    </table>${notas}`,
    "14px 16px 12px",
  )}`;
}

function renderKpis(kpis: KpiCard[], columns?: number, title?: string): string {
  if (kpis.length === 0) return "";
  const cells = kpis.map((kpi) => {
    const s = SEV[signToSev(kpi.sign)];
    const arrow = arrowFor(kpi.sign, kpi.variation);
    const suffix = kpi.variationSuffix ? ` ${kpi.variationSuffix}` : "";
    const comp = kpi.omitComparisonSuffix
      ? ""
      : ` vs ${kpi.comparisonLabel ?? "orçamento"}`;
    return panel(
      `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="font-family:${FF};font-size:10px;letter-spacing:0.1em;text-transform:uppercase;font-weight:600;color:${C.sub};line-height:1.3;">${esc(
          kpi.label,
        )}</td>
        <td style="text-align:right;width:26px;"><span style="display:inline-block;width:22px;height:22px;line-height:22px;text-align:center;border-radius:6px;background:${s.bg};color:${s.text};border:1px solid ${s.border};font-size:13px;font-weight:700;">${arrow}</span></td>
      </tr></table>
      <div style="font-family:${FM};font-size:20px;font-weight:600;color:${C.ink};margin:10px 0 6px;">${esc(
        kpi.value,
      )}</div>
      <div style="font-family:${FF};font-size:11px;color:${s.text};font-weight:600;">${esc(
        kpi.variation + suffix,
      )}<span style="color:${C.tertiary};font-weight:500;">${esc(comp)}</span></div>`,
      "14px",
    );
  });
  return `${sectionTitle(title ?? "Saúde financeira & caixa")}${grid(
    cells,
    columns ?? Math.min(kpis.length, 4),
  )}`;
}

function renderHoldingComparativo(block: HoldingComparativoBlock): string {
  const cols: Array<{
    key: keyof HoldingComparativoBlock["empresas"][number];
    label: string;
    kind: "pctMeta" | "pct" | "months";
  }> = [
    { key: "pctMetaAnualVvrAcumulada", label: "% meta anual (acum.)", kind: "pctMeta" },
    { key: "pctMetaVvrMes", label: "% meta do período", kind: "pctMeta" },
    { key: "pctFeeDisponivel", label: "% FEE disp.", kind: "pctMeta" },
    { key: "sobrevivenciaCaixaMeses", label: "Sobrev. caixa", kind: "months" },
    { key: "margemMediaEventos", label: "Margem média", kind: "pct" },
  ];

  // Melhor (verde) e pior (vermelho) por coluna — mesma regra do componente.
  const destaque = cols.map((col) => {
    let best = -1;
    let worst = -1;
    let bestVal = -Infinity;
    let worstVal = Infinity;
    let count = 0;
    block.empresas.forEach((e, i) => {
      const v = e[col.key] as number | null;
      if (v === null || v === undefined) return;
      count += 1;
      if (v > bestVal) {
        bestVal = v;
        best = i;
      }
      if (v < worstVal) {
        worstVal = v;
        worst = i;
      }
    });
    if (count < 2 || bestVal === worstVal) return { best: -1, worst: -1 };
    return { best, worst };
  });

  const fmt = (v: number | null, kind: "pctMeta" | "pct" | "months"): string => {
    if (v === null || v === undefined) return "—";
    if (kind === "pctMeta") return fmtPctMeta(v);
    if (kind === "pct") return fmtPctPtBr(v);
    return `${v} ${v === 1 ? "mês" : "meses"}`;
  };

  const head = `<tr>${thCell("Empresa", "left", "20%")}${cols
    .map((c) => thCell(c.label, "right"))
    .join("")}</tr>`;

  const rows = block.empresas
    .map((e, rowIdx) => {
      const tds = cols
        .map((c, colIdx) => {
          const v = e[c.key] as number | null;
          const { best, worst } = destaque[colIdx];
          const tone =
            rowIdx === best ? SEV.positive : rowIdx === worst ? SEV.critical : null;
          return `<td style="font-family:${FM};font-size:10.5px;color:${
            tone ? tone.text : C.body
          };${tone ? `background:${tone.bg};font-weight:700;` : ""}padding:6px 8px;text-align:right;white-space:nowrap;border-bottom:1px solid ${C.grid};">${esc(
            fmt(v, c.kind),
          )}</td>`;
        })
        .join("");
      return `<tr><td style="font-family:${FF};font-size:10.5px;font-weight:600;color:${C.ink};padding:6px 8px;border-bottom:1px solid ${C.grid};">${esc(
        e.empresa,
      )}</td>${tds}</tr>`;
    })
    .join("");

  return `${sectionTitle(block.title)}${caption(
    `Referência ${esc(block.referenciaLabel)} · comparativo das ${
      block.empresas.length
    } empresas do grupo · <span style="color:${SEV.positive.text};">&#9632;</span> melhor · <span style="color:${SEV.critical.text};">&#9632;</span> pior`,
  )}${panel(
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><thead>${head}</thead><tbody>${rows}</tbody></table>`,
    "14px 16px 12px",
  )}`;
}

function renderMutuos(block: MutuosBlock): string {
  if (block.rows.length === 0) return "";

  if (block.scope === "company") {
    const row = block.rows[0];
    const cards = [
      indicatorCard(
        "Valor do principal",
        row.principal === null ? "—" : fmtMoneyFull(row.principal),
        { hint: "Mútuo em aberto · valor informado" },
      ),
      indicatorCard(
        "Valor amortizado",
        row.amortizado === null ? "—" : fmtMoneyFull(row.amortizado),
        { hint: "Mútuo em aberto · valor informado" },
      ),
      indicatorCard("Saldo devedor", fmtMoneyFull(row.saldoDevedor), {
        hint: "Mútuo em aberto · valor informado",
      }),
    ];
    return `${sectionTitle(block.title)}${grid(cards, 3)}`;
  }

  const totalPrincipal = block.rows.reduce((acc, r) => acc + (r.principal ?? 0), 0);
  const totalAmortizado = block.rows.reduce((acc, r) => acc + (r.amortizado ?? 0), 0);
  const totalSaldo = block.rows.reduce((acc, r) => acc + r.saldoDevedor, 0);

  const rows = block.rows
    .map(
      (r) => `<tr>
        <td style="font-family:${FF};font-size:10.5px;font-weight:600;color:${C.ink};padding:6px 8px;border-bottom:1px solid ${C.grid};">${esc(
          r.empresa,
        )}</td>
        <td style="font-family:${FM};font-size:10.5px;color:${C.body};padding:6px 8px;text-align:right;white-space:nowrap;border-bottom:1px solid ${C.grid};">${esc(
          r.principal === null ? "—" : fmtMoneyFull(r.principal),
        )}</td>
        <td style="font-family:${FM};font-size:10.5px;color:${C.body};padding:6px 8px;text-align:right;white-space:nowrap;border-bottom:1px solid ${C.grid};">${esc(
          r.amortizado === null ? "—" : fmtMoneyFull(r.amortizado),
        )}</td>
        <td style="font-family:${FM};font-size:10.5px;font-weight:700;color:${C.ink};padding:6px 8px;text-align:right;white-space:nowrap;border-bottom:1px solid ${C.grid};">${esc(
          fmtMoneyFull(r.saldoDevedor),
        )}</td>
      </tr>`,
    )
    .join("");

  const totalRow = `<tr style="background:${C.emphasisBg};">
      <td style="font-family:${FF};font-size:10.5px;font-weight:700;color:${C.ink};padding:6px 8px;">Total</td>
      <td style="font-family:${FM};font-size:10.5px;font-weight:700;color:${C.ink};padding:6px 8px;text-align:right;">${esc(
        fmtMoneyFull(totalPrincipal),
      )}</td>
      <td style="font-family:${FM};font-size:10.5px;font-weight:700;color:${C.ink};padding:6px 8px;text-align:right;">${esc(
        fmtMoneyFull(totalAmortizado),
      )}</td>
      <td style="font-family:${FM};font-size:10.5px;font-weight:700;color:${C.ink};padding:6px 8px;text-align:right;">${esc(
        fmtMoneyFull(totalSaldo),
      )}</td>
    </tr>`;

  return `${sectionTitle(block.title)}${caption(
    `${block.rows.length} ${
      block.rows.length === 1 ? "unidade com mútuo" : "unidades com mútuo"
    } em aberto · unidades sem saldo devedor não são listadas`,
  )}${panel(
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      <thead><tr>${thCell("Unidade", "left", "34%")}${thCell(
        "Valor do principal",
        "right",
      )}${thCell("Valor amortizado", "right")}${thCell("Saldo devedor", "right")}</tr></thead>
      <tbody>${rows}${totalRow}</tbody>
    </table>`,
    "14px 16px 12px",
  )}`;
}

function renderDividendos(
  title: string,
  firstColLabel: string,
  rows: Array<{ label: string; valor: number; pct: number | null }>,
  total: number,
  captionHtml: string,
): string {
  if (rows.length === 0) return "";
  const maxValor = Math.max(...rows.map((r) => Math.abs(r.valor)), 1);
  const body = rows
    .map(
      (r) => `<tr>
      <td style="font-family:${FF};font-size:10.5px;font-weight:600;color:${C.ink};padding:6px 8px;border-bottom:1px solid ${C.grid};">${esc(
        r.label,
      )}</td>
      <td style="padding:6px 8px;border-bottom:1px solid ${C.grid};">${hbar(
        (Math.abs(r.valor) / maxValor) * 100,
        C.accent,
      )}</td>
      <td style="font-family:${FM};font-size:10.5px;color:${C.sub};padding:6px 8px;text-align:right;white-space:nowrap;border-bottom:1px solid ${C.grid};">${esc(
        r.pct === null ? "—" : fmtPctPtBr(r.pct),
      )}</td>
      <td style="font-family:${FM};font-size:10.5px;font-weight:700;color:${C.ink};padding:6px 8px;text-align:right;white-space:nowrap;border-bottom:1px solid ${C.grid};">${esc(
        fmtMoneyFull(r.valor),
      )}</td>
    </tr>`,
    )
    .join("");

  const totalRow = `<tr style="background:${C.emphasisBg};">
      <td style="font-family:${FF};font-size:10.5px;font-weight:700;color:${C.ink};padding:6px 8px;">Total</td>
      <td style="padding:6px 8px;"></td>
      <td style="font-family:${FM};font-size:10.5px;color:${C.sub};padding:6px 8px;text-align:right;">${
        total !== 0 ? "100,0%" : "—"
      }</td>
      <td style="font-family:${FM};font-size:10.5px;font-weight:700;color:${C.ink};padding:6px 8px;text-align:right;">${esc(
        fmtMoneyFull(total),
      )}</td>
    </tr>`;

  return `${sectionTitle(title)}${caption(captionHtml)}${panel(
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      <thead><tr>${thCell(firstColLabel, "left", "32%")}${thCell(
        "Participação",
      )}${thCell("% do total", "right", "16%")}${thCell(
        "Dividendos no período",
        "right",
        "24%",
      )}</tr></thead>
      <tbody>${body}${totalRow}</tbody>
    </table>`,
    "14px 16px 12px",
  )}`;
}

function renderDividendosUnidades(block: DividendosUnidadesBlock): string {
  const n = block.rows.length;
  return renderDividendos(
    block.title,
    "Unidade",
    block.rows.map((r) => ({ label: r.unidade, valor: r.valor, pct: r.pct })),
    block.total,
    `No período de ${esc(block.periodoLabel)}, ${n} ${
      n === 1 ? "unidade distribuiu" : "unidades distribuíram"
    } ${esc(fmtMoneyFull(block.total))} em dividendos para a holding · esta receita de dividendos compõe o resultado do exercício · unidades sem dividendo no período não são listadas`,
  );
}

function renderDividendosSocios(block: DividendosSociosBlock): string {
  return renderDividendos(
    block.title,
    "Sócio",
    block.rows.map((r) => ({ label: r.socio, valor: r.valor, pct: r.pct })),
    block.total,
    `No período de ${esc(block.periodoLabel)}, a holding pagou ${esc(
      fmtMoneyFull(block.total),
    )} em dividendos aos sócios abaixo · sócio sem pagamento no período aparece com valor zerado`,
  );
}

function renderFeatEventos(block: FeatEventosBlock): string {
  const cards = grid(
    [
      indicatorCard("Resultado total previsto", fmtMoneyFull(block.totalPrevisto), {
        meta: `Número de eventos previstos: ${block.eventosPrevistosOrcamento}`,
        footer: `Acumulado até ${block.referenciaLabel}`,
      }),
      indicatorCard("Resultado total realizado", fmtMoneyFull(block.totalRealizado), {
        meta: `Número de eventos realizados: ${block.eventosRealizadosPeriodo}`,
        hint: `${block.eventosRealizados} fechamentos realizado(s) · ${block.eventosEmAberto} fechamentos em aberto`,
        footer: `Acumulado até ${block.referenciaLabel}`,
      }),
    ],
    2,
  );

  // "Resultado dos Eventos" e "Número de Eventos" — barras no lugar do recharts.
  const maxResultado = Math.max(
    1,
    ...block.resultadoPorTipo.map((r) => Math.abs(r.realizado)),
  );
  const resultadoBars = block.resultadoPorTipo
    .map((r) =>
      barRow(
        r.tipo,
        fmtMoneyInt(r.realizado),
        (Math.abs(r.realizado) / maxResultado) * 100,
        C.accent,
        r.realizado < 0 ? SEV.critical.text : C.body,
      ),
    )
    .join("");
  const maxNumero = Math.max(
    1,
    ...block.numeroEventosRealizadosPorTipo.map((n) => n.quantidade),
  );
  const numeroBars = block.numeroEventosRealizadosPorTipo
    .map((n) =>
      barRow(n.tipo, String(n.quantidade), (n.quantidade / maxNumero) * 100, C.accent, C.body),
    )
    .join("");

  const charts = grid(
    [
      panel(
        `<div style="font-family:${FF};font-size:12px;font-weight:700;color:${C.ink};">Resultado dos Eventos</div>
         <div style="font-family:${FF};font-size:10px;color:${C.sub};margin-bottom:10px;">Resultado realizado acumulado por tipo de evento.</div>
         ${resultadoBars || `<div style="font-family:${FF};font-size:11px;color:${C.sub};">Sem eventos no período.</div>`}`,
      ),
      panel(
        `<div style="font-family:${FF};font-size:12px;font-weight:700;color:${C.ink};">Número de Eventos</div>
         <div style="font-family:${FF};font-size:10px;color:${C.sub};margin-bottom:10px;">Eventos com fechamento realizado, por tipo.</div>
         ${numeroBars || `<div style="font-family:${FF};font-size:11px;color:${C.sub};">Sem eventos no período.</div>`}`,
      ),
    ],
    2,
  );

  const temAberto = block.eventosEmAbertoDetalhe.length > 0;
  const listaAberto = temAberto
    ? block.eventosEmAbertoDetalhe
        .map(
          (ev) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.grid};border-radius:6px;background:#fafafa;margin-bottom:6px;"><tr>
            <td style="font-family:${FF};font-size:12.5px;font-weight:600;color:${C.ink};padding:7px 10px;">${esc(
              ev.projeto,
            )}</td>
            <td style="font-family:${FM};font-size:12px;color:${C.body};padding:7px 10px;text-align:right;white-space:nowrap;">${esc(
              fmtMoneyFull(ev.resultadoPrevisto),
            )}</td>
          </tr></table>`,
        )
        .join("")
    : `<div style="font-family:${FF};font-size:12px;color:${C.body};margin-top:6px;">Não há eventos com fechamento em aberto até o período selecionado.</div>`;

  const projecaoRows = temAberto
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:10px;">
        <tr><td style="font-family:${FF};font-size:11.5px;color:${C.body};padding:5px 0;">Previsto em aberto</td><td style="font-family:${FM};font-size:11.5px;color:${C.body};text-align:right;padding:5px 0;">${esc(
          fmtMoneyFull(block.previstoEmAbertoTotal),
        )}</td></tr>
        <tr><td style="font-family:${FF};font-size:11.5px;color:${C.body};padding:5px 0;">Resultado acumulado atual</td><td style="font-family:${FM};font-size:11.5px;color:${C.body};text-align:right;padding:5px 0;">${esc(
          fmtMoneyFull(block.resultadoAcumuladoAtual),
        )}</td></tr>
        <tr><td style="font-family:${FF};font-size:11.5px;font-weight:700;color:${C.ink};padding:5px 0;border-top:1px solid ${C.grid};">Resultado acumulado projetado</td><td style="font-family:${FM};font-size:11.5px;font-weight:700;color:${C.ink};text-align:right;padding:5px 0;border-top:1px solid ${C.grid};">${esc(
          fmtMoneyFull(block.resultadoAcumuladoProjetado),
        )}</td></tr>
        ${
          block.resultadoAcumuladoPrevistoOrcamento !== null
            ? `<tr><td style="font-family:${FF};font-size:11.5px;color:${C.body};padding:5px 0;">Resultado acumulado orçado</td><td style="font-family:${FM};font-size:11.5px;color:${C.body};text-align:right;padding:5px 0;">${esc(
                fmtMoneyFull(block.resultadoAcumuladoPrevistoOrcamento),
              )}</td></tr>`
            : ""
        }
        ${
          block.percentualAtingimentoProjecao !== null
            ? `<tr><td style="font-family:${FF};font-size:11.5px;color:${C.body};padding:5px 0;">Atingimento da projeção</td><td style="font-family:${FM};font-size:11.5px;color:${C.body};text-align:right;padding:5px 0;">${esc(
                fmtPctPtBr(block.percentualAtingimentoProjecao),
              )}</td></tr>`
            : ""
        }
      </table>`
    : "";

  const fechamentos = panel(
    `<div style="font-family:${FF};font-size:12px;font-weight:700;color:${C.ink};">Fechamentos em aberto</div>
     <div style="font-family:${FF};font-size:10px;color:${C.sub};margin-bottom:${
       temAberto ? "10px" : "0"
     };">Eventos realizados sem fechamento concluído até ${esc(block.referenciaLabel)}.</div>
     ${listaAberto}${projecaoRows}`,
  );

  return `${sectionTitle("Eventos — Feat Produções")}${cards}${charts}<div style="height:12px;font-size:0;">&nbsp;</div>${fechamentos}`;
}

function agingSev(faixa: string): SevKey {
  if (faixa === "A vencer") return "neutral";
  if (faixa === "1 a 30 dias" || faixa === "31 a 60 dias") return "attention";
  return "critical";
}

function renderFeatContasReceber(block: FeatContasReceberAbertoBlock): string {
  const resumo = grid(
    [
      indicatorCard("Total em aberto", fmtMoneyFull(block.totalEmAberto), {
        hint: `${block.titulosEmAberto} títulos · ${block.clientesEmAberto} clientes`,
        footer:
          block.permutaEmAberto > 0
            ? `Inclui ${fmtMoneyFull(block.permutaEmAberto)} de Permuta`
            : undefined,
      }),
      indicatorCard("Total em atraso", fmtMoneyFull(block.totalEmAtraso), {
        hint: `${fmtPctPtBr(block.percentualEmAtraso)} do aberto`,
        footer:
          block.permutaEmAtraso > 0
            ? `Inclui ${fmtMoneyFull(block.permutaEmAtraso)} de Permuta`
            : undefined,
        critical: block.totalEmAtraso > 0,
      }),
    ],
    2,
  );

  const maxAging = Math.max(1, ...block.aging.map((b) => b.valor));
  const agingBars = block.aging
    .map((b) =>
      barRow(
        `${b.faixa} · ${b.titulos} título(s)`,
        fmtMoneyFull(b.valor),
        b.valor > 0 ? Math.max(3, (b.valor / maxAging) * 100) : 0,
        SEV[agingSev(b.faixa)].text,
        C.body,
      ),
    )
    .join("");

  const clientesRows = block.clientes
    .map(
      (c) => `<tr>
      <td style="font-family:${FF};font-size:10.5px;color:${C.body};padding:7px 8px;border-bottom:1px solid ${C.grid};">${esc(
        c.cliente,
      )}</td>
      <td style="font-family:${FM};font-size:10.5px;color:${C.body};padding:7px 8px;text-align:right;white-space:nowrap;border-bottom:1px solid ${C.grid};">${esc(
        fmtMoneyFull(c.valorEmAberto),
      )}</td>
      <td style="font-family:${FM};font-size:10.5px;color:${
        c.valorEmAtraso > 0 ? SEV.critical.text : C.sub
      };padding:7px 8px;text-align:right;white-space:nowrap;border-bottom:1px solid ${C.grid};">${esc(
        fmtMoneyFull(c.valorEmAtraso),
      )}</td>
      <td style="font-family:${FM};font-size:10.5px;color:${C.sub};padding:7px 8px;text-align:center;white-space:nowrap;border-bottom:1px solid ${C.grid};">${
        c.diasAtrasoMax > 0 ? `${c.diasAtrasoMax}d` : "—"
      }</td>
    </tr>`,
    )
    .join("");

  const restante =
    block.clientesExibidos < block.clientesTotais
      ? `<div style="font-family:${FF};font-size:10px;color:${C.tertiary};margin-top:8px;">Exibindo ${block.clientesExibidos} de ${block.clientesTotais} clientes · demais somam ${esc(
          fmtMoneyFull(block.restanteValor),
        )}.</div>`
      : "";

  return `${sectionTitle("Contas a receber em aberto — Feat Produções")}${caption(
    "Saldo em aberto dos títulos da Feat na Omie (líquido de recebimentos parciais), filtrado pelos departamentos selecionados e consolidado por cliente e faixa de atraso.",
  )}${resumo}${panel(
    `<div style="font-family:${FF};font-size:12px;font-weight:700;color:${C.ink};margin-bottom:10px;">Faixas de atraso</div>${agingBars}`,
  )}<div style="height:10px;font-size:0;">&nbsp;</div>${panel(
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      <thead><tr>${thCell("Cliente", "left", "40%")}${thCell(
        "Em aberto",
        "right",
        "22%",
      )}${thCell("Em atraso", "right", "22%")}${thCell("Atraso", "center", "16%")}</tr></thead>
      <tbody>${clientesRows}</tbody>
    </table>${restante}`,
    "14px 16px 12px",
  )}`;
}

function renderCustody(block: CustodyClosingBlock): string {
  const cards = [
    indicatorCard("Saldo final — regime de caixa", fmtMoneyFull(block.saldoFinalCaixa), {
      hint: `Referência ${block.referenciaLabel}`,
    }),
    indicatorCard(
      "Saldo final — competência",
      block.saldoFinalCompetencia === null
        ? "—"
        : fmtMoneyFull(block.saldoFinalCompetencia),
      { hint: `Referência ${block.referenciaLabel}` },
    ),
  ];
  return `${sectionTitle("Custódia de Artistas — Saldo Final")}${grid(cards, 2)}`;
}

function renderIndicadoresDre(block: DreIndicatorsBlock): string {
  const cards = block.items.map((item) =>
    indicatorCard(item.label, fmtMoneyFull(item.value), {
      hint: `Realizado · ${block.referenciaLabel}`,
    }),
  );
  return `${sectionTitle(block.title)}${grid(cards, Math.min(block.items.length, 2))}`;
}

function renderPartnerPerformance(block: PartnerPerformance): string {
  const rows = block.partners
    .map(
      (p) => `<tr>
      <td style="font-family:${FF};font-size:13px;font-weight:500;color:${C.body};padding:9px 10px;border-bottom:1px solid ${C.grid};">${esc(
        p.nome,
      )}</td>
      <td style="font-family:${FM};font-size:12.5px;font-weight:600;color:${C.body};padding:9px 10px;text-align:right;white-space:nowrap;border-bottom:1px solid ${C.grid};">${esc(
        fmtMil(p.realizadoMes),
      )}</td>
      <td style="font-family:${FM};font-size:12.5px;color:${C.sub};padding:9px 10px;text-align:right;white-space:nowrap;border-bottom:1px solid ${C.grid};">${esc(
        p.pctMes === null ? "—" : `${fmtNum(p.pctMes, 1)}%`,
      )}</td>
      <td style="font-family:${FM};font-size:12.5px;font-weight:600;color:${C.body};padding:9px 10px;text-align:right;white-space:nowrap;border-bottom:1px solid ${C.grid};">${esc(
        fmtMil(p.realizadoAcum),
      )}</td>
      <td style="font-family:${FM};font-size:12.5px;color:${C.sub};padding:9px 10px;text-align:right;white-space:nowrap;border-bottom:1px solid ${C.grid};">${esc(
        p.pctAcum === null ? "—" : `${fmtNum(p.pctAcum, 1)}%`,
      )}</td>
    </tr>`,
    )
    .join("");

  const total = `<tr style="background:${C.emphasisBg};">
      <td style="font-family:${FF};font-size:13px;font-weight:700;color:${C.ink};padding:9px 10px;border-bottom:1px solid ${C.grid};">${esc(
        block.categoria ? `Total (${block.categoria})` : "Total",
      )}</td>
      <td style="font-family:${FM};font-size:12.5px;font-weight:700;color:${C.ink};padding:9px 10px;text-align:right;border-bottom:1px solid ${C.grid};">${esc(
        fmtMil(block.totalMes),
      )}</td>
      <td style="font-family:${FM};font-size:12.5px;color:${C.sub};padding:9px 10px;text-align:right;border-bottom:1px solid ${C.grid};">${
        block.totalMes !== 0 ? "100,0%" : "—"
      }</td>
      <td style="font-family:${FM};font-size:12.5px;font-weight:700;color:${C.ink};padding:9px 10px;text-align:right;border-bottom:1px solid ${C.grid};">${esc(
        fmtMil(block.totalAcum),
      )}</td>
      <td style="font-family:${FM};font-size:12.5px;color:${C.sub};padding:9px 10px;text-align:right;border-bottom:1px solid ${C.grid};">${
        block.totalAcum !== 0 ? "100,0%" : "—"
      }</td>
    </tr>`;

  return `${sectionTitle(block.title)}${panel(
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      <thead><tr>${thCell("Parceiro")}${thCell("Realizado período", "right")}${thCell(
        "% período",
        "right",
      )}${thCell("Realizado acum.", "right")}${thCell("% acum.", "right")}</tr></thead>
      <tbody>${rows}${total}</tbody>
    </table>
    <div style="font-family:${FF};font-size:10px;color:${C.tertiary};margin-top:10px;line-height:1.5;">Valores em milhares de R$ (mil). Acumulado = janeiro do ano de análise até o fim do período.</div>`,
    "14px 16px 12px",
  )}`;
}

async function renderBreakdown(
  block: BreakdownBlock,
  charts: ChartAssets,
): Promise<string> {
  const max = Math.max(1, ...block.rows.map((r) => Math.abs(r.value)));
  const colorOf = (row: BreakdownBlock["rows"][number]) =>
    row.emphasis ? C.accent : row.value >= 0 ? SEV.positive.text : SEV.critical.text;
  const labelOf = (row: BreakdownBlock["rows"][number]) =>
    `${fmtNum(row.value, 1)} mil${row.pct !== null ? `   ${fmtNum(row.pct, 1)}%` : ""}`;

  const bars = block.rows
    .map((r) =>
      barRow(
        r.label,
        labelOf(r),
        (Math.abs(r.value) / max) * 100,
        colorOf(r),
        r.emphasis ? C.ink : C.body,
      ),
    )
    .join("");

  const chart =
    block.rows.length === 0
      ? bars
      : await charts.image({
          svg: horizontalBarsSvg({
            width: CHART_W_FULL,
            palette: CHART_PALETTE,
            legend: false,
            categories: block.rows.map((r) => ({
              label: r.label,
              bars: [{ value: r.value, color: colorOf(r), label: labelOf(r) }],
            })),
          }),
          width: CHART_W_FULL,
          alt: `${block.title}. ${block.rows
            .map((r) => `${r.label}: ${labelOf(r)}`)
            .join("; ")}`,
          fallback: bars,
        });

  return `${sectionTitle(block.title)}${panel(chart, "14px 16px 6px")}`;
}

async function renderAcumulado(
  items: PrevistoRealizadoItem[],
  charts: ChartAssets,
  width: number,
): Promise<string> {
  const currency = items.filter((i) => i.unidade === "mil");
  const margem = items.find((i) => i.unidade === "%");
  const max = Math.max(
    1,
    ...currency.flatMap((i) => [Math.abs(i.realizado), Math.abs(i.previsto)]),
  );
  const rows = currency
    .map((i) => {
      const acima = i.realizado >= i.previsto;
      return `
      <div style="margin-bottom:12px;">
        <div style="font-family:${FF};font-size:11px;font-weight:600;color:${C.body};margin-bottom:5px;">${esc(
          i.indicador,
        )}</div>
        ${barRow("Orçado", fmtValueWithUnit(i.previsto, "mil"), (Math.abs(i.previsto) / max) * 100, C.previsto, C.sub)}
        ${barRow(
          "Realizado",
          fmtValueWithUnit(i.realizado, "mil"),
          (Math.abs(i.realizado) / max) * 100,
          acima ? SEV.positive.text : SEV.critical.text,
          acima ? SEV.positive.text : SEV.critical.text,
        )}
      </div>`;
    })
    .join("");

  const margemLine = margem
    ? `<div style="font-family:${FF};font-size:11px;color:${C.sub};border-top:1px solid ${C.grid};padding-top:8px;">Margem acumulada: <span style="font-family:${FM};color:${C.body};font-weight:600;">${esc(
        fmtValueWithUnit(margem.realizado, "%"),
      )}</span> · orçado <span style="font-family:${FM};">${esc(
        fmtValueWithUnit(margem.previsto, "%"),
      )}</span></div>`
    : "";

  // Barra na cor neutra da tela (cinza/azul) e o NÚMERO em verde/vermelho —
  // assim o gráfico bate com o do Business Intelligence sem perder o sinal de
  // acima/abaixo do orçado que a versão em tabela dava.
  const chart =
    currency.length === 0
      ? rows
      : await charts.image({
          svg: horizontalBarsSvg({
            width,
            palette: CHART_PALETTE,
            legend: true,
            categories: currency.map((i) => ({
              label: i.indicador,
              bars: [
                {
                  value: i.previsto,
                  color: C.previsto,
                  label: fmtValueWithUnit(i.previsto, "mil"),
                  seriesLabel: "Orçado",
                },
                {
                  value: i.realizado,
                  color: C.accent,
                  label: fmtValueWithUnit(i.realizado, "mil"),
                  seriesLabel: "Realizado",
                  labelColor:
                    i.realizado >= i.previsto ? SEV.positive.text : SEV.critical.text,
                },
              ],
            })),
          }),
          width,
          alt: altFromSeries(
            "Acumulado do ano",
            currency.map((i) => i.indicador),
            [
              { label: "Orçado", values: currency.map((i) => i.previsto) },
              { label: "Realizado", values: currency.map((i) => i.realizado) },
            ],
            (v) => fmtValueWithUnit(v, "mil"),
          ),
          fallback: rows,
        });

  return panel(
    `<div style="font-family:${FF};font-size:12px;font-weight:700;color:${C.ink};">Acumulado do ano</div>
     <div style="font-family:${FF};font-size:10px;color:${C.sub};margin-bottom:10px;">Orçado × Realizado — janeiro até o período de análise.</div>
     ${chart}${margemLine}`,
  );
}

async function renderHistorico(
  data: OnePageReportPreviewData,
  charts: ChartAssets,
  width: number,
): Promise<string> {
  const kLabels = data.historicoKLabels === true;
  const fmtV = (v: number | null) =>
    v === null ? "—" : kLabels ? `${fmtNum(v, 1)}k` : `${fmtNum(v, 1)} mil`;
  const rows = data.historico
    .map(
      (p) => `<tr>
      <td style="font-family:${FF};font-size:11px;color:${C.body};padding:4px 6px;border-bottom:1px solid ${C.grid};">${esc(
        p.mes,
      )}</td>
      <td style="font-family:${FM};font-size:11px;color:${C.sub};text-align:right;padding:4px 6px;border-bottom:1px solid ${C.grid};">${esc(
        fmtV(p.previsto),
      )}</td>
      <td style="font-family:${FM};font-size:11px;color:${C.accent};font-weight:600;text-align:right;padding:4px 6px;border-bottom:1px solid ${C.grid};">${esc(
        fmtV(p.realizado),
      )}</td>
    </tr>`,
    )
    .join("");

  const acum = data.historicoAcum
    ? acumPrevRealFooter(data.historicoAcum, fmtV)
    : "";

  const title = data.historicoTitle ?? "Resultado do Exercício";
  const fallback = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
       <thead><tr>${thCell("Mês")}${thCell("Previsto", "right")}${thCell(
         "Realizado",
         "right",
       )}</tr></thead>
       <tbody>${rows}</tbody>
     </table>`;

  const categories = data.historico.map((p) => p.mes);
  const series: ChartSeries[] = [
    {
      label: "Previsto",
      color: C.previsto,
      values: data.historico.map((p) => p.previsto),
    },
    {
      label: "Realizado",
      color: C.accent,
      values: data.historico.map((p) => p.realizado),
    },
  ];
  const chart =
    data.historico.length === 0
      ? fallback
      : await charts.image({
          svg: lineChartSvg({
            // Altura acompanha a largura: um gráfico de 752px com 186 de altura
            // fica achatado, e é esse o formato quando o "Acumulado do Ano" não
            // está na allowlist da empresa e o histórico ocupa a linha inteira.
            width,
            height: width >= CHART_W_FULL ? 260 : 186,
            categories,
            series,
            palette: CHART_PALETTE,
            format: (v) => fmtNum(v, 1),
          }),
          width,
          alt: altFromSeries(title, categories, series, (v) => fmtV(v)),
          fallback,
        });

  return panel(
    `<div style="font-family:${FF};font-size:12px;font-weight:700;color:${C.ink};">${esc(
      title,
    )}</div>
     <div style="font-family:${FF};font-size:10px;color:${C.sub};margin-bottom:8px;">Previsto × Realizado — últimos meses${
       kLabels ? " (k)" : " (mil)"
     }.</div>
     ${chart}${acum}`,
  );
}

async function renderVvr(
  data: OnePageReportPreviewData,
  charts: ChartAssets,
): Promise<string> {
  const points = data.vvrSerieAnual;
  if (points.length === 0) return "";
  const rows = points
    .map((p) => {
      const acima = (p.realizado ?? 0) >= (p.meta ?? 0);
      return `<tr>
        <td style="font-family:${FF};font-size:11px;color:${C.body};padding:4px 6px;border-bottom:1px solid ${C.grid};">${esc(
          p.mes,
        )}</td>
        <td style="font-family:${FM};font-size:11px;color:${C.metaAmber};text-align:right;padding:4px 6px;border-bottom:1px solid ${C.grid};">${esc(
          p.meta === null ? "—" : `${fmtNum(p.meta, 1)} mil`,
        )}</td>
        <td style="font-family:${FM};font-size:11px;font-weight:600;color:${
          acima ? SEV.positive.text : SEV.critical.text
        };text-align:right;padding:4px 6px;border-bottom:1px solid ${C.grid};">${esc(
          p.realizado === null ? "—" : `${fmtNum(p.realizado, 1)} mil`,
        )}</td>
      </tr>`;
    })
    .join("");

  const acumMeta = points.reduce((s, p) => s + (p.meta ?? 0), 0);
  const acumReal = points.reduce((s, p) => s + (p.realizado ?? 0), 0);
  const acumMax = Math.max(1, acumMeta, acumReal);
  const acima = acumReal >= acumMeta;

  const fallback = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
       <thead><tr>${thCell("Mês")}${thCell("Meta", "right")}${thCell(
         "Realizado",
         "right",
       )}</tr></thead>
       <tbody>${rows}</tbody>
     </table>`;

  const categories = points.map((p) => p.mes);
  const series: ChartSeries[] = [
    {
      label: "Realizado",
      color: C.accent,
      kind: "column",
      values: points.map((p) => p.realizado),
    },
    {
      label: "Meta",
      color: C.metaAmber,
      kind: "line",
      dashed: true,
      values: points.map((p) => p.meta),
    },
  ];
  const chart = await charts.image({
    svg: comboChartSvg({
      width: CHART_W_FULL,
      height: 220,
      categories,
      series,
      palette: CHART_PALETTE,
      format: (v) => fmtNum(v, 1),
    }),
    width: CHART_W_FULL,
    alt: altFromSeries("VVR — meta × realizado", categories, series, (v) =>
      fmtNum(v, 1),
    ),
    fallback,
  });

  return panel(
    `<div style="font-family:${FF};font-size:12px;font-weight:700;color:${C.ink};">VVR — meta × realizado</div>
     <div style="font-family:${FF};font-size:10px;color:${C.sub};margin-bottom:8px;">Série do ano de análise (mil).</div>
     ${chart}
     <div style="height:12px;font-size:0;">&nbsp;</div>
     <div style="font-family:${FF};font-size:11px;font-weight:600;color:${C.body};margin-bottom:6px;">Acumulado do ano</div>
     ${barRow("Meta", `${fmtNum(acumMeta, 1)} mil`, (acumMeta / acumMax) * 100, C.metaAmber, C.body)}
     ${barRow(
       "Realizado",
       `${fmtNum(acumReal, 1)} mil`,
       (acumReal / acumMax) * 100,
       acima ? SEV.positive.text : SEV.critical.text,
       acima ? SEV.positive.text : SEV.critical.text,
     )}`,
  );
}

async function renderBars(
  data: OnePageReportPreviewData,
  charts: ChartAssets,
): Promise<string> {
  const points = data.barsSerie ?? [];
  if (points.length === 0) return "";
  const max = Math.max(1, ...points.map((p) => Math.abs(p.valor ?? 0)));
  const rows = points
    .map((p) =>
      barRow(
        p.mes,
        p.valor === null ? "—" : `${fmtNum(p.valor, 1)} mil`,
        (Math.abs(p.valor ?? 0) / max) * 100,
        (p.valor ?? 0) >= 0 ? SEV.positive.text : SEV.critical.text,
        (p.valor ?? 0) < 0 ? SEV.critical.text : C.body,
      ),
    )
    .join("");
  const acum =
    data.barsAcum !== undefined && data.barsAcum !== null
      ? `<div style="font-family:${FF};font-size:10px;color:${C.sub};border-top:1px solid ${C.grid};padding-top:8px;">Acumulado no ano: <span style="font-family:${FM};color:${C.body};font-weight:600;">${esc(
          `${fmtNum(data.barsAcum, 1)} mil`,
        )}</span></div>`
      : "";
  const title = data.barsTitle ?? "Histórico";
  const categories = points.map((p) => p.mes);
  const values = points.map((p) => p.valor);
  const chart = await charts.image({
    svg: columnsChartSvg({
      width: CHART_W_FULL,
      height: 220,
      categories,
      palette: CHART_PALETTE,
      format: (v) => fmtNum(v, 1),
      legend: false,
      series: [
        {
          label: "Realizado",
          color: SEV.positive.text,
          values,
          // Coluna negativa em vermelho — mesma leitura da versão em barras.
          pointColors: values.map((v) =>
            (v ?? 0) >= 0 ? SEV.positive.text : SEV.critical.text,
          ),
        },
      ],
    }),
    width: CHART_W_FULL,
    alt: altFromSeries(title, categories, [{ label: "Realizado", values }], (v) =>
      fmtNum(v, 1),
    ),
    fallback: rows,
  });

  return panel(
    `<div style="font-family:${FF};font-size:12px;font-weight:700;color:${C.ink};margin-bottom:10px;">${esc(
      title,
    )}</div>${chart}${acum}`,
  );
}

async function renderLines(
  data: OnePageReportPreviewData,
  charts: ChartAssets,
): Promise<string> {
  const points = data.linesSerie ?? [];
  if (points.length === 0) return "";
  const labels = data.linesSeriesLabels ?? [];
  const head = `<tr>${thCell("Mês")}${labels
    .map((l) => thCell(l, "right"))
    .join("")}</tr>`;
  const rows = points
    .map(
      (p) => `<tr>
      <td style="font-family:${FF};font-size:11px;color:${C.body};padding:4px 6px;border-bottom:1px solid ${C.grid};">${esc(
        p.mes,
      )}</td>
      ${p.values
        .map(
          (v) =>
            `<td style="font-family:${FM};font-size:11px;color:${C.body};text-align:right;padding:4px 6px;border-bottom:1px solid ${C.grid};">${esc(
              v === null ? "—" : `${fmtNum(v, 1)} mil`,
            )}</td>`,
        )
        .join("")}
    </tr>`,
    )
    .join("");

  // Mesma sequência de cores do GraficoLinhasMulti da tela — vale para as
  // linhas do gráfico e para as barras do acumulado, que têm de casar.
  const SERIES_COLORS = [C.accent, C.metaAmber, C.previsto];
  const acum =
    data.linesAcum && data.linesAcum.length > 0
      ? acumSeriesFooter(
          data.linesAcum,
          labels,
          SERIES_COLORS,
          data.linesAcumBaseIndex,
          (v) => (v === null ? "—" : `${fmtNum(v, 1)} mil`),
        )
      : "";

  const title = data.linesTitle ?? "Resultado";
  const fallback = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
       <thead>${head}</thead><tbody>${rows}</tbody>
     </table>`;

  const categories = points.map((p) => p.mes);
  const seriesCount = Math.max(labels.length, ...points.map((p) => p.values.length));
  const series: ChartSeries[] = Array.from({ length: seriesCount }, (_, i) => ({
    label: labels[i] ?? `Série ${i + 1}`,
    color: SERIES_COLORS[i % SERIES_COLORS.length],
    values: points.map((p) => p.values[i] ?? null),
  }));

  const chart = await charts.image({
    svg: lineChartSvg({
      width: CHART_W_FULL,
      height: 220,
      categories,
      series,
      palette: CHART_PALETTE,
      format: (v) => fmtNum(v, 1),
      // Com 3 séries os rótulos por ponto colidem; a legenda + eixo bastam.
      valueLabels: seriesCount === 1,
    }),
    width: CHART_W_FULL,
    alt: altFromSeries(title, categories, series, (v) => fmtNum(v, 1)),
    fallback,
  });

  return panel(
    `<div style="font-family:${FF};font-size:12px;font-weight:700;color:${C.ink};margin-bottom:8px;">${esc(
      title,
    )}</div>
     ${chart}${acum}`,
  );
}

async function renderPrevRealChart(
  chart: PrevRealChart,
  charts: ChartAssets,
): Promise<string> {
  const rows = chart.serie
    .map(
      (p) => `<tr>
      <td style="font-family:${FF};font-size:11px;color:${C.body};padding:4px 6px;border-bottom:1px solid ${C.grid};">${esc(
        p.mes,
      )}</td>
      <td style="font-family:${FM};font-size:11px;color:${C.sub};text-align:right;padding:4px 6px;border-bottom:1px solid ${C.grid};">${esc(
        fmtMil(p.previsto),
      )}</td>
      <td style="font-family:${FM};font-size:11px;color:${C.accent};font-weight:600;text-align:right;padding:4px 6px;border-bottom:1px solid ${C.grid};">${esc(
        fmtMil(p.realizado),
      )}</td>
    </tr>`,
    )
    .join("");

  // A variação % vs previsto agora sai dentro do próprio `acumPrevRealFooter`
  // (ao lado do valor realizado), igual à tela — não é mais um badge solto.
  const fallback = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
       <thead><tr>${thCell("Mês")}${thCell("Previsto", "right")}${thCell(
         "Realizado",
         "right",
       )}</tr></thead>
       <tbody>${rows}</tbody>
     </table>`;

  const categories = chart.serie.map((p) => p.mes);
  const series: ChartSeries[] = [
    {
      label: "Previsto",
      color: C.previsto,
      values: chart.serie.map((p) => p.previsto),
    },
    {
      label: "Realizado",
      color: C.accent,
      values: chart.serie.map((p) => p.realizado),
    },
  ];
  const chartImg =
    chart.serie.length === 0
      ? fallback
      : await charts.image({
          svg: columnsChartSvg({
            width: CHART_W_HALF,
            height: 186,
            categories,
            series,
            palette: CHART_PALETTE,
            format: (v) => fmtNum(v, 1),
          }),
          width: CHART_W_HALF,
          alt: altFromSeries(chart.title, categories, series, (v) => fmtNum(v, 1)),
          fallback,
        });

  return panel(
    `<div style="font-family:${FF};font-size:12px;font-weight:700;color:${C.ink};margin-bottom:8px;">${esc(
      chart.title,
    )}</div>
     ${chartImg}
     ${acumPrevRealFooter(
       { previsto: chart.previstoAcum, realizado: chart.realizadoAcum },
       fmtMil,
     )}`,
  );
}

function renderConsolidated(block: Consolidated): string {
  const rows = block.rows
    .map((r) => {
      const emph = !!r.emphasis;
      let varLabel = "—";
      let varSev: SevKey = "neutral";
      if (r.previsto !== null && r.previsto !== 0 && r.realizado !== null) {
        const pct = ((r.realizado - r.previsto) / Math.abs(r.previsto)) * 100;
        varLabel = `${pct >= 0 ? "+" : ""}${fmtNum(pct, 1)}%`;
        varSev = pct >= 0 ? "positive" : pct < -10 ? "critical" : "attention";
      }
      const realNeg = r.realizado !== null && r.realizado < 0;
      return `<tr style="background:${emph ? C.emphasisBg : "transparent"};">
        <td style="font-family:${FF};font-size:13px;font-weight:${
          emph ? 700 : 500
        };color:${emph ? C.ink : C.body};padding:9px 10px;border-bottom:1px solid ${C.grid};">${esc(
          r.label,
        )}</td>
        <td style="font-family:${FM};font-size:12.5px;color:${C.sub};padding:9px 10px;text-align:right;border-bottom:1px solid ${C.grid};white-space:nowrap;">${esc(
          fmtMil(r.previsto),
        )}</td>
        <td style="font-family:${FM};font-size:12.5px;font-weight:${
          emph ? 700 : 600
        };color:${realNeg ? SEV.critical.text : emph ? C.ink : C.body};padding:9px 10px;text-align:right;border-bottom:1px solid ${C.grid};white-space:nowrap;">${esc(
          fmtMil(r.realizado),
        )}</td>
        <td style="padding:9px 10px;text-align:right;border-bottom:1px solid ${C.grid};">${sevBadge(
          varLabel,
          varSev,
          true,
        )}</td>
      </tr>`;
    })
    .join("");

  const acum = block.acum ? acumPrevRealFooter(block.acum, fmtMil) : "";

  return `${sectionTitle(block.title)}${panel(
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      <thead><tr>${thCell("Indicador")}${thCell("Orçado", "right")}${thCell(
        "Realizado",
        "right",
      )}${thCell("Variação", "right")}</tr></thead>
      <tbody>${rows}</tbody>
    </table>${acum}`,
    "14px 16px 12px",
  )}`;
}

// Quadro isolado (departamento + categorias) — Receitas/Despesas/Resultado em
// duas colunas (período e acumulado do ano). Espelha IsolatedResultBlock da tela.
function renderIsolatedResult(block: IsolatedResult): string {
  const linhas: Array<{ label: string; periodo: number; acumulado: number; emphasis?: boolean }> = [
    { label: "Receitas", periodo: block.periodo.receitas, acumulado: block.acumulado.receitas },
    { label: "Despesas", periodo: block.periodo.despesas, acumulado: block.acumulado.despesas },
    { label: "Resultado", periodo: block.periodo.resultado, acumulado: block.acumulado.resultado, emphasis: true },
  ];
  const rows = linhas
    .map((r) => {
      const emph = !!r.emphasis;
      const negP = r.periodo < 0;
      const negA = r.acumulado < 0;
      return `<tr style="background:${emph ? C.emphasisBg : "transparent"};">
        <td style="font-family:${FF};font-size:13px;font-weight:${
          emph ? 700 : 500
        };color:${emph ? C.ink : C.body};padding:9px 10px;border-bottom:1px solid ${C.grid};">${esc(
          r.label,
        )}</td>
        <td style="font-family:${FM};font-size:12.5px;font-weight:${
          emph ? 700 : 600
        };color:${negP ? SEV.critical.text : emph ? C.ink : C.body};padding:9px 10px;text-align:right;border-bottom:1px solid ${C.grid};white-space:nowrap;">${esc(
          fmtMil(r.periodo),
        )}</td>
        <td style="font-family:${FM};font-size:12.5px;font-weight:${
          emph ? 700 : 600
        };color:${negA ? SEV.critical.text : emph ? C.ink : C.body};padding:9px 10px;text-align:right;border-bottom:1px solid ${C.grid};white-space:nowrap;">${esc(
          fmtMil(r.acumulado),
        )}</td>
      </tr>`;
    })
    .join("");

  const nota = `<div style="font-family:${FF};font-size:10px;color:${C.sub};margin-top:10px;">Valores em milhares de R$ (mil). Recorte isolado (departamento + categorias), deduplicado por lançamento.</div>`;

  return `${sectionTitle(block.title)}${panel(
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      <thead><tr>${thCell("Indicador")}${thCell("Período", "right")}${thCell(
        "Acumulado no ano",
        "right",
      )}</tr></thead>
      <tbody>${rows}</tbody>
    </table>${nota}`,
    "14px 16px 12px",
  )}`;
}

function renderAlertas(items: AlertaCard[]): string {
  if (items.length === 0) return "";
  const cells = items.map((a) => {
    const sev = signToSev(a.classificacao);
    const s = SEV[sev];
    const icon =
      sev === "critical" ? "&#9650;" : sev === "positive" ? "&#10003;" : "!";
    const label =
      sev === "critical"
        ? "Crítico"
        : sev === "positive"
          ? "Positivo"
          : sev === "attention"
            ? "Atenção"
            : "Neutro";
    return `<div style="background:${s.bg};border:1px solid ${s.border};border-radius:8px;padding:14px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td><span style="display:inline-block;width:22px;height:22px;line-height:22px;text-align:center;border-radius:6px;background:#ffffff;border:1px solid ${s.border};color:${s.text};font-size:12px;font-weight:700;">${icon}</span></td>
        <td style="text-align:right;">${sevBadge(label, sev)}</td>
      </tr></table>
      <div style="font-family:${FF};font-size:13px;font-weight:700;color:${C.ink};margin:8px 0 4px;">${esc(
        a.titulo,
      )}</div>
      <div style="font-family:${FF};font-size:11px;line-height:1.5;color:${C.body};">${esc(
        a.texto,
      )}</div>
    </div>`;
  });
  return `${sectionTitle("Alertas")}${grid(cells, Math.min(items.length, 3), 10)}`;
}

function renderAcoes(items: OnePageReportPreviewData["acoes"]): string {
  if (items.length === 0) return "";
  const impactoSev: Record<string, SevKey> = {
    Alto: "critical",
    "Médio": "attention",
    Baixo: "neutral",
  };
  const urgenciaSev: Record<string, SevKey> = {
    Alta: "critical",
    "Média": "attention",
    Baixa: "neutral",
  };
  const cells = items.map((a) =>
    panel(
      `<div style="font-family:${FF};font-size:9px;letter-spacing:0.12em;text-transform:uppercase;font-weight:700;color:${C.tertiary};margin-bottom:6px;">Ação Recomendada</div>
       <div style="font-family:${FF};font-size:13px;font-weight:600;line-height:1.4;color:${C.ink};margin-bottom:8px;">${esc(
         a.acao,
       )}</div>
       <div style="margin-bottom:8px;">${sevBadge(
         `Impacto: ${a.impacto}`,
         impactoSev[a.impacto] ?? "neutral",
       )} ${sevBadge(`Urgência: ${a.urgencia}`, urgenciaSev[a.urgencia] ?? "neutral")}</div>
       <div style="font-family:${FF};font-size:11px;color:${C.sub};">Área: <span style="font-weight:600;color:${C.body};">${esc(
         a.area,
       )}</span></div>`,
      "14px",
    ),
  );
  return `${sectionTitle("Ações Recomendadas")}${grid(cells, 2)}`;
}

// ─── Render principal ───────────────────────────────────────────────────────

export interface OnePageEmailResult {
  html: string;
  /**
   * Imagens dos gráficos, referenciadas no HTML por `cid:`. Quem envia TEM de
   * repassar ao Resend — sem isso o leitor recebe imagem quebrada.
   */
  attachments: OnePageEmailAttachment[];
}

export async function renderOnePageEmail({
  data,
  appUrl,
}: OnePageEmailArgs): Promise<OnePageEmailResult> {
  const charts = new ChartAssets();

  // Mesmíssima função de visibilidade do componente: sem `blocks`, mostra
  // tudo; com `blocks`, só os listados.
  const show = (block: string) => !data.blocks || data.blocks.includes(block);
  const showSemaforo = show("semaforo");
  const showVvr = show("vvrSerie");
  const showHistorico = show("historico");
  const showAcumulado = show("acumuladoAno");
  const showTendencia = showVvr || showHistorico;

  // KPIs de saúde/caixa = todos exceto os 4 operacionais (que alimentam a
  // tabela e o resumo). Mesma regra do componente.
  const operacionais = new Set(["receita", "despesas", "resultado", "margem"]);
  const saudeKpis = data.kpis.filter((k) => !operacionais.has(k.label.toLowerCase()));

  const parts: string[] = [];

  parts.push(renderHeader(data.cabecalho));
  if (show("diagnostico")) parts.push(renderResumo(data, showSemaforo));

  if (data.holdingComparativo && show(data.holdingComparativo.key)) {
    parts.push(renderHoldingComparativo(data.holdingComparativo));
  }
  if (data.mutuos && data.mutuos.scope === "holding" && show(data.mutuos.key)) {
    parts.push(renderMutuos(data.mutuos));
  }
  if (show("previstoRealizado")) {
    parts.push(renderTabelaDesempenho(data, showSemaforo));
  }
  if (data.dividendosUnidades && show(data.dividendosUnidades.key)) {
    parts.push(renderDividendosUnidades(data.dividendosUnidades));
  }
  if (data.dividendosSocios && show(data.dividendosSocios.key)) {
    parts.push(renderDividendosSocios(data.dividendosSocios));
  }
  parts.push(renderKpis(saudeKpis, data.kpiColumns, data.kpiSectionTitle));

  if (data.mutuos && data.mutuos.scope === "company" && show(data.mutuos.key)) {
    parts.push(renderMutuos(data.mutuos));
  }
  if (show("featEventos") && data.featEventos) {
    parts.push(renderFeatEventos(data.featEventos));
  }
  if (show("featEventos") && data.featContasReceberAberto) {
    parts.push(renderFeatContasReceber(data.featContasReceberAberto));
  }
  if (show("custodyClosing") && data.custodyClosing) {
    parts.push(renderCustody(data.custodyClosing));
  }
  if (data.indicadoresDre && show(data.indicadoresDre.key)) {
    parts.push(renderIndicadoresDre(data.indicadoresDre));
  }
  if (show("performancePorParceiro") && data.partnerPerformance) {
    parts.push(renderPartnerPerformance(data.partnerPerformance));
  }
  for (const block of data.breakdownBlocks ?? []) {
    if (show(block.key)) parts.push(await renderBreakdown(block, charts));
  }

  // Tendência & Acumulado — acumulado + histórico lado a lado; VVR abaixo.
  if (showAcumulado || showTendencia) {
    // Os dois painéis dividem a linha SÓ quando ambos aparecem. Com um só (é o
    // caso de quem não tem "acumuladoAno" na allowlist, ex.: Salvaterra Mall),
    // ele ocupa a linha inteira — e a imagem precisa nascer nessa largura,
    // senão fica um gráfico pequeno perdido num painel largo.
    const sideBySide = showAcumulado && showHistorico;
    const chartWidth = sideBySide ? CHART_W_HALF : CHART_W_FULL;
    const cols: string[] = [];
    if (showAcumulado) {
      cols.push(await renderAcumulado(data.acumuladoAno, charts, chartWidth));
    }
    if (showHistorico) cols.push(await renderHistorico(data, charts, chartWidth));
    const topo = cols.length > 0 ? grid(cols, cols.length) : "";
    const vvr = showVvr ? await renderVvr(data, charts) : "";
    parts.push(`${sectionTitle("Tendência & Acumulado")}${topo}${vvr}`);
  }

  if (data.barsSerie || data.linesSerie) {
    const cards = [
      await renderBars(data, charts),
      await renderLines(data, charts),
    ].filter(Boolean);
    parts.push(`${sectionTitle("Evolução")}${cards.join('<div style="height:12px;font-size:0;">&nbsp;</div>')}`);
  }

  if (data.prevRealCharts && data.prevRealCharts.length > 0) {
    const cards = await Promise.all(
      data.prevRealCharts.map((c) => renderPrevRealChart(c, charts)),
    );
    parts.push(`${sectionTitle("Previsto × Realizado por frente")}${grid(cards, 2)}`);
  }

  if (data.consolidated) parts.push(renderConsolidated(data.consolidated));
  if (data.isolatedResult) parts.push(renderIsolatedResult(data.isolatedResult));
  if (show("alertas")) parts.push(renderAlertas(data.alertas));
  if (show("acoes")) parts.push(renderAcoes(data.acoes));

  const ctaUrl = appUrl
    ? `${appUrl.replace(/\/$/, "")}/financeiro/business-intelligence`
    : null;
  const cta = ctaUrl
    ? `<div style="text-align:center;margin:24px 0 4px;">
        <a href="${ctaUrl}" style="display:inline-block;background:${C.darkCard};color:#ffffff;font-family:${FF};font-size:13px;font-weight:600;padding:11px 26px;border-radius:8px;text-decoration:none;">Ver relatório completo no Control Hub</a>
      </div>`
    : "";

  const footer = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${C.rule};margin-top:18px;padding-top:14px;">
      <tr>
        <td style="font-family:${FF};font-size:11px;color:${C.tertiary};">${esc(
          data.cabecalho.empresa,
        )}</td>
        <td style="font-family:${FF};font-size:11px;color:${C.tertiary};text-align:right;">${esc(
          data.cabecalho.periodo,
        )}</td>
      </tr>
    </table>
    <div style="font-family:${FF};font-size:10px;color:${C.tertiary};margin-top:12px;line-height:1.5;">
      Relatório gerado pelo Control Hub com apoio de IA e validado antes do envio. Os números vêm do DRE realizado e orçado da unidade.
    </div>`;

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Relatório Financeiro — ${esc(data.cabecalho.empresa)} — ${esc(
    data.cabecalho.periodo,
  )}</title>
</head>
<body style="margin:0;padding:0;background:${C.pageBg};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.pageBg};padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="880" cellpadding="0" cellspacing="0" style="background:${C.cardBg};border:1px solid ${C.cardBorder};border-radius:7px;padding:34px 38px 32px;max-width:880px;width:100%;">
        <tr><td>
          ${parts.filter(Boolean).join("")}
          ${cta}
          ${footer}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { html, attachments: charts.list() };
}
