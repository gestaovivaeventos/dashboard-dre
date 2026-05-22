"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Minus,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// ============================================================================
// Componente de PREVIEW do One Page Report.
//
// Esta versao usa dados MOCKADOS para validar layout, hierarquia visual e
// fluxo de leitura — nao chama IA, nao consome OPENAI_API_KEY, nao consulta
// banco. Quando o componente for plugado a dados reais, basta passar a prop
// `data` (com o shape OnePageReportPreviewData) em vez de usar o default.
// ============================================================================

// ─── Tipos ─────────────────────────────────────────────────────────────────

type StatusGeral = "Excelente" | "Boa" | "Atenção" | "Crítica";
type ImpactSign = "Positivo" | "Atenção" | "Neutro" | "Crítico";

export interface KpiCard {
  label: string;
  value: string;
  variation: string;
  sign: ImpactSign;
  // Algumas variacoes (margem) sao em p.p. — sufixo opcional explicito.
  variationSuffix?: string;
  // Quando true, o card NAO concatena " vs <comparisonLabel>" no final.
  // Usado para KPIs que nao tem comparacao — ex.: FEE Disponível, que e
  // um saldo e mostra apenas "Saldo atual".
  omitComparisonSuffix?: boolean;
  // Palavra usada no sufixo " vs X". Default "orçamento". VVR usa "meta".
  comparisonLabel?: string;
}

export interface PrevistoRealizadoItem {
  indicador: string;
  realizado: number;
  previsto: number;
  // Unidade do valor — usada para formatacao nos rotulos do grafico.
  unidade: "mil" | "%";
}

export interface ComposicaoStep {
  label: string;
  valueLabel: string;
  // Direcao para visual (entrada = receita; saida = custo/despesa; final = resultado)
  kind: "entrada" | "saida" | "final";
}

export interface HistoricoPoint {
  mes: string;
  // null preserva a ausencia de dado (recharts desenha gap na linha).
  // Nunca masquaramos ausencia com 0.
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
}

// ─── Dados mockados (default) ─────────────────────────────────────────────

const MOCK_DATA: OnePageReportPreviewData = {
  cabecalho: {
    empresa: "Viva Petrópolis",
    periodo: "Abril/2026",
    geradoEm: "21/05/2026",
    statusGeral: "Boa",
    notaGeral: 78,
  },
  kpis: [
    { label: "Receita", value: "R$ 118,9 mil", variation: "+8,1%", sign: "Positivo" },
    { label: "Resultado", value: "R$ 25,9 mil", variation: "+3,8%", sign: "Positivo" },
    { label: "Margem", value: "22,7%", variation: "-0,8", variationSuffix: "p.p.", sign: "Atenção" },
    { label: "FEE disponível", value: "R$ 7,0 mil", variation: "Saldo atual", sign: "Neutro", omitComparisonSuffix: true },
    { label: "VVR", value: "R$ 180 mil", variation: "+9,1%", sign: "Positivo", comparisonLabel: "meta" },
  ],
  previstoRealizado: [
    { indicador: "Receita", realizado: 118.9, previsto: 110.0, unidade: "mil" },
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
    { label: "Receita Bruta", valueLabel: "R$ 118,9 mil", kind: "entrada" },
    { label: "Custos", valueLabel: "-R$ 7,3 mil", kind: "saida" },
    { label: "Despesas", valueLabel: "-R$ 85,6 mil", kind: "saida" },
    { label: "Resultado", valueLabel: "R$ 25,9 mil", kind: "final" },
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
    {
      titulo: "Despesas acima do orçamento",
      texto: "+7,0% vs previsto",
      classificacao: "Atenção",
    },
    {
      titulo: "Margem pressionada",
      texto: "-0,8 p.p. vs orçamento",
      classificacao: "Atenção",
    },
    {
      titulo: "Receita acima do orçamento",
      texto: "+8,1% vs previsto",
      classificacao: "Positivo",
    },
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
    {
      acao: "Revisar despesas operacionais",
      impacto: "Alto",
      urgencia: "Alta",
      area: "Financeiro",
    },
    {
      acao: "Monitorar margem nos próximos períodos",
      impacto: "Médio",
      urgencia: "Média",
      area: "Controladoria",
    },
    {
      acao: "Avaliar relação entre VVR e FEE disponível",
      impacto: "Médio",
      urgencia: "Média",
      area: "Comercial / Financeiro",
    },
  ],
};

