"use client";

import type { CSSProperties } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { downloadFeatContasReceberXlsx } from "@/lib/financeiro/relatorios/feat-contas-receber-export";

// ============================================================================
// RELATÓRIO FINANCEIRO MENSAL — One Page Report (documento A4).
//
// Reescrita visual seguindo o sistema de design Claude ("Relatório Viva Juiz
// de Fora v2"): documento de página única (largura de conteúdo ~840px),
// tipografia IBM Plex Sans/Mono, paleta semântica âmbar/verde/vermelho/neutro,
// títulos de seção com régua, cards de período (escuro) / status / nota.
//
// IMPORTANTE: o SHAPE de dados (OnePageReportPreviewData) é mantido idêntico
// ao anterior — o pipeline API → mapper → preview → export PDF continua
// funcionando sem alteração. Mudou apenas a camada de apresentação.
//
// Tudo é data-driven; nenhum número fixo no markup (o MOCK_DATA serve só de
// fallback/preview de layout). As cores são aplicadas inline (hex exato do
// design) para garantir fidelidade e captura correta no html2canvas/print.
// ============================================================================

// ─── Tipos (inalterados — consumidos pelo one-page-report-mapper) ──────────

type StatusGeral = "Excelente" | "Boa" | "Atenção" | "Crítica";
type ImpactSign = "Positivo" | "Atenção" | "Neutro" | "Crítico";

export interface KpiCard {
  label: string;
  value: string;
  variation: string;
  sign: ImpactSign;
  variationSuffix?: string;
  omitComparisonSuffix?: boolean;
  comparisonLabel?: string;
}

export interface PrevistoRealizadoItem {
  indicador: string;
  realizado: number;
  previsto: number;
  unidade: "mil" | "%";
  /** Subtítulo do subgrupo (tabela agrupada, ex.: Village). Ausência = sem grupo. */
  group?: string;
  /** Nota de rodapé da linha (marca com "*" e exibe o texto sob a tabela). */
  footnote?: string;
}

export interface ComposicaoStep {
  label: string;
  valueLabel: string;
  kind: "entrada" | "saida" | "final";
}

export interface HistoricoPoint {
  mes: string;
  previsto: number | null;
  realizado: number | null;
}

export interface VvrSerieAnualPoint {
  mes: string;
  realizado: number | null;
  meta: number | null;
}

export interface AlertaCard {
  titulo: string;
  texto: string;
  classificacao: ImpactSign;
}

export interface SemaforoItem {
  indicador: string;
  classificacao: ImpactSign;
}

export interface AcaoCard {
  acao: string;
  impacto: "Alto" | "Médio" | "Baixo";
  urgencia: "Alta" | "Média" | "Baixa";
  area: string;
}

// Quadro de eventos EXCLUSIVO da Feat Produções (alimentado por
// company_feat_projetos). Valores em R$ cheios (não em "mil"). Só presente
// quando a empresa analisada é a Feat Produções.
export interface FeatEventosBlock {
  referenciaLabel: string;
  totalPrevisto: number;
  totalRealizado: number;
  resultadoPorTipo: Array<{ tipo: string; previsto: number; realizado: number }>;
  numeroEventosRealizadosPorTipo: Array<{ tipo: string; quantidade: number }>;
  eventosPrevistosOrcamento: number;
  eventosRealizadosPeriodo: number;
  eventosEmAberto: number;
  eventosNaoRealizados: number;
  eventosRealizados: number;
  // Bloco "Fechamentos em aberto": lista (nome + resultado previsto), soma do
  // previsto em aberto e projeção gerencial. A base é o Resultado do Exercício
  // acumulado do DRE (resultadoAcumuladoAtual), não a soma do realizado dos
  // eventos — projeção = resultadoAcumuladoAtual + previstoEmAbertoTotal.
  eventosEmAbertoDetalhe: Array<{ projeto: string; resultadoPrevisto: number }>;
  previstoEmAbertoTotal: number;
  resultadoAcumuladoAtual: number;
  resultadoAcumuladoProjetado: number;
  // Resultado acumulado orçado (Acumulado do Ano) + % de atingimento da projeção.
  resultadoAcumuladoPrevistoOrcamento: number | null;
  percentualAtingimentoProjecao: number | null;
}

export interface FeatAgingBucket {
  faixa: string;
  valor: number;
  titulos: number;
}

export interface FeatClienteReceberAberto {
  cliente: string;
  valorEmAberto: number;
  valorEmAtraso: number;
  diasAtrasoMax: number;
  titulos: number;
  titulosEmAtraso: number;
}

export interface FeatContaReceberDetalhe {
  cliente: string;
  projeto: string;
  categoria: string;
  dataVencimento: string | null;
  dataPrevisao: string | null;
  status: "Em atraso" | "A vencer";
  diasAtraso: number;
  valorEmAberto: number;
}

export interface FeatContasReceberAbertoBlock {
  referenciaLabel: string;
  totalEmAberto: number;
  totalEmAtraso: number;
  percentualEmAtraso: number;
  titulosEmAberto: number;
  titulosEmAtraso: number;
  clientesEmAberto: number;
  clientesEmAtraso: number;
  aging: FeatAgingBucket[];
  clientes: FeatClienteReceberAberto[];
  clientesExibidos: number;
  clientesTotais: number;
  restanteValor: number;
  detalhes: FeatContaReceberDetalhe[];
}

// Saldo final da "Custódia de Artistas" da Case Shows (regime de caixa +
// competência), no mês de referência do relatório. Valores em R$ cheios. Só
// presente quando a empresa analisada é a Case Shows.
export interface CustodyClosingBlock {
  referenciaLabel: string;
  saldoFinalCaixa: number;
  saldoFinalCompetencia: number | null;
}

// Quadro de indicadores por conta DRE (ex.: Terrazzo — "Locação de Espaço":
// Formaturas / Shows-Palestras), no mês de referência. Valores em R$ cheios.
// Só presente quando o template da empresa configura `report.indicadoresDre`.
export interface DreIndicatorsBlock {
  /** ReportBlockKey p/ gating (ex.: "locacaoEspaco"). */
  key: string;
  title: string;
  referenciaLabel: string;
  items: Array<{ label: string; value: number }>;
}

// Comparativo das empresas de uma holding (Hero Holding). Uma linha por unidade
// Viva do grupo; valores null quando o indicador não existe para a empresa.
// Só presente quando o template configura `report.holdingComparativo`.
export interface HoldingComparativoRow {
  empresa: string;
  /** % de atingimento acumulado da meta de VVR (Jan→mês de referência). */
  pctMetaAnualVvrAcumulada: number | null;
  /** % de atingimento da meta de VVR do mês de referência. */
  pctMetaVvrMes: number | null;
  /** % de FEE disponível = FEE disponível ÷ FEE a receber. */
  pctFeeDisponivel: number | null;
  sobrevivenciaCaixaMeses: number | null;
  margemMediaEventos: number | null;
  inadimplenciaAtual: number | null;
}
export interface HoldingComparativoBlock {
  /** ReportBlockKey p/ gating ("holdingComparativo"). */
  key: string;
  title: string;
  referenciaLabel: string;
  empresas: HoldingComparativoRow[];
}

export interface OnePageReportPreviewData {
  cabecalho: {
    empresa: string;
    periodo: string;
    geradoEm: string;
    statusGeral: StatusGeral;
    notaGeral: number;
  };
  kpis: KpiCard[];
  previstoRealizado: PrevistoRealizadoItem[];
  composicao: ComposicaoStep[];
  historico: HistoricoPoint[];
  acumuladoAno: PrevistoRealizadoItem[];
  vvrSerieAnual: VvrSerieAnualPoint[];
  alertas: AlertaCard[];
  semaforo: SemaforoItem[];
  diagnosticoPrincipal: string;
  acoes: AcaoCard[];
  // ── Extensões por template (Fase 2) ───────────────────────────────────────
  // Ausência de todas = comportamento Franquias Viva (mostra todos os blocos,
  // títulos e grade padrão). Preenchidas por templates com `report` (ex.: SGX).
  /** Allowlist de blocos visíveis. Ausência = TODOS os blocos. */
  blocks?: string[];
  /** Título do gráfico de histórico. Ausência = "Resultado do Exercício". */
  historicoTitle?: string;
  /** Rótulos do histórico em "Xk" (milhar). Ausência = número cheio (Viva). */
  historicoKLabels?: boolean;
  /** Nº de colunas da grade de KPIs. Ausência = min(qtd de cards, 4). */
  kpiColumns?: number;
  /** Título da seção de KPIs. Ausência = "Saúde financeira & caixa". */
  kpiSectionTitle?: string;
  /** Quadro de eventos exclusivo da Feat Produções. Ausência = não renderiza. */
  featEventos?: FeatEventosBlock;
  /** Contas a receber em aberto da Omie — exclusivo da Feat Producoes. */
  featContasReceberAberto?: FeatContasReceberAbertoBlock;
  /** Saldo final da Custódia de Artistas (Case Shows). Ausência = não renderiza. */
  custodyClosing?: CustodyClosingBlock;
  /** Indicadores por conta DRE (Terrazzo — "Locação de Espaço"). Ausência = não renderiza. */
  indicadoresDre?: DreIndicatorsBlock;
  /** Comparativo das empresas da holding (Hero Holding). Ausência = não renderiza. */
  holdingComparativo?: HoldingComparativoBlock;
  // ── Gráficos extras por template (ex.: Village) ────────────────────────────
  /** Colunas verticais — acumulado do ano, só realizado (ex.: Gap por mês). */
  barsSerie?: BarPoint[];
  barsTitle?: string;
  /** Acumulado do ano do gráfico de colunas (ex.: Gap total Jan→análise). */
  barsAcum?: number | null;
  /** Linhas (6 meses) com N séries (ex.: Resultado Final realizado/ajustado/orçado). */
  linesSerie?: MultiLinePoint[];
  linesSeriesLabels?: string[];
  linesTitle?: string;
  /** Acumulado do ano por série (3 barras horizontais sob as linhas). */
  linesAcum?: (number | null)[];
  /** Índice da série orçada — baseline da variação % das demais barras. */
  linesAcumBaseIndex?: number;
  /** Gráficos de colunas Previsto × Realizado mensais (ex.: SGX Locações/Projetos). */
  prevRealCharts?: PrevRealChart[];
  /** Bloco consolidado do grupo (ex.: Salvaterra) — Previsto × Realizado. */
  consolidated?: Consolidated;
  /** Acumulado do ano (Jan→análise) do gráfico de histórico — rodapé. */
  historicoAcum?: { previsto: number | null; realizado: number | null };
  /** Bloco "Performance por Parceiro — Mês e Acumulado" (ex.: Young Med). */
  partnerPerformance?: PartnerPerformance;
  /** Blocos de breakdown em barras (ex.: Spot — composição da receita, frete). */
  breakdownBlocks?: BreakdownBlock[];
}

export interface BreakdownBlock {
  /** ReportBlockKey p/ gating (ex.: "composicaoReceita", "freteLogistica"). */
  key: string;
  title: string;
  rows: Array<{ label: string; value: number; pct: number | null; emphasis: boolean }>;
}

export interface PartnerPerformance {
  title: string;
  categoria: string | null;
  partners: Array<{
    nome: string;
    realizadoMes: number;
    pctMes: number | null;
    realizadoAcum: number;
    pctAcum: number | null;
  }>;
  totalMes: number;
  totalAcum: number;
}

export interface ConsolidatedRow {
  label: string;
  previsto: number | null;
  realizado: number | null;
  emphasis?: boolean;
}
export interface Consolidated {
  title: string;
  rows: ConsolidatedRow[];
  /** Acumulado do ano (Jan→análise) do consolidado — rodapé. */
  acum?: { previsto: number | null; realizado: number | null };
}

export interface PrevRealPoint {
  mes: string;
  previsto: number | null;
  realizado: number | null;
}

export interface PrevRealChart {
  title: string;
  serie: PrevRealPoint[];
  previstoAcum: number | null;
  realizadoAcum: number | null;
}

export interface BarPoint {
  mes: string;
  valor: number | null;
}

export interface MultiLinePoint {
  mes: string;
  /** Alinha por índice com `linesSeriesLabels`. */
  values: (number | null)[];
}

// ─── Sistema visual ─────────────────────────────────────────────────────────

// Fontes (variaveis injetadas em layout.tsx via next/font).
const FONT_SANS = 'var(--font-plex-sans), "IBM Plex Sans", system-ui, sans-serif';
const FONT_MONO = 'var(--font-plex-mono), "IBM Plex Mono", ui-monospace, monospace';

// Paleta base do documento.
const C = {
  pageBg: "#eceae6",
  cardBg: "#ffffff",
  cardBorder: "#e6e4df",
  rule: "#ecece7",
  grid: "#f1efea",
  previsto: "#aab0bb",
  metaAmber: "#d9a93a",
  ink: "#16191f", // títulos
  body: "#3c424d", // corpo
  sub: "#717784", // secundário
  tertiary: "#9aa0ac",
  tertiary2: "#a3a8b2",
  darkCard: "#1b2532",
  darkLabel: "#8ba7c9",
} as const;

const DEFAULT_ACCENT = "#1f6fd6";

// Estilo do tooltip dos gráficos (recharts) — coerente com o documento.
const TOOLTIP_CONTENT_STYLE: CSSProperties = {
  fontFamily: FONT_SANS,
  fontSize: 11,
  borderRadius: 8,
  border: `1px solid ${C.cardBorder}`,
  boxShadow: "0 6px 18px rgba(20,25,31,.10)",
};
const TOOLTIP_LABEL_STYLE: CSSProperties = { color: "#16191f", fontWeight: 600 };
const TOOLTIP_ITEM_STYLE: CSSProperties = { fontFamily: FONT_MONO };

// Formata valor do tooltip em "X mil" (ou "—" para ausência).
function milTooltipFormatter(value: unknown): string {
  if (value === null || value === undefined) return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
}

// Paleta semântica (badges, chips, KPIs, alertas).
type SevKey = "critical" | "attention" | "positive" | "neutral";
interface SevStyle {
  text: string;
  bg: string;
  border: string;
}
const SEV: Record<SevKey, SevStyle> = {
  critical: { text: "#c0392b", bg: "#fbecec", border: "#f1d3d3" },
  attention: { text: "#a9701a", bg: "#faf1e1", border: "#eee0bf" },
  positive: { text: "#27824f", bg: "#e7f3ec", border: "#cfe7d8" },
  neutral: { text: "#717784", bg: "#f1f1ee", border: "#e3e2db" },
};

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

// Seta direcional do KPI a partir do sinal + texto da variação.
function arrowFor(sign: ImpactSign, variation: string): "↑" | "↗" | "→" | "↓" {
  if (sign === "Positivo") return "↑";
  if (sign === "Crítico") return "↓";
  if (variation.trim().startsWith("-")) return "↓";
  if (sign === "Atenção") return "↗";
  return "→";
}

// ─── Mock (fallback de preview) ─────────────────────────────────────────────

const MOCK_DATA: OnePageReportPreviewData = {
  cabecalho: {
    empresa: "Viva Petrópolis",
    periodo: "Abril/2026",
    geradoEm: "Gerado em 21/05/2026",
    statusGeral: "Atenção",
    notaGeral: 62,
  },
  kpis: [
    { label: "Receita", value: "118,9 mil", variation: "+8,1%", sign: "Positivo" },
    { label: "Despesas", value: "85,6 mil", variation: "+7,0%", sign: "Atenção" },
    { label: "Resultado", value: "25,9 mil", variation: "+3,8%", sign: "Positivo" },
    { label: "Margem", value: "22,7%", variation: "-0,8", variationSuffix: "p.p.", sign: "Atenção" },
    { label: "FEE disponível", value: "7,0 mil", variation: "Saldo atual", sign: "Neutro", omitComparisonSuffix: true },
    { label: "Sobrevivência de caixa", value: "8 meses", variation: "Cobertura do FEE", sign: "Positivo", omitComparisonSuffix: true },
    { label: "VVR", value: "180 mil", variation: "+9,1%", sign: "Positivo", comparisonLabel: "meta" },
    { label: "Margem média dos eventos", value: "18,0%", variation: "Valor informado", sign: "Positivo", omitComparisonSuffix: true },
  ],
  previstoRealizado: [
    { indicador: "Receita Bruta", realizado: 118.9, previsto: 110.0, unidade: "mil" },
    { indicador: "Custos", realizado: 7.3, previsto: 6.0, unidade: "mil" },
    { indicador: "Despesas", realizado: 85.6, previsto: 80.0, unidade: "mil" },
    { indicador: "Resultado", realizado: 25.9, previsto: 25.0, unidade: "mil" },
    { indicador: "Margem", realizado: 22.7, previsto: 23.5, unidade: "%" },
  ],
  acumuladoAno: [
    { indicador: "Receita", realizado: 432.0, previsto: 410.0, unidade: "mil" },
    { indicador: "Despesas", realizado: 320.5, previsto: 305.0, unidade: "mil" },
    { indicador: "Resultado", realizado: 92.4, previsto: 95.0, unidade: "mil" },
    { indicador: "Margem", realizado: 21.5, previsto: 23.2, unidade: "%" },
  ],
  vvrSerieAnual: [
    { mes: "Jan/26", realizado: 142, meta: 150 },
    { mes: "Fev/26", realizado: 156, meta: 155 },
    { mes: "Mar/26", realizado: 168, meta: 160 },
    { mes: "Abr/26", realizado: 180, meta: 165 },
  ],
  composicao: [
    { label: "Receita Bruta", valueLabel: "118,9 mil", kind: "entrada" },
    { label: "Custos", valueLabel: "-7,3 mil", kind: "saida" },
    { label: "Despesas", valueLabel: "-85,6 mil", kind: "saida" },
    { label: "Resultado", valueLabel: "25,9 mil", kind: "final" },
  ],
  historico: [
    { mes: "Nov/25", previsto: 18, realizado: 17 },
    { mes: "Dez/25", previsto: 20, realizado: 22 },
    { mes: "Jan/26", previsto: 19, realizado: 18 },
    { mes: "Fev/26", previsto: 23, realizado: 21 },
    { mes: "Mar/26", previsto: 24, realizado: 23 },
    { mes: "Abr/26", previsto: 25, realizado: 25.9 },
  ],
  alertas: [
    { titulo: "Despesas acima do orçamento", texto: "Despesas operacionais +7,0% vs previsto pressionam a margem do período.", classificacao: "Atenção" },
    { titulo: "Margem pressionada", texto: "Margem recuou 0,8 p.p. frente ao orçamento e exige monitoramento.", classificacao: "Atenção" },
    { titulo: "Receita acima do orçamento", texto: "Receita bruta superou o previsto em 8,1%, sustentando o resultado.", classificacao: "Positivo" },
  ],
  semaforo: [
    { indicador: "Receita", classificacao: "Positivo" },
    { indicador: "Despesas", classificacao: "Atenção" },
    { indicador: "Resultado", classificacao: "Positivo" },
    { indicador: "Margem", classificacao: "Atenção" },
    { indicador: "FEE disponível", classificacao: "Neutro" },
    { indicador: "VVR", classificacao: "Positivo" },
  ],
  diagnosticoPrincipal:
    "A empresa apresentou crescimento de receita e resultado positivo no período, mas houve pressão na margem devido ao aumento das despesas acima do orçamento.",
  acoes: [
    { acao: "Revisar despesas operacionais e renegociar contratos recorrentes acima do orçado", impacto: "Alto", urgencia: "Alta", area: "Financeiro" },
    { acao: "Monitorar margem nos próximos períodos e estabelecer gatilho de alerta", impacto: "Médio", urgencia: "Média", area: "Controladoria" },
  ],
};

// ─── Helpers de formatação ──────────────────────────────────────────────────

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

// ─── Primitivas visuais ─────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
      <span
        style={{
          color: C.ink,
          fontSize: 10,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          fontWeight: 700,
          whiteSpace: "nowrap",
        }}
      >
        {children}
      </span>
      <span style={{ flex: 1, height: 1, background: C.rule }} aria-hidden />
    </div>
  );
}

function SevBadge({
  sev,
  children,
  style,
}: {
  sev: SevKey;
  children: React.ReactNode;
  style?: CSSProperties;
}) {
  const s = SEV[sev];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "2px 8px",
        borderRadius: 5,
        border: `1px solid ${s.border}`,
        background: s.bg,
        color: s.text,
        fontSize: 11,
        fontWeight: 600,
        lineHeight: 1.4,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {children}
    </span>
  );
}

const panelStyle: CSSProperties = {
  border: `1px solid ${C.cardBorder}`,
  borderRadius: 9,
  background: C.cardBg,
  padding: 16,
  breakInside: "avoid",
};

// Formata o "gerado em" para "Gerado em: dd/mm/aa" (data BR, sem hora),
// aceitando ISO (2026-07-10T...) ou dd/mm/aaaa já formatado.
function formatGeradoEm(raw: string): string {
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(raw ?? "");
  if (iso) return `Gerado em: ${iso[3]}/${iso[2]}/${iso[1].slice(-2)}`;
  const br = /(\d{2})\/(\d{2})\/(\d{2,4})/.exec(raw ?? "");
  if (br) return `Gerado em: ${br[1]}/${br[2]}/${br[3].slice(-2)}`;
  return raw ?? "";
}

// ─── 1. Header ──────────────────────────────────────────────────────────────

function Header({
  data,
}: {
  data: OnePageReportPreviewData["cabecalho"];
}) {
  return (
    <header
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 18,
        alignItems: "flex-start",
        justifyContent: "space-between",
        paddingBottom: 18,
        borderBottom: `1px solid ${C.rule}`,
      }}
    >
      <div style={{ minWidth: 220 }}>
        <div
          style={{
            color: C.tertiary,
            fontSize: 10,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            fontWeight: 700,
          }}
        >
          Relatório Financeiro
        </div>
        <h1
          style={{
            margin: "6px 0 4px",
            fontSize: 26,
            lineHeight: 1.1,
            fontWeight: 700,
            color: C.ink,
            letterSpacing: "-0.01em",
          }}
        >
          {data.empresa}
        </h1>
        <div style={{ fontSize: 12, color: C.sub }}>{formatGeradoEm(data.geradoEm)}</div>
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "stretch", flexWrap: "wrap" }}>
        {/* Período de referência — card escuro em destaque */}
        <div
          style={{
            background: C.darkCard,
            borderRadius: 8,
            padding: "12px 16px",
            minWidth: 130,
          }}
        >
          <div
            style={{
              color: C.darkLabel,
              fontSize: 9,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              fontWeight: 600,
            }}
          >
            Período
          </div>
          <div style={{ color: "#ffffff", fontSize: 18, fontWeight: 700, marginTop: 4 }}>
            {data.periodo}
          </div>
        </div>
      </div>
    </header>
  );
}

// ─── 2. Resumo executivo ─────────────────────────────────────────────────────