// ─── Estilo de classificacao (cores semaforicas) ──────────────────────────

interface SignStyle {
  badge: string;
  text: string;
  icon: typeof TrendingUp;
  iconBg: string;
}

const SIGN_STYLES: Record<ImpactSign, SignStyle> = {
  Positivo: {
    badge: "border-emerald-200 bg-emerald-50 text-emerald-700",
    text: "text-emerald-700",
    icon: TrendingUp,
    iconBg: "bg-emerald-100 text-emerald-700",
  },
  Atenção: {
    badge: "border-amber-200 bg-amber-50 text-amber-700",
    text: "text-amber-700",
    icon: AlertTriangle,
    iconBg: "bg-amber-100 text-amber-700",
  },
  Neutro: {
    badge: "border-slate-200 bg-slate-50 text-slate-600",
    text: "text-slate-600",
    icon: Minus,
    iconBg: "bg-slate-100 text-slate-600",
  },
  Crítico: {
    badge: "border-rose-200 bg-rose-50 text-rose-700",
    text: "text-rose-700",
    icon: TrendingDown,
    iconBg: "bg-rose-100 text-rose-700",
  },
};

const STATUS_GERAL_STYLES: Record<StatusGeral, string> = {
  Excelente: "border-emerald-200 bg-emerald-50 text-emerald-700",
  Boa: "border-sky-200 bg-sky-50 text-sky-700",
  "Atenção": "border-amber-200 bg-amber-50 text-amber-700",
  "Crítica": "border-rose-200 bg-rose-50 text-rose-700",
};

// ─── Componentes auxiliares ───────────────────────────────────────────────

function HeaderBlock({ data }: { data: OnePageReportPreviewData["cabecalho"] }) {
  return (
    <Card className="border-slate-200 shadow-sm">
      <CardContent className="flex flex-col gap-4 p-6 md:flex-row md:items-center md:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
            <Sparkles className="h-3.5 w-3.5" />
            One Page Report
          </div>
          <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">
            {data.empresa}
          </h1>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
            <span>
              <span className="font-medium text-slate-700">Período:</span>{" "}
              {data.periodo}
            </span>
            <span className="text-slate-300">•</span>
            <span>
              <span className="font-medium text-slate-700">Gerado em:</span>{" "}
              {data.geradoEm}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className={`rounded-xl border px-4 py-3 text-center ${STATUS_GERAL_STYLES[data.statusGeral]}`}>
            <div className="text-[10px] font-semibold uppercase tracking-wider opacity-80">
              Status Geral
            </div>
            <div className="text-lg font-bold">{data.statusGeral}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-center shadow-sm">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Nota Geral
            </div>
            <div className="text-2xl font-bold text-slate-900">
              {data.notaGeral}
              <span className="ml-0.5 text-base font-medium text-slate-400">/100</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function KpiCardItem({ kpi }: { kpi: KpiCard }) {
  const style = SIGN_STYLES[kpi.sign];
  const Icon = style.icon;
  return (
    <Card className="border-slate-200 shadow-sm transition-shadow hover:shadow-md">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            {kpi.label}
          </span>
          <div className={`rounded-full p-1.5 ${style.iconBg}`}>
            <Icon className="h-3.5 w-3.5" />
          </div>
        </div>
        <div className="text-xl font-bold text-slate-900">{kpi.value}</div>
        <div className={`flex items-center gap-1 text-xs font-medium ${style.text}`}>
          {kpi.sign === "Positivo" ? (
            <ArrowUpRight className="h-3 w-3" />
          ) : kpi.sign === "Crítico" || kpi.variation.startsWith("-") ? (
            <ArrowDownRight className="h-3 w-3" />
          ) : (
            <ArrowRight className="h-3 w-3" />
          )}
          <span>
            {kpi.variation}
            {kpi.variationSuffix ? ` ${kpi.variationSuffix}` : ""}
            {kpi.omitComparisonSuffix
              ? ""
              : ` vs ${kpi.comparisonLabel ?? "orçamento"}`}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function DiagnosticoBlock({ texto }: { texto: string }) {
  return (
    <Card className="border-sky-200 bg-gradient-to-br from-sky-50 to-white shadow-sm">
      <CardContent className="flex gap-3 p-5">
        <div className="rounded-full bg-sky-100 p-2 text-sky-700">
          <Sparkles className="h-4 w-4" />
        </div>
        <div className="space-y-1">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-sky-700">
            Diagnóstico Principal
          </div>
          <p className="text-sm leading-relaxed text-slate-800">{texto}</p>
        </div>
      </CardContent>
    </Card>
  );
}

// Formata o numero conforme a unidade do item para uso em LabelList/Tooltip.
function formatValueWithUnit(value: number, unidade: "mil" | "%"): string {
  if (unidade === "%") {
    return `${value.toLocaleString("pt-BR", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    })}%`;
  }
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  });
}

function PrevistoRealizadoLikeChart({
  title,
  subtitle,
  items,
}: {
  title: string;
  subtitle?: string;
  items: PrevistoRealizadoItem[];
}) {
  // Pre-computamos os rotulos como string no proprio data, com a unidade
  // correta (% ou "mil" via numero puro). LabelList le esses campos via
  // `dataKey` — soluciona a limitacao do `formatter` que nao recebe a row.
  const data = items.map((i) => ({
    indicador: i.indicador,
    Realizado: i.realizado,
    Previsto: i.previsto,
    unidade: i.unidade,
    RealizadoLabel: formatValueWithUnit(i.realizado, i.unidade),
    PrevistoLabel: formatValueWithUnit(i.previsto, i.unidade),
  }));
  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        {subtitle ? (
          <p className="text-xs text-slate-500">{subtitle}</p>
        ) : null}
      </CardHeader>
      <CardContent className="pb-4">
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              layout="vertical"
              margin={{ top: 8, right: 56, bottom: 8, left: 8 }}
              barGap={4}
              barCategoryGap="20%"
            >
              <CartesianGrid horizontal={false} stroke="#e2e8f0" />
              <XAxis type="number" tick={{ fontSize: 11, fill: "#64748b" }} />
              <YAxis
                type="category"
                dataKey="indicador"
                tick={{ fontSize: 12, fill: "#334155" }}
                width={84}
              />
              <Tooltip
                formatter={(value, _name, item) => {
                  const n = Number(value ?? 0);
                  const u = (item?.payload as { unidade?: string } | undefined)?.unidade;
                  if (u === "%") return `${n.toLocaleString("pt-BR")}%`;
                  return `${n.toLocaleString("pt-BR")} mil`;
                }}
                cursor={{ fill: "rgba(148,163,184,0.08)" }}
                contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
              />
              <Legend
                wrapperStyle={{ fontSize: 12, paddingTop: 4 }}
                iconType="circle"
              />
              <Bar
                dataKey="Previsto"
                fill="#94a3b8"
                radius={[0, 4, 4, 0]}
                isAnimationActive={false}
              >
                <LabelList
                  dataKey="PrevistoLabel"
                  position="right"
                  style={{ fontSize: 11, fill: "#475569" }}
                />
              </Bar>
              <Bar
                dataKey="Realizado"
                fill="#0ea5e9"
                radius={[0, 4, 4, 0]}
                isAnimationActive={false}
              >
                <LabelList
                  dataKey="RealizadoLabel"
                  position="right"
                  style={{ fontSize: 11, fill: "#0c4a6e", fontWeight: 600 }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

function ComposicaoBlock({ steps }: { steps: ComposicaoStep[] }) {
  // Visualizacao em LINHAS (uma por etapa) — melhora a leitura vertical
  // e permite alinhar labels e valores em colunas. Borda lateral colorida
  // reforça a natureza de cada item (entrada/saida/final).
  const kindStyle: Record<
    ComposicaoStep["kind"],
    { bar: string; valueColor: string; bg: string }
  > = {
    entrada: {
      bar: "bg-emerald-500",
      valueColor: "text-emerald-700",
      bg: "bg-emerald-50/40",
    },
    saida: {
      bar: "bg-rose-500",
      valueColor: "text-rose-700",
      bg: "bg-rose-50/40",
    },
    final: {
      bar: "bg-sky-600",
      valueColor: "text-sky-900",
      bg: "bg-sky-50",
    },
  };
  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Composição do Resultado</CardTitle>
      </CardHeader>
      <CardContent className="pb-4">
        <div className="divide-y divide-slate-100">
          {steps.map((step) => {
            const style = kindStyle[step.kind];
            return (
              <div
                key={step.label}
                className={`flex items-center justify-between gap-3 px-3 py-2.5 ${
                  step.kind === "final" ? `${style.bg} rounded-md` : ""
                }`}
              >
                <div className="flex items-center gap-3">
                  <span
                    aria-hidden
                    className={`h-6 w-1 shrink-0 rounded-full ${style.bar}`}
                  />
                  <span
                    className={`text-sm ${
                      step.kind === "final"
                        ? "font-semibold text-slate-900"
                        : "text-slate-700"
                    }`}
                  >
                    {step.label}
                  </span>
                </div>
                <span
                  className={`font-mono text-sm tabular-nums ${style.valueColor} ${
                    step.kind === "final" ? "font-bold" : "font-medium"
                  }`}
                >
                  {step.valueLabel}
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function VvrTemporalChart({ points }: { points: VvrSerieAnualPoint[] }) {
  // Barras = realizado; linha = meta. Composto num unico ComposedChart para
  // o eixo X e tooltip ficarem sincronizados.
  //
  // Rotulos pre-computados como strings — contorna a limitacao do
  // `formatter` do LabelList que nao recebe a linha completa de dados.
  const data = points.map((p) => ({
    mes: p.mes,
    realizado: p.realizado,
    meta: p.meta,
    realizadoLabel:
      p.realizado === null
        ? ""
        : p.realizado.toLocaleString("pt-BR", { maximumFractionDigits: 0 }),
    metaLabel:
      p.meta === null
        ? ""
        : p.meta.toLocaleString("pt-BR", { maximumFractionDigits: 0 }),
  }));
  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">VVR — Realizado x Meta</CardTitle>
        <p className="text-xs text-slate-500">
          Janeiro do ano selecionado até o mês de análise.
        </p>
      </CardHeader>
      <CardContent className="pb-4">
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={data}
              margin={{ top: 24, right: 16, bottom: 8, left: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="mes" tick={{ fontSize: 11, fill: "#64748b" }} />
              <YAxis tick={{ fontSize: 11, fill: "#64748b" }} width={48} />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
                formatter={(value) =>
                  value === null || value === undefined
                    ? "—"
                    : `${Number(value).toLocaleString("pt-BR")} mil`
                }
              />
              <Legend wrapperStyle={{ fontSize: 12, paddingTop: 4 }} iconType="circle" />
              <Bar
                dataKey="realizado"
                name="Realizado"
                fill="#0ea5e9"
                radius={[4, 4, 0, 0]}
                barSize={28}
                isAnimationActive={false}
              >
                <LabelList
                  dataKey="realizadoLabel"
                  position="top"
                  style={{ fontSize: 10, fill: "#0c4a6e", fontWeight: 600 }}
                />
              </Bar>
              <Line
                type="monotone"
                dataKey="meta"
                name="Meta"
                stroke="#f59e0b"
                strokeWidth={2}
                dot={{ r: 3, fill: "#f59e0b" }}
                isAnimationActive={false}
              >
                <LabelList
                  dataKey="metaLabel"
                  position="top"
                  offset={10}
                  style={{ fontSize: 10, fill: "#b45309" }}
                />
              </Line>
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

function HistoricoChart({ points }: { points: HistoricoPoint[] }) {
  // Rotulos pre-computados como string — contorna a limitacao do `formatter`
  // do LabelList (nao recebe a linha completa) e garante que o html2canvas
  // capture os rotulos no PDF, ja que sao apenas <text> SVG estatico.
  const data = points.map((p) => ({
    mes: p.mes,
    previsto: p.previsto,
    realizado: p.realizado,
    previstoLabel:
      p.previsto === null
        ? ""
        : p.previsto.toLocaleString("pt-BR", { maximumFractionDigits: 0 }),
    realizadoLabel:
      p.realizado === null
        ? ""
        : p.realizado.toLocaleString("pt-BR", { maximumFractionDigits: 0 }),
  }));
  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          Previsto x Realizado — Resultado do Exercício
        </CardTitle>
        <p className="text-xs text-slate-500">Últimos 6 meses — visão de tendência</p>
      </CardHeader>
      <CardContent className="pb-4">
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data}
              margin={{ top: 24, right: 24, bottom: 24, left: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="mes" tick={{ fontSize: 11, fill: "#64748b" }} />
              <YAxis tick={{ fontSize: 11, fill: "#64748b" }} width={36} />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
                formatter={(value) =>
                  value === null || value === undefined
                    ? "—"
                    : `${Number(value).toLocaleString("pt-BR")} mil`
                }
              />
              <Legend wrapperStyle={{ fontSize: 12, paddingTop: 4 }} iconType="circle" />
              <Line
                type="monotone"
                dataKey="previsto"
                name="Previsto"
                stroke="#94a3b8"
                strokeWidth={2}
                dot={{ r: 3 }}
                isAnimationActive={false}
              >
                <LabelList
                  dataKey="previstoLabel"
                  position="bottom"
                  offset={8}
                  style={{ fontSize: 10, fill: "#475569" }}
                />
              </Line>
              <Line
                type="monotone"
                dataKey="realizado"
                name="Realizado"
                stroke="#0ea5e9"
                strokeWidth={2}
                dot={{ r: 3 }}
                isAnimationActive={false}
              >
                <LabelList
                  dataKey="realizadoLabel"
                  position="top"
                  offset={8}
                  style={{ fontSize: 10, fill: "#0c4a6e", fontWeight: 600 }}
                />
              </Line>
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

function SemaforoBlock({ items }: { items: SemaforoItem[] }) {
  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Semáforo dos Indicadores</CardTitle>
      </CardHeader>
      <CardContent className="pb-4">
        <div className="flex flex-wrap gap-2">
          {items.map((item) => {
            const style = SIGN_STYLES[item.classificacao];
            return (
              <Badge
                key={item.indicador}
                variant="outline"
                className={`gap-1.5 ${style.badge}`}
              >
                <span className={`inline-block h-2 w-2 rounded-full ${
                  item.classificacao === "Positivo"
                    ? "bg-emerald-500"
                    : item.classificacao === "Atenção"
                      ? "bg-amber-500"
                      : item.classificacao === "Crítico"
                        ? "bg-rose-500"
                        : "bg-slate-400"
                }`} />
                <span className="font-medium">{item.indicador}</span>
                <span className="text-slate-400">·</span>
                <span>{item.classificacao}</span>
              </Badge>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function AlertasGrid({ items }: { items: AlertaCard[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((alert, i) => {
        const style = SIGN_STYLES[alert.classificacao];
        const Icon =
          alert.classificacao === "Positivo"
            ? CheckCircle2
            : alert.classificacao === "Crítico"
              ? TrendingDown
              : AlertTriangle;
        return (
          <Card key={i} className={`border ${style.badge.split(" ")[0]} shadow-sm`}>
            <CardContent className="space-y-2 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className={`rounded-full p-1.5 ${style.iconBg}`}>
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <Badge variant="outline" className={style.badge}>
                  {alert.classificacao}
                </Badge>
              </div>
              <div className="text-sm font-semibold text-slate-900">
                {alert.titulo}
              </div>
              <div className={`text-xs font-medium ${style.text}`}>
                {alert.texto}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function AcoesGrid({ items }: { items: AcaoCard[] }) {
  const impactoColor: Record<string, string> = {
    Alto: "border-rose-200 bg-rose-50 text-rose-700",
    Médio: "border-amber-200 bg-amber-50 text-amber-700",
    Baixo: "border-slate-200 bg-slate-50 text-slate-600",
  };
  const urgenciaColor: Record<string, string> = {
    Alta: "border-rose-200 bg-rose-50 text-rose-700",
    Média: "border-amber-200 bg-amber-50 text-amber-700",
    Baixa: "border-slate-200 bg-slate-50 text-slate-600",
  };
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((acao, i) => (
        <Card key={i} className="border-slate-200 shadow-sm transition-shadow hover:shadow-md">
          <CardContent className="space-y-3 p-4">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Ação Recomendada
            </div>
            <div className="text-sm font-semibold leading-snug text-slate-900">
              {acao.acao}
            </div>
            <div className="flex flex-wrap gap-1.5 pt-1">
              <Badge variant="outline" className={impactoColor[acao.impacto]}>
                Impacto: {acao.impacto}
              </Badge>
              <Badge variant="outline" className={urgenciaColor[acao.urgencia]}>
                Urgência: {acao.urgencia}
              </Badge>
            </div>
            <div className="text-xs text-slate-500">
              Área: <span className="font-medium text-slate-700">{acao.area}</span>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Componente raiz ───────────────────────────────────────────────────────

interface OnePageReportPreviewProps {
  data?: OnePageReportPreviewData;
}

export function OnePageReportPreview({
  data = MOCK_DATA,
}: OnePageReportPreviewProps) {
  return (
    <div className="space-y-5">
      {/* 1. Cabecalho */}
      <HeaderBlock data={data.cabecalho} />

      {/* 8. Diagnostico principal (subi para logo apos o header — e a tese) */}
      <DiagnosticoBlock texto={data.diagnosticoPrincipal} />

      {/* 2. KPI cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {data.kpis.map((kpi) => (
          <KpiCardItem key={kpi.label} kpi={kpi} />
        ))}
      </div>

      {/* Previsto x Realizado (mes) + Composicao (lado a lado em desktop) */}
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <PrevistoRealizadoLikeChart
            title="Previsto x Realizado"
            items={data.previstoRealizado}
          />
        </div>
        <div className="lg:col-span-2">
          <ComposicaoBlock steps={data.composicao} />
        </div>
      </div>

      {/* Acumulado do Ano + VVR Serie Anual (lado a lado em desktop) */}
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <PrevistoRealizadoLikeChart
            title="Acumulado do Ano"
            subtitle="Janeiro do ano selecionado até o mês de análise"
            items={data.acumuladoAno}
          />
        </div>
        <div className="lg:col-span-2">
          <VvrTemporalChart points={data.vvrSerieAnual} />
        </div>
      </div>

      {/* Historico + Semaforo */}
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <HistoricoChart points={data.historico} />
        </div>
        <div className="lg:col-span-2">
          <SemaforoBlock items={data.semaforo} />
        </div>
      </div>

      {/* 6. Alertas */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-600">
          Alertas
        </h2>
        <AlertasGrid items={data.alertas} />
      </section>

      {/* 9. Acoes recomendadas */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-600">
          Ações Recomendadas
        </h2>
        <AcoesGrid items={data.acoes} />
      </section>
    </div>
  );
}