function ResumoExecutivo({
  data,
  accent,
  showSemaforo,
}: {
  data: OnePageReportPreviewData;
  accent: string;
  showSemaforo: boolean;
}) {
  const resultadoKpi =
    data.kpis.find((k) => k.label.toLowerCase() === "resultado") ?? null;
  const valor = resultadoKpi?.value ?? "—";
  const variacao = resultadoKpi?.variation ?? "";
  // Vermelho quando o resultado é negativo ou classificado como crítico.
  const negativo =
    valor.trim().startsWith("-") || resultadoKpi?.sign === "Crítico";
  const valueColor = negativo ? SEV.critical.text : C.ink;

  return (
    <section style={{ breakInside: "avoid" }}>
      <SectionTitle>Resumo Executivo</SectionTitle>
      <div
        style={{
          display: "grid",
          // Sem KPI operacional "Resultado" (ex.: templates custom como a SGX,
          // cujo headline são os cards de resultado por frente) o painel do
          // número grande é omitido e o diagnóstico ocupa a largura toda.
          gridTemplateColumns: resultadoKpi ? "0.82fr 1.18fr" : "1fr",
          gap: 16,
        }}
        className="opr-resumo-grid"
      >
        {/* Resultado operacional do mês */}
        {resultadoKpi ? (
          <div style={panelStyle}>
            <div
              style={{
                fontSize: 10,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                fontWeight: 600,
                color: C.sub,
              }}
            >
              Resultado operacional do mês
            </div>
            <div
              style={{
                fontFamily: FONT_MONO,
                fontSize: 34,
                fontWeight: 600,
                lineHeight: 1.1,
                color: valueColor,
                margin: "10px 0 6px",
              }}
            >
              {valor}
            </div>
            {variacao ? (
              <div style={{ fontSize: 12, color: C.sub }}>
                <span style={{ fontFamily: FONT_MONO, color: valueColor, fontWeight: 600 }}>
                  {variacao}
                </span>{" "}
                vs orçado
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Diagnóstico + chips de drivers */}
        <div style={panelStyle}>
          <div
            style={{
              fontSize: 10,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              fontWeight: 600,
              color: accent,
            }}
          >
            Diagnóstico Principal
          </div>
          <p
            style={{
              margin: "8px 0 12px",
              fontSize: 13,
              lineHeight: 1.55,
              color: C.body,
              textWrap: "pretty",
            }}
          >
            {data.diagnosticoPrincipal || "Sem diagnóstico disponível para o período."}
          </p>
          {showSemaforo && data.semaforo.length > 0 ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {data.semaforo.map((item) => {
                const sev = signToSev(item.classificacao);
                const s = SEV[sev];
                return (
                  <span
                    key={item.indicador}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "3px 10px",
                      borderRadius: 20,
                      border: `1px solid ${s.border}`,
                      background: s.bg,
                      color: s.text,
                      fontSize: 11,
                      fontWeight: 600,
                    }}
                  >
                    <span
                      aria-hidden
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: s.text,
                      }}
                    />
                    {item.indicador}
                  </span>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

// ─── 3. Desempenho do mês vs orçamento (tabela) ──────────────────────────────

function variationCell(
  item: PrevistoRealizadoItem,
): { label: string; sev: SevKey } {
  const isPercent = item.unidade === "%";
  // Margem (%) → variação em p.p. (diferença absoluta). Demais → variação %.
  if (isPercent) {
    const diff = item.realizado - item.previsto;
    const label = `${diff >= 0 ? "+" : ""}${fmtNum(diff)} p.p.`;
    const sev: SevKey = diff >= 0 ? "positive" : "attention";
    return { label, sev };
  }
  if (item.previsto === 0) {
    return { label: "—", sev: "neutral" };
  }
  const pct = ((item.realizado - item.previsto) / Math.abs(item.previsto)) * 100;
  const label = `${pct >= 0 ? "+" : ""}${fmtNum(pct)}%`;
  // Para custos/despesas, acima do orçado é ruim; demais, acima é bom.
  const nome = item.indicador.toLowerCase();
  const inverte = nome.includes("custo") || nome.includes("despesa");
  const acima = pct >= 0;
  let sev: SevKey;
  if (inverte) {
    sev = acima ? (pct > 10 ? "critical" : "attention") : "positive";
  } else {
    sev = acima ? "positive" : pct < -10 ? "critical" : "attention";
  }
  return { label, sev };
}

function TabelaDesempenho({
  items,
  semaforo,
}: {
  items: PrevistoRealizadoItem[];
  semaforo: SemaforoItem[];
}) {
  // Severidade da variação prioriza a leitura do semáforo (classificação da
  // IA por indicador) quando o nome casa; senão usa a heurística numérica.
  const semaforoMap = new Map<string, SevKey>();
  for (const s of semaforo) {
    semaforoMap.set(s.indicador.toLowerCase(), signToSev(s.classificacao));
  }

  // Tabela AGRUPADA (templates com `group`, ex.: Village): subtítulos por grupo,
  // divisor entre grupos, realizado negativo em vermelho e notas de rodapé.
  // Sem `group` (Franquias Viva / SGX) nada disso é aplicado — tabela plana.
  const hasGroups = items.some((i) => i.group);
  const hasPercent = items.some((i) => i.unidade === "%");
  const footnotes = items
    .map((i) => i.footnote)
    .filter((f): f is string => !!f);

  const th: CSSProperties = {
    fontSize: 9,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    fontWeight: 700,
    color: C.sub,
    padding: "0 10px 8px",
    borderBottom: `1px solid ${C.rule}`,
  };
  const tdNum: CSSProperties = {
    fontFamily: FONT_MONO,
    fontSize: 12.5,
    color: C.body,
    padding: "9px 10px",
    textAlign: "right",
    whiteSpace: "nowrap",
  };

  return (
    <section style={{ breakInside: "avoid" }}>
      <SectionTitle>Desempenho do mês vs orçamento</SectionTitle>
      <div style={{ ...panelStyle, padding: "14px 16px 12px" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: "left" }}>Indicador</th>
              <th style={{ ...th, textAlign: "right" }}>Orçado</th>
              <th style={{ ...th, textAlign: "right" }}>Realizado</th>
              <th style={{ ...th, textAlign: "right" }}>Variação</th>
            </tr>
          </thead>
          <tbody>
            {items.flatMap((item, idx) => {
              const isResultado = item.indicador.toLowerCase().includes("resultado");
              const v = variationCell(item);
              const sev =
                semaforoMap.get(item.indicador.toLowerCase()) ?? v.sev;
              const hasFootnote = !!item.footnote;
              const suf = item.unidade === "%" || hasFootnote ? "*" : "";
              // Realizado negativo em vermelho (só na tabela agrupada).
              const realNeg = hasGroups && item.unidade !== "%" && item.realizado < 0;
              const realColor = realNeg
                ? SEV.critical.text
                : isResultado
                  ? C.ink
                  : C.body;
              const rows = [];
              // Subtítulo do grupo quando ele muda (divisor a partir do 2º).
              if (item.group && item.group !== items[idx - 1]?.group) {
                rows.push(
                  <tr key={`grp-${item.group}`}>
                    <td
                      colSpan={4}
                      style={{
                        fontSize: 9,
                        letterSpacing: "0.12em",
                        textTransform: "uppercase",
                        fontWeight: 700,
                        color: C.tertiary,
                        padding: idx === 0 ? "2px 10px 6px" : "16px 10px 6px",
                        ...(idx === 0 ? {} : { borderTop: `1px solid ${C.rule}` }),
                      }}
                    >
                      {item.group}
                    </td>
                  </tr>,
                );
              }
              rows.push(
                <tr
                  key={item.indicador}
                  style={{
                    background: isResultado ? "#f7f8fa" : "transparent",
                    breakInside: "avoid",
                  }}
                >
                  <td
                    style={{
                      fontSize: 13,
                      fontWeight: isResultado ? 700 : 500,
                      color: isResultado ? C.ink : C.body,
                      padding: "9px 10px",
                      borderBottom: `1px solid ${C.grid}`,
                    }}
                  >
                    {item.indicador}
                    {suf ? <span style={{ color: C.tertiary }}>{suf}</span> : null}
                  </td>
                  <td style={{ ...tdNum, borderBottom: `1px solid ${C.grid}`, color: C.sub }}>
                    {fmtValueWithUnit(item.previsto, item.unidade)}
                  </td>
                  <td
                    style={{
                      ...tdNum,
                      borderBottom: `1px solid ${C.grid}`,
                      fontWeight: isResultado ? 700 : 600,
                      color: realColor,
                    }}
                  >
                    {fmtValueWithUnit(item.realizado, item.unidade)}
                  </td>
                  <td
                    style={{
                      padding: "9px 10px",
                      textAlign: "right",
                      borderBottom: `1px solid ${C.grid}`,
                    }}
                  >
                    <SevBadge sev={sev} style={{ fontFamily: FONT_MONO }}>
                      {v.label}
                    </SevBadge>
                  </td>
                </tr>,
              );
              return rows;
            })}
          </tbody>
        </table>
        <div style={{ marginTop: 10, fontSize: 10, color: C.tertiary, lineHeight: 1.5 }}>
          Valores monetários em milhares de R$ (mil).
          {hasPercent ? " *Margem expressa em % da receita bruta." : ""}
          {footnotes.map((t) => ` *${t}`).join("")}
        </div>
      </div>
    </section>
  );
}

// ─── 4. Saúde financeira & caixa (KPIs) ──────────────────────────────────────

function KpisSaude({
  kpis,
  columns,
  title,
}: {
  kpis: KpiCard[];
  columns?: number;
  title?: string;
}) {
  if (kpis.length === 0) return null;
  return (
    <section style={{ breakInside: "avoid" }}>
      <SectionTitle>{title ?? "Saúde financeira & caixa"}</SectionTitle>
      <div
        className="opr-kpi-grid"
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${columns ?? Math.min(kpis.length, 4)}, 1fr)`,
          gap: 12,
        }}
      >
        {kpis.map((kpi) => {
          const sev = signToSev(kpi.sign);
          const s = SEV[sev];
          const arrow = arrowFor(kpi.sign, kpi.variation);
          const suffix = kpi.variationSuffix ? ` ${kpi.variationSuffix}` : "";
          const comp = kpi.omitComparisonSuffix
            ? ""
            : ` vs ${kpi.comparisonLabel ?? "orçamento"}`;
          return (
            <div key={kpi.label} style={{ ...panelStyle, padding: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 6 }}>
                <span
                  style={{
                    fontSize: 10,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    fontWeight: 600,
                    color: C.sub,
                    lineHeight: 1.3,
                  }}
                >
                  {kpi.label}
                </span>
                <span
                  style={{
                    flexShrink: 0,
                    width: 22,
                    height: 22,
                    borderRadius: 6,
                    background: s.bg,
                    color: s.text,
                    border: `1px solid ${s.border}`,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 13,
                    fontWeight: 700,
                  }}
                >
                  {arrow}
                </span>
              </div>
              <div
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 20,
                  fontWeight: 600,
                  color: C.ink,
                  margin: "10px 0 6px",
                }}
              >
                {kpi.value}
              </div>
              <div style={{ fontSize: 11, color: s.text, fontWeight: 600 }}>
                {kpi.variation}
                {suffix}
                <span style={{ color: C.tertiary, fontWeight: 500 }}>{comp}</span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ─── 5a. Acumulado do ano (barras horizontais) ───────────────────────────────

// Tick custom do eixo Y (categorias): ancora o rótulo — Receita / Despesas /
// Resultado — à ESQUERDA, no limite da área do gráfico, para não se sobrepor
// aos números das barras. Sem isso, em valores negativos (ex.: Resultado) os
// rótulos numéricos ficam por cima do texto da categoria.
interface CategoryTickProps {
  x?: number | string;
  y?: number | string;
  payload?: { value?: string | number };
}
function renderAcumuladoYTick(props: CategoryTickProps) {
  const ny = toNum(props.y);
  if (ny === null) return null;
  const value = props.payload?.value ?? "";
  return (
    <text
      x={0}
      y={ny}
      dy={4}
      textAnchor="start"
      style={{ fontSize: 12, fill: C.body, fontFamily: FONT_SANS }}
    >
      {String(value)}
    </text>
  );
}

function GraficoAcumulado({
  items,
  accent,
}: {
  items: PrevistoRealizadoItem[];
  accent: string;
}) {
  // Barras só para indicadores monetários; a Margem (%) vira a nota lateral.
  const barItems = items.filter((i) => i.unidade === "mil");
  const margem = items.find((i) => i.unidade === "%");
  const data = barItems.map((i) => ({
    indicador: i.indicador,
    Realizado: i.realizado,
    Previsto: i.previsto,
    RealizadoLabel: fmtNum(i.realizado),
    PrevistoLabel: fmtNum(i.previsto),
  }));

  const margemNota = margem
    ? `Margem acum. ${fmtValueWithUnit(margem.realizado, "%")} · orçado ${fmtValueWithUnit(
        margem.previsto,
        "%",
      )}`
    : null;

  return (
    <div style={panelStyle}>
      <div style={{ fontSize: 12, fontWeight: 700, color: C.ink, marginBottom: 2 }}>Acumulado do Ano</div>
      <div style={{ fontSize: 10, color: C.sub, marginBottom: margemNota ? 2 : 6 }}>
        Janeiro do ano selecionado até o mês de análise — Previsto × Realizado
      </div>
      {margemNota ? (
        <div style={{ fontSize: 10, color: C.body, fontFamily: FONT_MONO, marginBottom: 6 }}>{margemNota}</div>
      ) : null}
      <div style={{ height: Math.max(150, data.length * 56), width: "100%" }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              layout="vertical"
              margin={{ top: 6, right: 48, bottom: 6, left: 8 }}
              barGap={3}
              barCategoryGap="26%"
            >
              <CartesianGrid horizontal={false} stroke={C.grid} />
              <XAxis type="number" tick={{ fontSize: 10, fill: C.sub }} axisLine={{ stroke: C.grid }} tickLine={false} />
              <YAxis
                type="category"
                dataKey="indicador"
                tick={renderAcumuladoYTick}
                width={84}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                cursor={{ fill: "rgba(31,111,214,0.06)" }}
                contentStyle={TOOLTIP_CONTENT_STYLE}
                labelStyle={TOOLTIP_LABEL_STYLE}
                itemStyle={TOOLTIP_ITEM_STYLE}
                formatter={(value) => milTooltipFormatter(value)}
              />
              <Bar dataKey="Previsto" fill={C.previsto} radius={[0, 3, 3, 0]} isAnimationActive={false}>
                <LabelList dataKey="PrevistoLabel" position="right" style={{ fontSize: 10, fill: C.sub }} />
              </Bar>
              <Bar dataKey="Realizado" fill={accent} radius={[0, 3, 3, 0]} isAnimationActive={false}>
                <LabelList
                  dataKey="RealizadoLabel"
                  position="right"
                  style={{ fontSize: 10, fill: accent, fontWeight: 700 }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <ChartLegend
          items={[
            { color: C.previsto, label: "Previsto" },
            { color: accent, label: "Realizado" },
          ]}
        />
    </div>
  );
}

function ChartLegend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 8 }}>
      {items.map((it) => (
        <span key={it.label} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: C.body }}>
          <span aria-hidden style={{ width: 9, height: 9, borderRadius: "50%", background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

// Tipos/helpers para labels custom do recharts.
interface LineLabelRenderProps {
  x?: number | string;
  y?: number | string;
  index?: number;
}
function toNum(v: number | string | undefined): number | null {
  if (v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

// ─── 5b. VVR — Realizado × Meta ───────────────────────────────────────────────

function GraficoVVR({
  points,
  accent,
}: {
  points: VvrSerieAnualPoint[];
  accent: string;
}) {
  const data = points.map((p) => {
    const realizadoLabel = p.realizado === null ? "" : fmtNum(p.realizado, 0);
    const metaLabel = p.meta === null ? "" : fmtNum(p.meta, 0);
    const metaAcima =
      p.realizado !== null && p.meta !== null ? p.meta >= p.realizado : true;
    return { mes: p.mes, realizado: p.realizado, meta: p.meta, realizadoLabel, metaLabel, metaAcima };
  });

  const renderMetaLabel = (props: LineLabelRenderProps) => {
    const nx = toNum(props.x);
    const ny = toNum(props.y);
    const { index } = props;
    if (nx === null || ny === null || index === undefined) return null;
    const row = data[index];
    if (!row || row.metaLabel === "") return null;
    const dy = row.metaAcima ? -10 : 16;
    return (
      <text x={nx} y={ny + dy} textAnchor="middle" style={{ fontSize: 9, fill: "#a9701a" }}>
        {row.metaLabel}
      </text>
    );
  };

  const acumMeta = points.reduce((sum, p) => sum + (p.meta ?? 0), 0);
  const acumReal = points.reduce((sum, p) => sum + (p.realizado ?? 0), 0);
  const acumMax = Math.max(acumMeta, acumReal, 1);
  const acumAcima = acumReal >= acumMeta;
  const pct = acumMeta > 0 ? (acumReal / acumMeta) * 100 : 0;

  return (
    <div style={panelStyle}>
      <div style={{ fontSize: 12, fontWeight: 700, color: C.ink, marginBottom: 2 }}>VVR — Realizado × Meta</div>
      <div style={{ fontSize: 10, color: C.sub, marginBottom: 6 }}>Janeiro do ano selecionado até o mês de análise.</div>
      <div
        className="opr-vvr-grid"
        style={{ display: "grid", gridTemplateColumns: "1fr 232px", gap: 16, alignItems: "stretch" }}
      >
        <div>
          <div style={{ height: 188, width: "100%" }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 24, right: 16, bottom: 6, left: -6 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false} />
            <XAxis
              dataKey="mes"
              tick={{ fontSize: 10, fill: C.sub }}
              axisLine={{ stroke: C.grid }}
              tickLine={false}
              padding={{ left: 12, right: 12 }}
            />
            <YAxis tick={{ fontSize: 10, fill: C.sub }} width={40} axisLine={false} tickLine={false} />
            <Tooltip
              cursor={{ fill: "rgba(31,111,214,0.06)" }}
              contentStyle={TOOLTIP_CONTENT_STYLE}
              labelStyle={TOOLTIP_LABEL_STYLE}
              itemStyle={TOOLTIP_ITEM_STYLE}
              formatter={(value) => milTooltipFormatter(value)}
            />
            <Bar dataKey="realizado" name="Realizado" fill={accent} radius={[3, 3, 0, 0]} barSize={24} isAnimationActive={false}>
              <LabelList dataKey="realizadoLabel" position="top" style={{ fontSize: 9, fill: accent, fontWeight: 700 }} />
            </Bar>
            <Line
              type="monotone"
              dataKey="meta"
              name="Meta"
              stroke={C.metaAmber}
              strokeWidth={2}
              dot={{ r: 2.5, fill: C.metaAmber }}
              isAnimationActive={false}
            >
              <LabelList content={renderMetaLabel} />
            </Line>
          </ComposedChart>
        </ResponsiveContainer>
      </div>
          <ChartLegend items={[{ color: accent, label: "Realizado" }, { color: C.metaAmber, label: "Meta" }]} />
        </div>

        {/* VVR acumulado — à direita do gráfico (grade interna 1fr 232px) */}
        <div
          style={{
            border: `1px solid ${C.grid}`,
            borderRadius: 8,
            padding: 12,
            background: "#fafafa",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
          }}
        >
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <span style={{ fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 700, color: C.sub }}>
            VVR Acumulado
          </span>
          <span style={{ fontSize: 9, color: C.tertiary }}>Jan até o mês de análise</span>
        </div>
        <AcumBar label="Meta" value={acumMeta} max={acumMax} color={C.metaAmber} valueColor={C.body} />
        <div style={{ height: 6 }} />
        <AcumBar
          label="Realizado"
          value={acumReal}
          max={acumMax}
          color={acumAcima ? SEV.positive.text : SEV.critical.text}
          valueColor={acumAcima ? SEV.positive.text : SEV.critical.text}
          extra={acumMeta > 0 ? `${fmtNum(pct, 0)}%` : undefined}
        />
        </div>
      </div>
    </div>
  );
}

function AcumBar({
  label,
  value,
  max,
  color,
  valueColor,
  extra,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
  valueColor: string;
  extra?: string;
}) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3 }}>
        <span style={{ color: C.sub }}>{label}</span>
        <span style={{ fontFamily: FONT_MONO, color: valueColor, fontWeight: 600 }}>
          {fmtNum(value, 0)} mil{extra ? ` · ${extra}` : ""}
        </span>
      </div>
      <div style={{ height: 7, width: "100%", borderRadius: 20, background: C.grid, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${(value / max) * 100}%`, background: color, borderRadius: 20 }} />
      </div>
    </div>
  );
}

// Rodapé "Acumulado no ano" (Jan→análise): 2 barras horizontais — Realizado
// (com variação vs previsto) e Previsto. Reutilizado pelo histórico e pelo
// bloco consolidado.
function AcumPrevRealFooter({
  previsto,
  realizado,
  accent,
  kLabel,
}: {
  previsto: number | null;
  realizado: number | null;
  accent: string;
  kLabel?: boolean;
}) {
  const accMax = Math.max(1, Math.abs(previsto ?? 0), Math.abs(realizado ?? 0));
  const variation =
    previsto !== null && previsto !== 0 && realizado !== null
      ? ((realizado - previsto) / Math.abs(previsto)) * 100
      : null;
  return (
    <div style={{ marginTop: 10, borderTop: `1px solid ${C.grid}`, paddingTop: 10 }}>
      <div
        style={{
          fontSize: 9,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          fontWeight: 700,
          color: C.sub,
          marginBottom: 8,
        }}
      >
        Acumulado no ano
      </div>
      <HBarSigned
        label="Realizado"
        value={realizado}
        max={accMax}
        color={accent}
        variation={
          variation !== null
            ? `${variation >= 0 ? "+" : ""}${fmtNum(variation, 1)}% vs previsto`
            : undefined
        }
        variationColor={
          variation !== null ? (variation >= 0 ? SEV.positive.text : SEV.critical.text) : undefined
        }
        kLabel={kLabel}
      />
      <HBarSigned label="Previsto" value={previsto} max={accMax} color={C.previsto} kLabel={kLabel} />
    </div>
  );
}

// ─── 5c. Resultado do Exercício (linha) ───────────────────────────────────────

function GraficoResultado({
  points,
  accent,
  title,
  kLabels,
  acum,
}: {
  points: HistoricoPoint[];
  accent: string;
  title?: string;
  kLabels?: boolean;
  acum?: { previsto: number | null; realizado: number | null };
}) {
  // kLabels: rótulos "133,6k" (ex.: SGX). Sem ele, número cheio (Viva inalterada).
  const fmtL = (v: number) => (kLabels ? `${fmtNum(v, 1)}k` : fmtNum(v, 0));
  const data = points.map((p) => {
    const previstoLabel = p.previsto === null ? "" : fmtL(p.previsto);
    const realizadoLabel = p.realizado === null ? "" : fmtL(p.realizado);
    const realizadoAcima =
      p.realizado !== null && p.previsto !== null ? p.realizado >= p.previsto : true;
    return { mes: p.mes, previsto: p.previsto, realizado: p.realizado, previstoLabel, realizadoLabel, realizadoAcima };
  });

  const OFFSET_UP = -10;
  const OFFSET_DOWN = 16;

  const renderRealizado = (props: LineLabelRenderProps) => {
    const nx = toNum(props.x);
    const ny = toNum(props.y);
    const { index } = props;
    if (nx === null || ny === null || index === undefined) return null;
    const row = data[index];
    if (!row || row.realizadoLabel === "") return null;
    return (
      <text x={nx} y={ny + (row.realizadoAcima ? OFFSET_UP : OFFSET_DOWN)} textAnchor="middle" style={{ fontSize: 9, fill: accent, fontWeight: 700 }}>
        {row.realizadoLabel}
      </text>
    );
  };
  const renderPrevisto = (props: LineLabelRenderProps) => {
    const nx = toNum(props.x);
    const ny = toNum(props.y);
    const { index } = props;
    if (nx === null || ny === null || index === undefined) return null;
    const row = data[index];
    if (!row || row.previstoLabel === "") return null;
    return (
      <text x={nx} y={ny + (row.realizadoAcima ? OFFSET_DOWN : OFFSET_UP)} textAnchor="middle" style={{ fontSize: 9, fill: C.sub }}>
        {row.previstoLabel}
      </text>
    );
  };

  return (
    <div style={panelStyle}>
      <div style={{ fontSize: 12, fontWeight: 700, color: C.ink, marginBottom: 2 }}>{title ?? "Resultado do Exercício"}</div>
      <div style={{ fontSize: 10, color: C.sub, marginBottom: 6 }}>Previsto × Realizado — últimos 6 meses.</div>
      <div style={{ height: 188, width: "100%" }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 26, right: 22, bottom: 6, left: -6 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false} />
            <XAxis
              dataKey="mes"
              tick={{ fontSize: 10, fill: C.sub }}
              axisLine={{ stroke: C.grid }}
              tickLine={false}
              padding={{ left: 16, right: 16 }}
            />
            <YAxis tick={{ fontSize: 10, fill: C.sub }} width={32} axisLine={false} tickLine={false} />
            <Tooltip
              cursor={{ stroke: C.previsto, strokeDasharray: "3 3" }}
              contentStyle={TOOLTIP_CONTENT_STYLE}
              labelStyle={TOOLTIP_LABEL_STYLE}
              itemStyle={TOOLTIP_ITEM_STYLE}
              formatter={(value) => milTooltipFormatter(value)}
            />
            <Line type="monotone" dataKey="previsto" name="Previsto" stroke={C.previsto} strokeWidth={2} dot={{ r: 2.5 }} isAnimationActive={false}>
              <LabelList content={renderPrevisto} />
            </Line>
            <Line type="monotone" dataKey="realizado" name="Realizado" stroke={accent} strokeWidth={2} dot={{ r: 2.5 }} isAnimationActive={false}>
              <LabelList content={renderRealizado} />
            </Line>
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ChartLegend items={[{ color: C.previsto, label: "Previsto" }, { color: accent, label: "Realizado" }]} />
      {/* Acumulado do ano (Jan→análise) — Previsto × Realizado do mesmo métrico. */}
      {acum ? (
        <AcumPrevRealFooter
          previsto={acum.previsto}
          realizado={acum.realizado}
          accent={accent}
          kLabel={kLabels}
        />
      ) : null}
    </div>
  );
}

// ─── 5d. Gráfico de COLUNAS (acumulado do ano, só realizado) ──────────────────
// Ex.: Village — Gap de Reembolso por mês (Jan→análise). Cor por sinal
// (negativo = vermelho, positivo = verde).
function GraficoBarras({
  points,
  title,
  acum,
}: {
  points: BarPoint[];
  title: string;
  acum?: number | null;
}) {
  const data = points.map((p) => ({
    mes: p.mes,
    valor: p.valor,
    label: p.valor === null ? "" : `${fmtNum(p.valor, 1)}k`,
  }));
  return (
    <div style={panelStyle}>
      <div style={{ fontSize: 12, fontWeight: 700, color: C.ink, marginBottom: 2 }}>{title}</div>
      <div style={{ fontSize: 10, color: C.sub, marginBottom: 6 }}>
        Janeiro do ano de análise até o mês selecionado.
      </div>
      <div style={{ height: 188, width: "100%" }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 22, right: 12, bottom: 6, left: -6 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false} />
            <XAxis
              dataKey="mes"
              tick={{ fontSize: 10, fill: C.sub }}
              axisLine={{ stroke: C.grid }}
              tickLine={false}
              padding={{ left: 8, right: 8 }}
            />
            <YAxis tick={{ fontSize: 10, fill: C.sub }} width={40} axisLine={false} tickLine={false} />
            <Tooltip
              cursor={{ fill: "rgba(31,111,214,0.06)" }}
              contentStyle={TOOLTIP_CONTENT_STYLE}
              labelStyle={TOOLTIP_LABEL_STYLE}
              itemStyle={TOOLTIP_ITEM_STYLE}
              formatter={(value) => milTooltipFormatter(value)}
            />
            <Bar dataKey="valor" name="Realizado" radius={[3, 3, 0, 0]} maxBarSize={34} isAnimationActive={false}>
              <LabelList dataKey="label" position="top" style={{ fontSize: 9, fontWeight: 700, fill: C.sub }} />
              {data.map((d, i) => (
                <Cell key={i} fill={(d.valor ?? 0) < 0 ? SEV.critical.text : SEV.positive.text} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {/* Acumulado do ano (soma dos valores Jan→análise). */}
      {acum !== undefined ? (
        <div
          style={{
            marginTop: 8,
            borderTop: `1px solid ${C.grid}`,
            paddingTop: 10,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span style={{ fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 700, color: C.sub }}>
            Acumulado no ano
          </span>
          <span
            style={{
              fontSize: 15,
              fontFamily: FONT_MONO,
              fontWeight: 700,
              color: acum === null ? C.tertiary : acum < 0 ? SEV.critical.text : SEV.positive.text,
            }}
          >
            {acum === null ? "—" : `${fmtNum(acum, 1)}k`}
          </span>
        </div>
      ) : null}
    </div>
  );
}

// Barra horizontal com valor assinalado (aceita negativo: largura = |v|/max,
// número colorido por sinal). Usada no acumulado do ano sob as linhas.
function HBarSigned({
  label,
  value,
  max,
  color,
  variation,
  variationColor,
  kLabel,
}: {
  label: string;
  value: number | null;
  max: number;
  color: string;
  variation?: string;
  variationColor?: string;
  /** Rótulo do valor em "Xk" (milhar) em vez de "X mil". Ex.: Village. */
  kLabel?: boolean;
}) {
  const v = value ?? 0;
  const w = max > 0 ? (Math.abs(v) / max) * 100 : 0;
  const valColor = value === null ? C.tertiary : v < 0 ? SEV.critical.text : C.ink;
  const valText =
    value === null ? "—" : kLabel ? `${fmtNum(value, 1)}k` : `${fmtNum(value, 0)} mil`;
  return (
    <div style={{ marginBottom: 7 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 3 }}>
        <span style={{ fontSize: 10, color: C.sub }}>{label}</span>
        <span style={{ display: "inline-flex", alignItems: "baseline", gap: 6 }}>
          <span style={{ fontSize: 11, fontFamily: FONT_MONO, fontWeight: 600, color: valColor }}>
            {valText}
          </span>
          {variation ? (
            <span style={{ fontSize: 9.5, fontWeight: 600, color: variationColor ?? C.sub }}>{variation}</span>
          ) : null}
        </span>
      </div>
      <div style={{ height: 7, width: "100%", borderRadius: 20, background: C.grid, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${w}%`, background: color, borderRadius: 20 }} />
      </div>
    </div>
  );
}

// ─── 5e. Gráfico de LINHAS multi-série (últimos 6 meses) ──────────────────────
// Ex.: Village — Resultado Final realizado / Resultado Ajustado / Final orçado.
function GraficoLinhasMulti({
  points,
  seriesLabels,
  title,
  accent,
  acum,
  acumBaseIndex,
}: {
  points: MultiLinePoint[];
  seriesLabels: string[];
  title: string;
  accent: string;
  acum?: (number | null)[];
  acumBaseIndex?: number;
}) {
  // Cores por série (na ordem do template): realizado, ajustado, orçado.
  const COLORS = [accent, C.metaAmber, C.previsto];
  const color = (i: number) => COLORS[i % COLORS.length];
  const data = points.map((p) => {
    const row: Record<string, string | number | null> = { mes: p.mes };
    p.values.forEach((v, i) => {
      row[`s${i}`] = v;
    });
    return row;
  });
  // Rótulos "Xk" só na linha de Realizado (s0) e na de Orçado (base), em lados
  // OPOSTOS (cima/baixo) conforme qual está acima no ponto — garante que NUNCA
  // se sobreponham (mesma técnica do histórico). A do meio (Ajustado) fica sem
  // rótulo de ponto; seu valor segue no tooltip e no acumulado do ano.
  const baseIdx = acumBaseIndex;
  // realizadoAcima(index): realizado (s0) está acima do orçado (base) no ponto?
  const realizadoAcima = (index: number): boolean => {
    const vals = points[index]?.values ?? [];
    const r = vals[0];
    const o = baseIdx !== undefined ? vals[baseIdx] : null;
    return r != null && o != null ? r >= o : true;
  };
  const renderRealizadoLabel = (props: LineLabelRenderProps) => {
    const nx = toNum(props.x);
    const ny = toNum(props.y);
    const { index } = props;
    if (nx === null || ny === null || index === undefined) return null;
    const v = points[index]?.values[0];
    if (v === null || v === undefined) return null;
    return (
      <text
        x={nx}
        y={ny + (realizadoAcima(index) ? -10 : 16)}
        textAnchor="middle"
        style={{ fontSize: 8, fontWeight: 600, fill: color(0) }}
      >
        {`${fmtNum(v, 1)}k`}
      </text>
    );
  };
  const renderOrcadoLabel = (props: LineLabelRenderProps) => {
    const nx = toNum(props.x);
    const ny = toNum(props.y);
    const { index } = props;
    if (nx === null || ny === null || index === undefined || baseIdx === undefined) return null;
    const v = points[index]?.values[baseIdx];
    if (v === null || v === undefined) return null;
    // Lado oposto ao realizado: se realizado está acima, o orçado vai para baixo.
    return (
      <text
        x={nx}
        y={ny + (realizadoAcima(index) ? 16 : -10)}
        textAnchor="middle"
        style={{ fontSize: 8, fontWeight: 600, fill: color(baseIdx) }}
      >
        {`${fmtNum(v, 1)}k`}
      </text>
    );
  };
  return (
    <div style={panelStyle}>
      <div style={{ fontSize: 12, fontWeight: 700, color: C.ink, marginBottom: 2 }}>{title}</div>
      <div style={{ fontSize: 10, color: C.sub, marginBottom: 6 }}>Últimos 6 meses.</div>
      <div style={{ height: 188, width: "100%" }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 16, right: 18, bottom: 6, left: -6 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false} />
            <XAxis
              dataKey="mes"
              tick={{ fontSize: 10, fill: C.sub }}
              axisLine={{ stroke: C.grid }}
              tickLine={false}
              padding={{ left: 16, right: 16 }}
            />
            <YAxis tick={{ fontSize: 10, fill: C.sub }} width={36} axisLine={false} tickLine={false} />
            <Tooltip
              contentStyle={TOOLTIP_CONTENT_STYLE}
              labelStyle={TOOLTIP_LABEL_STYLE}
              itemStyle={TOOLTIP_ITEM_STYLE}
              formatter={(value) => milTooltipFormatter(value)}
            />
            {seriesLabels.map((label, i) => (
              <Line
                key={i}
                type="monotone"
                dataKey={`s${i}`}
                name={label}
                stroke={color(i)}
                strokeWidth={2}
                dot={{ r: 2.5 }}
                connectNulls
                isAnimationActive={false}
              >
                {/* Rótulo só em Realizado (s0) e Orçado (base), em lados opostos. */}
                {i === 0 ? <LabelList content={renderRealizadoLabel} /> : null}
                {baseIdx !== undefined && i === baseIdx ? (
                  <LabelList content={renderOrcadoLabel} />
                ) : null}
              </Line>
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ChartLegend items={seriesLabels.map((label, i) => ({ color: color(i), label }))} />
      {/* Acumulado do ano (Jan→análise) — 3 barras horizontais. */}
      {acum && acum.length > 0 ? (
        <div style={{ marginTop: 10, borderTop: `1px solid ${C.grid}`, paddingTop: 10 }}>
          <div
            style={{
              fontSize: 9,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              fontWeight: 700,
              color: C.sub,
              marginBottom: 8,
            }}
          >
            Acumulado no ano
          </div>
          {(() => {
            const accMax = Math.max(1, ...acum.map((v) => Math.abs(v ?? 0)));
            const base = acumBaseIndex !== undefined ? acum[acumBaseIndex] : null;
            return acum.map((v, i) => {
              // Variação % vs orçado (série base), só nas linhas que não são a base.
              let variation: string | undefined;
              let variationColor: string | undefined;
              if (
                acumBaseIndex !== undefined &&
                i !== acumBaseIndex &&
                v !== null &&
                base !== null &&
                base !== undefined &&
                base !== 0
              ) {
                const pct = ((v - base) / Math.abs(base)) * 100;
                variation = `${pct >= 0 ? "+" : ""}${fmtNum(pct, 1)}% vs orçado`;
                variationColor = pct >= 0 ? SEV.positive.text : SEV.critical.text;
              }
              return (
                <HBarSigned
                  key={i}
                  label={seriesLabels[i] ?? ""}
                  value={v}
                  max={accMax}
                  color={color(i)}
                  variation={variation}
                  variationColor={variationColor}
                  kLabel
                />
              );
            });
          })()}
        </div>
      ) : null}
    </div>
  );
}

// ─── 5f. Gráfico de COLUNAS Previsto × Realizado mensal + acumulado ───────────
// Ex.: SGX — Locações (1−2) e Projetos (12−13), Jan→análise. Duas barras por
// mês (previsto/realizado) e, abaixo, previsto/realizado acumulados do ano +
// variação (realizado vs previsto).
function GraficoBarrasPrevReal({
  title,
  serie,
  previstoAcum,
  realizadoAcum,
  accent,
}: {
  title: string;
  serie: PrevRealPoint[];
  previstoAcum: number | null;
  realizadoAcum: number | null;
  accent: string;
}) {
  const data = serie.map((p) => ({
    mes: p.mes,
    Previsto: p.previsto,
    Realizado: p.realizado,
    // Rótulos pré-formatados "133,6k" (mesmo padrão do GraficoVVR).
    previstoLabel: p.previsto === null ? "" : `${fmtNum(p.previsto, 1)}k`,
    realizadoLabel: p.realizado === null ? "" : `${fmtNum(p.realizado, 1)}k`,
  }));
  const variation =
    previstoAcum !== null && previstoAcum !== 0 && realizadoAcum !== null
      ? ((realizadoAcum - previstoAcum) / Math.abs(previstoAcum)) * 100
      : null;
  const accMax = Math.max(1, Math.abs(previstoAcum ?? 0), Math.abs(realizadoAcum ?? 0));
  return (
    <div style={panelStyle}>
      <div style={{ fontSize: 12, fontWeight: 700, color: C.ink, marginBottom: 2 }}>{title}</div>
      <div style={{ fontSize: 10, color: C.sub, marginBottom: 6 }}>
        Janeiro do ano de análise até o mês selecionado.
      </div>
      <div style={{ height: 188, width: "100%" }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 16, right: 12, bottom: 6, left: -6 }} barGap={2}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false} />
            <XAxis
              dataKey="mes"
              tick={{ fontSize: 10, fill: C.sub }}
              axisLine={{ stroke: C.grid }}
              tickLine={false}
              padding={{ left: 8, right: 8 }}
            />
            <YAxis tick={{ fontSize: 10, fill: C.sub }} width={40} axisLine={false} tickLine={false} />
            <Tooltip
              cursor={{ fill: "rgba(31,111,214,0.06)" }}
              contentStyle={TOOLTIP_CONTENT_STYLE}
              labelStyle={TOOLTIP_LABEL_STYLE}
              itemStyle={TOOLTIP_ITEM_STYLE}
              formatter={(value) => milTooltipFormatter(value)}
            />
            <Bar dataKey="Previsto" fill={C.previsto} radius={[3, 3, 0, 0]} maxBarSize={18} isAnimationActive={false}>
              <LabelList dataKey="previstoLabel" position="top" style={{ fontSize: 8, fill: C.sub, fontWeight: 600 }} />
            </Bar>
            <Bar dataKey="Realizado" fill={accent} radius={[3, 3, 0, 0]} maxBarSize={18} isAnimationActive={false}>
              <LabelList dataKey="realizadoLabel" position="top" style={{ fontSize: 8, fill: accent, fontWeight: 700 }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ChartLegend items={[{ color: C.previsto, label: "Previsto" }, { color: accent, label: "Realizado" }]} />
      {/* Acumulado do ano: realizado (c/ variação vs previsto) e previsto. */}
      <div style={{ marginTop: 10, borderTop: `1px solid ${C.grid}`, paddingTop: 10 }}>
        <div
          style={{
            fontSize: 9,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            fontWeight: 700,
            color: C.sub,
            marginBottom: 8,
          }}
        >
          Acumulado no ano
        </div>
        <HBarSigned
          label="Realizado"
          value={realizadoAcum}
          max={accMax}
          color={accent}
          variation={
            variation !== null
              ? `${variation >= 0 ? "+" : ""}${fmtNum(variation, 1)}% vs previsto`
              : undefined
          }
          variationColor={
            variation !== null ? (variation >= 0 ? SEV.positive.text : SEV.critical.text) : undefined
          }
        />
        <HBarSigned label="Previsto" value={previstoAcum} max={accMax} color={C.previsto} />
      </div>
    </div>
  );
}

// ─── 5g. Bloco CONSOLIDADO do grupo (ex.: Salvaterra) ─────────────────────────
// Tabela Previsto × Realizado do Resultado de cada empresa do grupo + a soma
// consolidada (linha em destaque). Bloco COMPLEMENTAR (não mistura o resto).
function ConsolidadoBlock({ data }: { data: Consolidated }) {
  const th: CSSProperties = {
    fontSize: 9,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    fontWeight: 700,
    color: C.sub,
    padding: "0 10px 8px",
    borderBottom: `1px solid ${C.rule}`,
  };
  const tdNum: CSSProperties = {
    fontFamily: FONT_MONO,
    fontSize: 12.5,
    padding: "9px 10px",
    textAlign: "right",
    whiteSpace: "nowrap",
  };
  const fmtV = (v: number | null) => (v === null ? "—" : `${fmtNum(v, 1)} mil`);
  return (
    <section style={{ breakInside: "avoid" }}>
      <SectionTitle>{data.title}</SectionTitle>
      <div style={{ ...panelStyle, padding: "14px 16px 12px" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: "left" }}>Indicador</th>
              <th style={{ ...th, textAlign: "right" }}>Orçado</th>
              <th style={{ ...th, textAlign: "right" }}>Realizado</th>
              <th style={{ ...th, textAlign: "right" }}>Variação</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => {
              const emph = !!r.emphasis;
              let varLabel = "—";
              let varSev: SevKey = "neutral";
              if (r.previsto !== null && r.previsto !== 0 && r.realizado !== null) {
                const pct = ((r.realizado - r.previsto) / Math.abs(r.previsto)) * 100;
                varLabel = `${pct >= 0 ? "+" : ""}${fmtNum(pct, 1)}%`;
                varSev = pct >= 0 ? "positive" : pct < -10 ? "critical" : "attention";
              }
              const realNeg = r.realizado !== null && r.realizado < 0;
              return (
                <tr key={r.label} style={{ background: emph ? "#f7f8fa" : "transparent", breakInside: "avoid" }}>
                  <td
                    style={{
                      fontSize: 13,
                      fontWeight: emph ? 700 : 500,
                      color: emph ? C.ink : C.body,
                      padding: "9px 10px",
                      borderBottom: `1px solid ${C.grid}`,
                    }}
                  >
                    {r.label}
                  </td>
                  <td style={{ ...tdNum, borderBottom: `1px solid ${C.grid}`, color: C.sub }}>
                    {fmtV(r.previsto)}
                  </td>
                  <td
                    style={{
                      ...tdNum,
                      borderBottom: `1px solid ${C.grid}`,
                      fontWeight: emph ? 700 : 600,
                      color: realNeg ? SEV.critical.text : emph ? C.ink : C.body,
                    }}
                  >
                    {fmtV(r.realizado)}
                  </td>
                  <td style={{ padding: "9px 10px", textAlign: "right", borderBottom: `1px solid ${C.grid}` }}>
                    <SevBadge sev={varSev} style={{ fontFamily: FONT_MONO }}>
                      {varLabel}
                    </SevBadge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {/* Acumulado do ano (Jan→análise) do consolidado — Previsto × Realizado. */}
        {data.acum ? (
          <AcumPrevRealFooter
            previsto={data.acum.previsto}
            realizado={data.acum.realizado}
            accent={DEFAULT_ACCENT}
          />
        ) : null}
        <div style={{ marginTop: 10, fontSize: 10, color: C.tertiary, lineHeight: 1.5 }}>
          Valores em milhares de R$ (mil). Bloco complementar — soma apenas as empresas do grupo.
        </div>
      </div>
    </section>
  );
}

// ─── 5h. Bloco PERFORMANCE POR PARCEIRO (ex.: Young Med) ──────────────────────
// Realizado por fornecedor (supplier_customer) da conta de BVs, no mês e no
// acumulado do ano, com o % de cada parceiro. Orçamento existe por CONTA, não
// por fornecedor → bloco realizado-only (limitação no rodapé). Só dados da
// própria empresa; "Turmas Heppi" (outra conta) não entra.
function PartnerPerformanceBlock({ data }: { data: PartnerPerformance }) {
  const th: CSSProperties = {
    fontSize: 9,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    fontWeight: 700,
    color: C.sub,
    padding: "0 10px 8px",
    borderBottom: `1px solid ${C.rule}`,
  };
  const tdNum: CSSProperties = {
    fontFamily: FONT_MONO,
    fontSize: 12.5,
    padding: "9px 10px",
    textAlign: "right",
    whiteSpace: "nowrap",
  };
  const tdBorder = `1px solid ${C.grid}`;
  const fmtV = (v: number | null) => (v === null ? "—" : `${fmtNum(v, 1)} mil`);
  const fmtP = (v: number | null) => (v === null ? "—" : `${fmtNum(v, 1)}%`);
  return (
    <section style={{ breakInside: "avoid" }}>
      <SectionTitle>{data.title}</SectionTitle>
      <div style={{ ...panelStyle, padding: "14px 16px 12px" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: "left" }}>Parceiro</th>
              <th style={{ ...th, textAlign: "right" }}>Realizado mês</th>
              <th style={{ ...th, textAlign: "right" }}>% mês</th>
              <th style={{ ...th, textAlign: "right" }}>Realizado acum.</th>
              <th style={{ ...th, textAlign: "right" }}>% acum.</th>
            </tr>
          </thead>
          <tbody>
            {data.partners.map((p) => (
              <tr key={p.nome} style={{ breakInside: "avoid" }}>
                <td style={{ fontSize: 13, fontWeight: 500, color: C.body, padding: "9px 10px", borderBottom: tdBorder }}>
                  {p.nome}
                </td>
                <td style={{ ...tdNum, borderBottom: tdBorder, color: C.body, fontWeight: 600 }}>{fmtV(p.realizadoMes)}</td>
                <td style={{ ...tdNum, borderBottom: tdBorder, color: C.sub }}>{fmtP(p.pctMes)}</td>
                <td style={{ ...tdNum, borderBottom: tdBorder, color: C.body, fontWeight: 600 }}>{fmtV(p.realizadoAcum)}</td>
                <td style={{ ...tdNum, borderBottom: tdBorder, color: C.sub }}>{fmtP(p.pctAcum)}</td>
              </tr>
            ))}
            <tr style={{ background: "#f7f8fa", breakInside: "avoid" }}>
              <td style={{ fontSize: 13, fontWeight: 700, color: C.ink, padding: "9px 10px", borderBottom: tdBorder }}>
                {data.categoria ? `Total (${data.categoria})` : "Total"}
              </td>
              <td style={{ ...tdNum, borderBottom: tdBorder, fontWeight: 700, color: C.ink }}>{fmtV(data.totalMes)}</td>
              <td style={{ ...tdNum, borderBottom: tdBorder, color: C.sub }}>{data.totalMes !== 0 ? "100,0%" : "—"}</td>
              <td style={{ ...tdNum, borderBottom: tdBorder, fontWeight: 700, color: C.ink }}>{fmtV(data.totalAcum)}</td>
              <td style={{ ...tdNum, borderBottom: tdBorder, color: C.sub }}>{data.totalAcum !== 0 ? "100,0%" : "—"}</td>
            </tr>
          </tbody>
        </table>
        <div style={{ marginTop: 10, fontSize: 10, color: C.tertiary, lineHeight: 1.5 }}>
          Valores em milhares de R$ (mil). Acumulado = janeiro do ano de análise até o mês filtrado.
        </div>
      </div>
    </section>
  );
}

// ─── 5i. Bloco BREAKDOWN em barras (ex.: Spot — composição da receita; frete) ──
// Linhas (label + valor) em barras horizontais com sinal (verde/+, vermelho/−);
// `pct` opcional (composição); `emphasis` destaca a linha-resultado. Só dados da
// própria empresa. Largura proporcional ao maior |valor| do bloco.
function BreakdownBars({ data }: { data: BreakdownBlock }) {
  const max = Math.max(
    1,
    data.rows.reduce((m, r) => Math.max(m, Math.abs(r.value)), 0),
  );
  return (
    <section style={{ breakInside: "avoid" }}>
      <SectionTitle>{data.title}</SectionTitle>
      <div
        style={{
          ...panelStyle,
          padding: "14px 16px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 11,
        }}
      >
        {data.rows.map((r) => {
          const w = (Math.abs(r.value) / max) * 100;
          const color = r.emphasis
            ? DEFAULT_ACCENT
            : r.value >= 0
              ? SEV.positive.text
              : SEV.critical.text;
          return (
            <div key={r.label} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontSize: 12.5, fontWeight: r.emphasis ? 700 : 500, color: r.emphasis ? C.ink : C.body }}>
                  {r.label}
                </span>
                <span style={{ fontFamily: FONT_MONO, fontSize: 12.5, fontWeight: r.emphasis ? 700 : 600, color: r.emphasis ? C.ink : C.body }}>
                  {`${fmtNum(r.value, 1)} mil`}
                  {r.pct !== null ? (
                    <span style={{ color: C.sub, fontWeight: 500 }}>{`   ${fmtNum(r.pct, 1)}%`}</span>
                  ) : null}
                </span>
              </div>
              <div style={{ height: 8, background: C.grid, borderRadius: 4, overflow: "hidden" }}>
                <div style={{ width: `${w}%`, height: "100%", background: color, borderRadius: 4 }} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ─── 6. Alertas ───────────────────────────────────────────────────────────────

function Alertas({ items }: { items: AlertaCard[] }) {
  if (items.length === 0) return null;
  return (
    <section style={{ breakInside: "avoid" }}>
      <SectionTitle>Alertas</SectionTitle>
      <div className="opr-cards-3" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
        {items.map((alerta, i) => {
          const sev = signToSev(alerta.classificacao);
          const s = SEV[sev];
          const label =
            sev === "critical" ? "Crítico" : sev === "positive" ? "Positivo" : "Atenção";
          const icon = sev === "positive" ? "✓" : sev === "critical" ? "▲" : "!";
          return (
            <div
              key={i}
              style={{
                border: `1px solid ${s.border}`,
                background: s.bg,
                borderRadius: 8,
                padding: 14,
                breakInside: "avoid",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 6,
                    background: "#fff",
                    border: `1px solid ${s.border}`,
                    color: s.text,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  {icon}
                </span>
                <SevBadge sev={sev}>{label}</SevBadge>
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, marginBottom: 4 }}>{alerta.titulo}</div>
              <div style={{ fontSize: 11.5, lineHeight: 1.5, color: C.body, textWrap: "pretty" }}>{alerta.texto}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ─── 7. Ações recomendadas ───────────────────────────────────────────────────

const IMPACTO_SEV: Record<AcaoCard["impacto"], SevKey> = {
  Alto: "critical",
  Médio: "attention",
  Baixo: "neutral",
};
const URGENCIA_SEV: Record<AcaoCard["urgencia"], SevKey> = {
  Alta: "critical",
  Média: "attention",
  Baixa: "neutral",
};

function Acoes({ items }: { items: AcaoCard[] }) {
  if (items.length === 0) return null;
  return (
    <section style={{ breakInside: "avoid" }}>
      <SectionTitle>Ações Recomendadas</SectionTitle>
      <div className="opr-cards-2" style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
        {items.map((acao, i) => (
          <div key={i} style={{ ...panelStyle, padding: 14 }}>
            <div
              style={{
                fontSize: 9,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                fontWeight: 700,
                color: C.tertiary,
                marginBottom: 6,
              }}
            >
              Ação Recomendada
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.4, color: C.ink, marginBottom: 10 }}>
              {acao.acao}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
              <SevBadge sev={IMPACTO_SEV[acao.impacto]}>Impacto: {acao.impacto}</SevBadge>
              <SevBadge sev={URGENCIA_SEV[acao.urgencia]}>Urgência: {acao.urgencia}</SevBadge>
            </div>
            <div style={{ fontSize: 11, color: C.sub }}>
              Área: <span style={{ fontWeight: 600, color: C.body }}>{acao.area}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── Quadro de eventos — EXCLUSIVO da Feat Produções ─────────────────────────
//
// Duas caixas acumuladas consolidam resultado previsto/realizado e volume de
// eventos, seguidas de dois gráficos de barras por tipo de evento: "Resultado
// dos Eventos" (somente realizado, conforme decisão de produto) e "Número de
// Eventos" (apenas eventos com fechamento Realizado). Valores em R$ cheios.

function fmtMoneyInt(value: number): string {
  return `R$ ${Math.round(value).toLocaleString("pt-BR", {
    maximumFractionDigits: 0,
  })}`;
}

function fmtMoneyFull(value: number): string {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function moneyTooltipFormatter(value: unknown): string {
  if (value === null || value === undefined) return "—";
  const n = Number(value);
  return Number.isFinite(n) ? fmtMoneyFull(n) : "—";
}

function fmtPctPtBr(value: number): string {
  return `${value.toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

function FeatIndicador({
  label,
  valueLabel,
  meta,
  hint,
  footer,
}: {
  label: string;
  valueLabel: string;
  meta?: React.ReactNode;
  hint?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div style={{ ...panelStyle, padding: 14 }}>
      <div
        style={{
          fontSize: 10,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          fontWeight: 600,
          color: C.sub,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 22,
          fontWeight: 600,
          color: C.ink,
          margin: "10px 0 4px",
        }}
      >
        {valueLabel}
      </div>
      {meta ? (
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: C.ink,
            marginBottom: 6,
          }}
        >
          {meta}
        </div>
      ) : null}
      {hint ? (
        <div style={{ fontSize: 11, color: C.tertiary, lineHeight: 1.55 }}>
          {hint}
        </div>
      ) : null}
      {footer ? (
        <div style={{ fontSize: 11, color: C.tertiary, marginTop: 4 }}>
          {footer}
        </div>
      ) : null}
    </div>
  );
}

function QuadroEventosFeat({
  data,
  accent,
}: {
  data: FeatEventosBlock;
  accent: string;
}) {
  const resultadoData = data.resultadoPorTipo.map((r) => ({
    tipo: r.tipo,
    Realizado: r.realizado,
    label: fmtMoneyInt(r.realizado),
  }));
  const numeroData = data.numeroEventosRealizadosPorTipo.map((n) => ({
    tipo: n.tipo,
    Eventos: n.quantidade,
  }));

  return (
    <section style={{ breakInside: "avoid" }}>
      <SectionTitle>Eventos — Feat Produções</SectionTitle>

      {/* Indicadores acumulados até a referência */}
      <div
        className="opr-cards-2"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: 12,
          marginBottom: 12,
        }}
      >
        <FeatIndicador
          label="Resultado total previsto"
          valueLabel={fmtMoneyFull(data.totalPrevisto)}
          meta={`Número de eventos previstos: ${data.eventosPrevistosOrcamento}`}
          footer={`Acumulado até ${data.referenciaLabel}`}
        />
        <FeatIndicador
          label="Resultado total realizado"
          valueLabel={fmtMoneyFull(data.totalRealizado)}
          meta={`Número de eventos realizados: ${data.eventosRealizadosPeriodo}`}
          hint={
            <>
              {data.eventosRealizados} fechamentos realizado(s) ·{" "}
              {data.eventosEmAberto} fechamentos em aberto
            </>
          }
          footer={`Acumulado até ${data.referenciaLabel}`}
        />
      </div>

      {/* Gráficos por tipo de evento */}
      <div
        className="opr-charts-2"
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}
      >
        {/* Gráfico 1: Resultado dos Eventos (somente realizado) por tipo */}
        <div style={panelStyle}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.ink, marginBottom: 2 }}>
            Resultado dos Eventos
          </div>
          <div style={{ fontSize: 10, color: C.sub, marginBottom: 6 }}>
            Resultado realizado acumulado por tipo de evento.
          </div>
          <div style={{ height: 220, width: "100%" }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={resultadoData} margin={{ top: 22, right: 12, bottom: 6, left: -6 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false} />
                <XAxis
                  dataKey="tipo"
                  tick={{ fontSize: 10, fill: C.sub }}
                  axisLine={{ stroke: C.grid }}
                  tickLine={false}
                />
                <YAxis tick={{ fontSize: 10, fill: C.sub }} width={44} axisLine={false} tickLine={false} />
                <Tooltip
                  cursor={{ fill: "rgba(31,111,214,0.06)" }}
                  contentStyle={TOOLTIP_CONTENT_STYLE}
                  labelStyle={TOOLTIP_LABEL_STYLE}
                  itemStyle={TOOLTIP_ITEM_STYLE}
                  formatter={(value) => moneyTooltipFormatter(value)}
                />
                <Bar dataKey="Realizado" fill={accent} radius={[3, 3, 0, 0]} barSize={46} isAnimationActive={false}>
                  <LabelList dataKey="label" position="top" style={{ fontSize: 9, fill: accent, fontWeight: 700 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Gráfico 2: Número de Eventos realizados por tipo */}
        <div style={panelStyle}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.ink, marginBottom: 2 }}>
            Número de Eventos
          </div>
          <div style={{ fontSize: 10, color: C.sub, marginBottom: 6 }}>
            Eventos com fechamento realizado, por tipo.
          </div>
          <div style={{ height: 220, width: "100%" }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={numeroData} margin={{ top: 22, right: 12, bottom: 6, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false} />
                <XAxis
                  dataKey="tipo"
                  tick={{ fontSize: 10, fill: C.sub }}
                  axisLine={{ stroke: C.grid }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: C.sub }}
                  width={28}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  cursor={{ fill: "rgba(31,111,214,0.06)" }}
                  contentStyle={TOOLTIP_CONTENT_STYLE}
                  labelStyle={TOOLTIP_LABEL_STYLE}
                  itemStyle={TOOLTIP_ITEM_STYLE}
                />
                <Bar dataKey="Eventos" fill={accent} radius={[3, 3, 0, 0]} barSize={46} isAnimationActive={false}>
                  <LabelList dataKey="Eventos" position="top" style={{ fontSize: 10, fill: accent, fontWeight: 700 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Fechamentos em aberto — lista + projeção gerencial */}
      <FechamentosEmAberto data={data} />
    </section>
  );
}

// Quadro "Custódia de Artistas — Saldo Final" (EXCLUSIVO Case Shows). Mostra os
// dois saldos de fechamento já calculados na tela de Fluxo de Caixa, no mês de
// referência: regime de caixa (por data de pagamento) e regime de competência
// (por data de registro). Valores em R$ cheios.
// Cor semântica de cada faixa de aging: quanto mais vencido, mais crítico.
function agingSev(faixa: string): SevKey {
  if (faixa === "A vencer") return "neutral";
  if (faixa === "1 a 30 dias" || faixa === "31 a 60 dias") return "attention";
  return "critical";
}

function QuadroContasReceberFeat({ data }: { data: FeatContasReceberAbertoBlock }) {
  const pctAtrasoLabel = fmtPctPtBr(data.percentualEmAtraso);
  const resumo: Array<{ label: string; value: string; hint?: string; sev?: SevKey }> = [
    {
      label: "Total em aberto",
      value: fmtMoneyFull(data.totalEmAberto),
      hint: `${data.titulosEmAberto} títulos · ${data.clientesEmAberto} clientes`,
    },
    {
      label: "Total em atraso",
      value: fmtMoneyFull(data.totalEmAtraso),
      hint: `${pctAtrasoLabel} do aberto`,
      sev: data.totalEmAtraso > 0 ? "critical" : "neutral",
    },
  ];

  const maxAging = Math.max(1, ...data.aging.map((b) => b.valor));

  const th: CSSProperties = {
    fontSize: 9,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    fontWeight: 600,
    color: C.sub,
    padding: "7px 8px",
    borderBottom: `1px solid ${C.cardBorder}`,
    whiteSpace: "nowrap",
  };
  const td: CSSProperties = {
    fontSize: 10.5,
    color: C.body,
    padding: "7px 8px",
    borderBottom: `1px solid ${C.grid}`,
    verticalAlign: "middle",
  };

  const vazio = data.clientesEmAberto === 0;

  return (
    <section style={{ breakInside: "avoid" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <SectionTitle>Contas a receber em aberto — Feat Produções</SectionTitle>
        </div>
        {data.detalhes.length > 0 ? (
          <button
            type="button"
            onClick={() =>
              downloadFeatContasReceberXlsx(data.detalhes, {
                referenciaLabel: data.referenciaLabel,
              })
            }
            // Ignora este botão na captura do PDF (html2canvas) — é interativo,
            // não faz parte do documento impresso.
            data-html2canvas-ignore="true"
            data-export-hide="true"
            title="Baixa uma planilha (.xlsx) com todos os títulos que compõem os valores em aberto e em atraso."
            style={{
              flexShrink: 0,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              marginBottom: 14,
              padding: "6px 12px",
              borderRadius: 7,
              border: `1px solid ${C.cardBorder}`,
              background: C.cardBg,
              color: C.body,
              fontSize: 10.5,
              fontWeight: 600,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            ↓ Exportar detalhamento (.xlsx)
          </button>
        ) : null}
      </div>
      <div style={{ fontSize: 10, color: C.sub, marginTop: -4, marginBottom: 8 }}>
        Saldo em aberto dos títulos da Feat na Omie (líquido de recebimentos parciais),
        filtrado pelos departamentos selecionados e consolidado por cliente e faixa de
        atraso. Use “Exportar detalhamento” para a planilha título a título.
      </div>

      {/* Resumo — indicadores principais */}
      <div
        className="opr-cards-2"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: 8,
          marginBottom: 10,
        }}
      >
        {resumo.map((item) => (
          <div key={item.label} style={{ ...panelStyle, padding: "10px 12px" }}>
            <div
              style={{
                fontSize: 9,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                fontWeight: 600,
                color: C.sub,
              }}
            >
              {item.label}
            </div>
            <div
              style={{
                fontFamily: FONT_MONO,
                fontSize: 15,
                fontWeight: 700,
                color: item.sev === "critical" ? SEV.critical.text : C.ink,
                marginTop: 6,
                whiteSpace: "nowrap",
              }}
            >
              {item.value}
            </div>
            {item.hint ? (
              <div style={{ fontSize: 9.5, color: C.sub, marginTop: 2 }}>{item.hint}</div>
            ) : null}
          </div>
        ))}
      </div>

      {vazio ? (
        <div style={{ ...panelStyle, padding: 14, fontSize: 11.5, color: C.body }}>
          Não há contas a receber em aberto nos departamentos selecionados da Feat.
        </div>
      ) : (
        <div
          className="opr-cards-2"
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 0.9fr) minmax(0, 1.1fr)",
            gap: 10,
            alignItems: "start",
          }}
        >
          {/* Aging — faixas de atraso */}
          <div style={{ ...panelStyle, padding: "12px 14px" }}>
            <div
              style={{
                fontSize: 9,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                fontWeight: 700,
                color: C.sub,
                marginBottom: 10,
              }}
            >
              Faixas de atraso
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {data.aging.map((b) => {
                const tone = SEV[agingSev(b.faixa)];
                const width = b.valor > 0 ? Math.max(3, (b.valor / maxAging) * 100) : 0;
                return (
                  <div key={b.faixa}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "baseline",
                        marginBottom: 3,
                        gap: 8,
                      }}
                    >
                      <span style={{ fontSize: 10, color: C.body, fontWeight: 600 }}>
                        {b.faixa}
                      </span>
                      <span
                        style={{
                          fontFamily: FONT_MONO,
                          fontSize: 10,
                          color: C.ink,
                          fontWeight: 600,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {fmtMoneyFull(b.valor)}
                        <span style={{ color: C.sub, fontWeight: 400 }}> · {b.titulos}</span>
                      </span>
                    </div>
                    <div
                      style={{
                        height: 7,
                        borderRadius: 999,
                        background: C.grid,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${width}%`,
                          height: "100%",
                          borderRadius: 999,
                          background: tone.text,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Ranking por cliente */}
          <div style={{ ...panelStyle, padding: 0, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign: "left", width: "40%" }}>Cliente</th>
                  <th style={{ ...th, textAlign: "right", width: "22%" }}>Em aberto</th>
                  <th style={{ ...th, textAlign: "right", width: "22%" }}>Em atraso</th>
                  <th style={{ ...th, textAlign: "center", width: "16%" }}>Atraso</th>
                </tr>
              </thead>
              <tbody>
                {data.clientes.map((c, index) => {
                  const emAtraso = c.valorEmAtraso > 0;
                  return (
                    <tr key={`${c.cliente}-${index}`}>
                      <td style={{ ...td, fontWeight: 600, color: C.ink }}>
                        <span
                          style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis" }}
                          title={c.cliente}
                        >
                          {c.cliente}
                        </span>
                        <span style={{ fontSize: 9, color: C.sub, fontWeight: 400 }}>
                          {c.titulos} {c.titulos === 1 ? "título" : "títulos"}
                        </span>
                      </td>
                      <td
                        style={{
                          ...td,
                          fontFamily: FONT_MONO,
                          textAlign: "right",
                          whiteSpace: "nowrap",
                          color: C.ink,
                          fontWeight: 600,
                        }}
                      >
                        {fmtMoneyFull(c.valorEmAberto)}
                      </td>
                      <td
                        style={{
                          ...td,
                          fontFamily: FONT_MONO,
                          textAlign: "right",
                          whiteSpace: "nowrap",
                          color: emAtraso ? SEV.critical.text : C.sub,
                          fontWeight: emAtraso ? 700 : 400,
                        }}
                      >
                        {emAtraso ? fmtMoneyFull(c.valorEmAtraso) : "—"}
                      </td>
                      <td style={{ ...td, textAlign: "center" }}>
                        {emAtraso ? (
                          <span
                            style={{
                              display: "inline-block",
                              borderRadius: 999,
                              border: `1px solid ${SEV.critical.border}`,
                              background: SEV.critical.bg,
                              color: SEV.critical.text,
                              fontSize: 9.5,
                              fontWeight: 700,
                              padding: "3px 7px",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {c.diasAtrasoMax}d
                          </span>
                        ) : (
                          <span style={{ fontSize: 9.5, color: C.sub }}>em dia</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {data.clientesTotais > data.clientesExibidos ? (
              <div
                style={{
                  padding: "7px 10px",
                  fontSize: 10,
                  color: C.sub,
                  borderTop: `1px solid ${C.grid}`,
                }}
              >
                + {data.clientesTotais - data.clientesExibidos} outros clientes ·{" "}
                {fmtMoneyFull(data.restanteValor)} em aberto. Ranking pelos maiores valores em atraso.
              </div>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}

function QuadroCustodiaCaseShows({ data }: { data: CustodyClosingBlock }) {
  return (
    <section style={{ breakInside: "avoid" }}>
      <SectionTitle>Custódia de Artistas — Saldo Final</SectionTitle>
      <div
        className="opr-cards-2"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: 12,
        }}
      >
        <FeatIndicador
          label="Saldo final — regime de caixa"
          valueLabel={fmtMoneyFull(data.saldoFinalCaixa)}
          hint={`Por data de pagamento · ${data.referenciaLabel}`}
        />
        <FeatIndicador
          label="Saldo final — regime de competência"
          valueLabel={
            data.saldoFinalCompetencia === null
              ? "—"
              : fmtMoneyFull(data.saldoFinalCompetencia)
          }
          hint={`Por data de registro · ${data.referenciaLabel}`}
        />
      </div>
    </section>
  );
}

// Quadro COMPARATIVO das empresas da holding (EXCLUSIVO da Hero Holding). Uma
// linha por unidade Viva do grupo; colunas = os indicadores individuais que
// foram removidos do topo do relatório da holding, agora POR EMPRESA. Destaca a
// melhor empresa de cada coluna (verde) e a maior inadimplência (âmbar), para
// leitura de portfólio rápida. Não polui: um único highlight por coluna.
function QuadroComparativoHolding({ data }: { data: HoldingComparativoBlock }) {
  type ColKind = "money" | "months" | "pct" | "pctMeta";
  interface Col {
    key: keyof HoldingComparativoRow;
    label: string;
    kind: ColKind;
    // Quando true, destaca a MELHOR (verde) e a PIOR (vermelho) franquia da
    // coluna — todas essas colunas são "quanto maior, melhor". Ausência = coluna
    // SEM destaque (ex.: inadimplência).
    destacaMelhorPior?: boolean;
  }

  // Todas as colunas comparáveis são "quanto maior, melhor". Inadimplência NÃO
  // recebe destaque.
  const cols: Col[] = [
    { key: "pctMetaAnualVvrAcumulada", label: "% meta anual (acum.)", kind: "pctMeta", destacaMelhorPior: true },
    { key: "pctMetaVvrMes", label: "% meta do mês", kind: "pctMeta", destacaMelhorPior: true },
    { key: "pctFeeDisponivel", label: "% FEE disp.", kind: "pctMeta", destacaMelhorPior: true },
    { key: "sobrevivenciaCaixaMeses", label: "Sobrev. caixa", kind: "months", destacaMelhorPior: true },
    { key: "margemMediaEventos", label: "Margem média", kind: "pct", destacaMelhorPior: true },
    { key: "inadimplenciaAtual", label: "Inadimplência", kind: "money" },
  ];

  // Índices da MELHOR (maior valor → verde) e da PIOR (menor valor → vermelho)
  // franquia por coluna. Só destaca quando há pelo menos 2 empresas com valor e
  // valores distintos (senão melhor = pior e não faz sentido comparar). Valores
  // nulos ("—") ficam de fora do cálculo e nunca são destacados.
  const destaqueByCol = cols.map((col) => {
    if (!col.destacaMelhorPior) return { best: -1, worst: -1 };
    let best = -1;
    let worst = -1;
    let bestVal = -Infinity;
    let worstVal = Infinity;
    let count = 0;
    data.empresas.forEach((e, i) => {
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
    // Menos de 2 valores, ou todos iguais → não destaca nada.
    if (count < 2 || bestVal === worstVal) return { best: -1, worst: -1 };
    return { best, worst };
  });

  // % de atingimento da meta com 2 casas (ex.: "85,15%") — leitura clara do
  // gap contra a meta de cada franquia.
  const fmtPctMeta = (v: number): string =>
    `${v.toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}%`;

  const fmt = (v: number | null, kind: ColKind): string => {
    if (v === null || v === undefined) return "—";
    if (kind === "money") return fmtMoneyInt(v);
    if (kind === "pctMeta") return fmtPctMeta(v);
    if (kind === "pct") return fmtPctPtBr(v);
    return `${v} ${v === 1 ? "mês" : "meses"}`;
  };

  const th: CSSProperties = {
    fontSize: 9,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    fontWeight: 600,
    color: C.sub,
    padding: "6px 8px",
    borderBottom: `1px solid ${C.cardBorder}`,
    whiteSpace: "nowrap",
  };
  const td: CSSProperties = {
    fontSize: 10.5,
    fontFamily: FONT_MONO,
    color: C.body,
    padding: "6px 8px",
    textAlign: "right",
    whiteSpace: "nowrap",
    borderBottom: `1px solid ${C.grid}`,
  };

  return (
    <section style={{ breakInside: "avoid" }}>
      <SectionTitle>{data.title}</SectionTitle>
      <div style={{ fontSize: 10, color: C.sub, marginTop: -4, marginBottom: 8 }}>
        Referência {data.referenciaLabel} · comparativo das {data.empresas.length}{" "}
        empresas do grupo · <span style={{ color: SEV.positive.text }}>■</span> melhor
        · <span style={{ color: SEV.critical.text }}>■</span> pior
      </div>
      <div style={{ ...panelStyle, padding: 0, overflow: "hidden" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            tableLayout: "fixed",
          }}
        >
          <thead>
            <tr>
              <th style={{ ...th, textAlign: "left", width: "20%" }}>Empresa</th>
              {cols.map((c) => (
                <th key={c.key} style={{ ...th, textAlign: "right" }}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.empresas.map((e, rowIdx) => (
              <tr key={e.empresa}>
                <td
                  style={{
                    fontSize: 10.5,
                    fontWeight: 600,
                    color: C.ink,
                    padding: "6px 8px",
                    textAlign: "left",
                    borderBottom: `1px solid ${C.grid}`,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {e.empresa}
                </td>
                {cols.map((c, colIdx) => {
                  const v = e[c.key] as number | null;
                  // Destaca só a MELHOR (verde) e a PIOR (vermelho) franquia da
                  // coluna. Inadimplência e valores nulos nunca são destacados.
                  const { best, worst } = destaqueByCol[colIdx];
                  const tone =
                    rowIdx === best
                      ? SEV.positive
                      : rowIdx === worst
                        ? SEV.critical
                        : null;
                  return (
                    <td
                      key={c.key}
                      style={{
                        ...td,
                        ...(tone
                          ? {
                              background: tone.bg,
                              color: tone.text,
                              fontWeight: 700,
                            }
                          : null),
                      }}
                    >
                      {fmt(v, c.kind)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// Quadro de indicadores por conta DRE (EXCLUSIVO de templates que o configuram,
// ex.: Terrazzo — "Locação de Espaço": Formaturas / Shows-Palestras). Mostra o
// realizado de cada conta no mês de referência. Valores em R$ cheios.
function QuadroIndicadoresDre({ data }: { data: DreIndicatorsBlock }) {
  return (
    <section style={{ breakInside: "avoid" }}>
      <SectionTitle>{data.title}</SectionTitle>
      <div
        className="opr-cards-2"
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${Math.min(data.items.length, 2)}, 1fr)`,
          gap: 12,
        }}
      >
        {data.items.map((item) => (
          <FeatIndicador
            key={item.label}
            label={item.label}
            valueLabel={fmtMoneyFull(item.value)}
            hint={`Realizado · ${data.referenciaLabel}`}
          />
        ))}
      </div>
    </section>
  );
}

function FechamentosEmAberto({ data }: { data: FeatEventosBlock }) {
  const temAberto = data.eventosEmAbertoDetalhe.length > 0;

  return (
    <div style={{ ...panelStyle, marginTop: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: C.ink, marginBottom: 2 }}>
        Fechamentos em aberto
      </div>
      <div style={{ fontSize: 10, color: C.sub, marginBottom: temAberto ? 10 : 0 }}>
        Eventos realizados sem fechamento concluído até {data.referenciaLabel}.
      </div>

      {!temAberto ? (
        <div style={{ fontSize: 12, color: C.body, marginTop: 6 }}>
          Não há eventos com fechamento em aberto até o período selecionado.
        </div>
      ) : (
        <>
          {/* Lista de eventos em aberto */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
            {data.eventosEmAbertoDetalhe.map((ev, i) => (
              <div
                key={`${ev.projeto}-${i}`}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  gap: 12,
                  padding: "7px 10px",
                  borderRadius: 6,
                  border: `1px solid ${C.grid}`,
                  background: "#fafafa",
                }}
              >
                <span style={{ fontSize: 12.5, fontWeight: 600, color: C.ink }}>
                  {ev.projeto}
                </span>
                <span style={{ fontSize: 11, color: C.sub, whiteSpace: "nowrap" }}>
                  Resultado previsto:{" "}
                  <span style={{ fontFamily: FONT_MONO, color: C.body, fontWeight: 600 }}>
                    {fmtMoneyFull(ev.resultadoPrevisto)}
                  </span>
                </span>
              </div>
            ))}
          </div>

          {/* Projeção gerencial */}
          <div
            style={{
              border: `1px solid ${SEV.attention.border}`,
              background: SEV.attention.bg,
              borderRadius: 8,
              padding: 12,
            }}
          >
            <ProjecaoLinha
              label="Resultado acumulado atual"
              valueLabel={fmtMoneyFull(data.resultadoAcumuladoAtual)}
            />
            <ProjecaoLinha
              label="Resultado previsto em fechamentos em aberto"
              valueLabel={`+ ${fmtMoneyFull(data.previstoEmAbertoTotal)}`}
            />
            <div style={{ height: 1, background: SEV.attention.border, margin: "8px 0" }} aria-hidden />
            <ProjecaoLinha
              label="Resultado acumulado projetado"
              valueLabel={fmtMoneyFull(data.resultadoAcumuladoProjetado)}
              strong
            />
            {data.percentualAtingimentoProjecao !== null ? (
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  gap: 12,
                  marginTop: 4,
                }}
              >
                <span style={{ fontSize: 10.5, color: C.sub }}>
                  {data.resultadoAcumuladoPrevistoOrcamento !== null
                    ? `Orçado acumulado: ${fmtMoneyFull(data.resultadoAcumuladoPrevistoOrcamento)}`
                    : ""}
                </span>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: SEV.attention.text, whiteSpace: "nowrap" }}>
                  {fmtPctPtBr(data.percentualAtingimentoProjecao)} do orçamento
                </span>
              </div>
            ) : null}
            <p style={{ margin: "10px 0 0", fontSize: 10.5, lineHeight: 1.5, color: C.body }}>
              Projeção baseada no resultado previsto dos eventos com fechamento em
              aberto. O valor não representa resultado realizado e depende da
              apuração da margem e da conclusão do fechamento para ser confirmado.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function ProjecaoLinha({
  label,
  valueLabel,
  strong,
}: {
  label: string;
  valueLabel: string;
  strong?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        gap: 12,
        padding: "2px 0",
      }}
    >
      <span
        style={{
          fontSize: strong ? 12.5 : 11.5,
          fontWeight: strong ? 700 : 500,
          color: strong ? C.ink : C.body,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: FONT_MONO,
          fontSize: strong ? 14 : 12,
          fontWeight: strong ? 700 : 600,
          color: strong ? SEV.attention.text : C.body,
          whiteSpace: "nowrap",
        }}
      >
        {valueLabel}
      </span>
    </div>
  );
}

// ─── Componente raiz ──────────────────────────────────────────────────────────

interface OnePageReportPreviewProps {
  data?: OnePageReportPreviewData;
  /** Cor de destaque configurável. Default: #1f6fd6. */
  accentColor?: string;
}

export function OnePageReportPreview({
  data = MOCK_DATA,
  accentColor = DEFAULT_ACCENT,
}: OnePageReportPreviewProps) {
  // Visibilidade por template: sem `blocks`, mostra TUDO (Franquias Viva
  // permanece byte-idêntico). Com `blocks` (ex.: SGX), só os listados — VVR,
  // Acumulado, Composição e Semáforo simplesmente não existem no relatório.
  const show = (block: string) => !data.blocks || data.blocks.includes(block);
  const showSemaforo = show("semaforo");
  const showVvr = show("vvrSerie");
  const showHistorico = show("historico");
  const showTendencia = showVvr || showHistorico;

  // KPIs de saúde/caixa = todos exceto os 4 operacionais (que alimentam a
  // tabela e o resumo). Ordem preservada pelo mapper. Em templates custom
  // (ex.: SGX) nenhum card casa os operacionais → todos entram aqui.
  const operacionais = new Set(["receita", "despesas", "resultado", "margem"]);
  const saudeKpis = data.kpis.filter((k) => !operacionais.has(k.label.toLowerCase()));

  return (
    <div className="opr-page" style={{ background: C.pageBg, padding: 20 }}>
      <article
        className="one-page-report"
        style={{
          maxWidth: 880,
          margin: "0 auto",
          background: C.cardBg,
          border: `1px solid ${C.cardBorder}`,
          borderRadius: 7,
          boxShadow: "0 16px 50px rgba(20,25,31,.06)",
          padding: "34px 38px 32px",
          fontFamily: FONT_SANS,
          color: C.body,
          display: "flex",
          flexDirection: "column",
          gap: 22,
        }}
      >
        <Header data={data.cabecalho} />
        {show("diagnostico") ? (
          <ResumoExecutivo data={data} accent={accentColor} showSemaforo={showSemaforo} />
        ) : null}

        {/* Comparativo das empresas da holding — exclusivo da Hero Holding (gated
            por bloco + presença de dados). É o CENTRO do relatório da holding:
            aparece logo após o resumo executivo, substituindo a leitura de
            franquia individual por uma visão comparativa das unidades do grupo. */}
        {data.holdingComparativo && show(data.holdingComparativo.key) ? (
          <QuadroComparativoHolding data={data.holdingComparativo} />
        ) : null}

        {show("previstoRealizado") ? (
          <TabelaDesempenho
            items={data.previstoRealizado}
            semaforo={showSemaforo ? data.semaforo : []}
          />
        ) : null}
        <KpisSaude kpis={saudeKpis} columns={data.kpiColumns} title={data.kpiSectionTitle} />

        {/* Quadro de eventos — exclusivo da Feat Produções (gated por bloco +
            presença de dados). Eventos são a principal fonte de receita da Feat,
            por isso aparece em destaque, logo após os indicadores do mês. */}
        {show("featEventos") && data.featEventos ? (
          <QuadroEventosFeat data={data.featEventos} accent={accentColor} />
        ) : null}

        {/* Saldo final da Custódia de Artistas — exclusivo da Case Shows (gated
            por bloco + presença de dados). Mostra os dois saldos de fechamento
            (caixa e competência) já calculados na tela de Fluxo de Caixa. */}
        {show("featEventos") && data.featContasReceberAberto ? (
          <QuadroContasReceberFeat data={data.featContasReceberAberto} />
        ) : null}

        {show("custodyClosing") && data.custodyClosing ? (
          <QuadroCustodiaCaseShows data={data.custodyClosing} />
        ) : null}

        {/* Indicadores por conta DRE — exclusivo de templates que o configuram
            (ex.: Terrazzo — "Locação de Espaço": Formaturas / Shows-Palestras).
            Gated pela `key` do bloco na allowlist + presença de dados. */}
        {data.indicadoresDre && show(data.indicadoresDre.key) ? (
          <QuadroIndicadoresDre data={data.indicadoresDre} />
        ) : null}

        {/* Performance por Parceiro — exclusivo da Young Med (gated por bloco +
            presença de dados). Realizado por fornecedor da conta de BVs, mês +
            acumulado. Logo após os indicadores, antes da tendência. */}
        {show("performancePorParceiro") && data.partnerPerformance ? (
          <PartnerPerformanceBlock data={data.partnerPerformance} />
        ) : null}

        {/* Blocos de breakdown em barras (ex.: Spot — composição da receita,
            frete). Cada bloco é gated por sua `key` na allowlist + presença de
            dados. undefined/[] nos demais templates → nada renderiza. */}
        {(data.breakdownBlocks ?? [])
          .filter((b) => show(b.key))
          .map((b) => (
            <BreakdownBars key={b.key} data={b} />
          ))}

        {/* Tendência & Acumulado: Acumulado + Resultado lado a lado; VVR sozinho
            em linha cheia abaixo (evita o aperto do VVR quando o ano avança).
            Cada gráfico continua condicionado à allowlist de blocos do template. */}
        {show("acumuladoAno") || showTendencia ? (
          <section>
            <SectionTitle>Tendência & Acumulado</SectionTitle>
            {show("acumuladoAno") || showHistorico ? (
              <div
                className="opr-charts-2"
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    show("acumuladoAno") && showHistorico ? "1fr 1fr" : "1fr",
                  gap: 12,
                }}
              >
                {show("acumuladoAno") ? (
                  <GraficoAcumulado items={data.acumuladoAno} accent={accentColor} />
                ) : null}
                {showHistorico ? (
                  <GraficoResultado
                    points={data.historico}
                    accent={accentColor}
                    title={data.historicoTitle}
                    kLabels={data.historicoKLabels}
                    acum={data.historicoAcum}
                  />
                ) : null}
              </div>
            ) : null}
            {showVvr ? (
              <>
                {show("acumuladoAno") || showHistorico ? <div style={{ height: 12 }} /> : null}
                <GraficoVVR points={data.vvrSerieAnual} accent={accentColor} />
              </>
            ) : null}
          </section>
        ) : null}

        {/* Gráficos extras por template (ex.: Village): colunas (acum. do ano)
            + linhas (6 meses) EMPILHADOS (um abaixo do outro — lado a lado
            ficava pequeno). Cada card traz seu acumulado do ano embaixo. Só
            existem quando o template os configura (Viva/SGX inalterados). */}
        {data.barsSerie || data.linesSerie ? (
          <section>
            <SectionTitle>Evolução</SectionTitle>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {data.barsSerie ? (
                <GraficoBarras
                  points={data.barsSerie}
                  title={data.barsTitle ?? "Histórico"}
                  acum={data.barsAcum}
                />
              ) : null}
              {data.linesSerie ? (
                <GraficoLinhasMulti
                  points={data.linesSerie}
                  seriesLabels={data.linesSeriesLabels ?? []}
                  title={data.linesTitle ?? "Resultado"}
                  accent={accentColor}
                  acum={data.linesAcum}
                  acumBaseIndex={data.linesAcumBaseIndex}
                />
              ) : null}
            </div>
          </section>
        ) : null}

        {/* Gráficos Previsto × Realizado por frente (ex.: SGX Locações/Projetos):
            colunas mensais (Jan→análise) + acumulado do ano. Empilhados. Só
            existem quando o template os configura (Viva/Village inalterados). */}
        {data.prevRealCharts && data.prevRealCharts.length > 0 ? (
          <section>
            <SectionTitle>Previsto × Realizado por frente</SectionTitle>
            {/* Lado a lado, cada um com metade da largura (colapsa p/ 1 col no
                mobile via .opr-charts-2). */}
            <div
              className="opr-charts-2"
              style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}
            >
              {data.prevRealCharts.map((c, i) => (
                <GraficoBarrasPrevReal
                  key={i}
                  title={c.title}
                  serie={c.serie}
                  previstoAcum={c.previstoAcum}
                  realizadoAcum={c.realizadoAcum}
                  accent={accentColor}
                />
              ))}
            </div>
          </section>
        ) : null}

        {/* Bloco CONSOLIDADO do grupo (ex.: Salvaterra) — complementar. Só
            existe quando o template define consolidatedGroup (demais inalterados). */}
        {data.consolidated ? <ConsolidadoBlock data={data.consolidated} /> : null}

        {show("alertas") ? <Alertas items={data.alertas} /> : null}
        {show("acoes") ? <Acoes items={data.acoes} /> : null}

        <footer
          style={{
            marginTop: 4,
            paddingTop: 14,
            borderTop: `1px solid ${C.rule}`,
            display: "flex",
            justifyContent: "space-between",
            fontSize: 11,
            color: C.tertiary,
          }}
        >
          <span>{data.cabecalho.empresa}</span>
          <span>{data.cabecalho.periodo}</span>
        </footer>
      </article>
    </div>
  );
}
