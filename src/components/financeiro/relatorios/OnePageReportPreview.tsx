"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
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
  previsto: number;
  realizado: number;
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
    { label: "FEE disponível", value: "R$ 7,0 mil", variation: "+4,2%", sign: "Neutro" },
    { label: "VVR", value: "R$ 180 mil", variation: "+9,1%", sign: "Positivo" },
  ],
  previstoRealizado: [
    { indicador: "Receita", realizado: 118.9, previsto: 110.0, unidade: "mil" },
    { indicador: "Despesas", realizado: 85.6, previsto: 80.0, unidade: "mil" },
    { indicador: "Resultado", realizado: 25.9, previsto: 25.0, unidade: "mil" },
    { indicador: "Margem", realizado: 22.7, previsto: 23.5, unidade: "%" },
    { indicador: "VVR", realizado: 180, previsto: 165, unidade: "mil" },
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
            {kpi.variationSuffix ? ` ${kpi.variationSuffix}` : ""} vs orçamento
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

function PrevistoRealizadoChart({
  items,
}: {
  items: PrevistoRealizadoItem[];
}) {
  const data = items.map((i) => ({
    indicador: i.indicador,
    Realizado: i.realizado,
    Previsto: i.previsto,
    unidade: i.unidade,
  }));
  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Previsto x Realizado</CardTitle>
      </CardHeader>
      <CardContent className="pb-4">
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              layout="vertical"
              margin={{ top: 8, right: 16, bottom: 8, left: 8 }}
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
              <Bar dataKey="Previsto" fill="#94a3b8" radius={[0, 4, 4, 0]} />
              <Bar dataKey="Realizado" fill="#0ea5e9" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

function ComposicaoBlock({ steps }: { steps: ComposicaoStep[] }) {
  const kindStyle: Record<ComposicaoStep["kind"], string> = {
    entrada: "bg-emerald-50 border-emerald-200 text-emerald-800",
    saida: "bg-rose-50 border-rose-200 text-rose-800",
    final: "bg-sky-100 border-sky-300 text-sky-900",
  };
  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Composição do Resultado</CardTitle>
      </CardHeader>
      <CardContent className="pb-5">
        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:gap-1">
          {steps.map((step, idx) => (
            <div key={step.label} className="flex flex-1 items-center gap-1">
              <div
                className={`flex flex-1 flex-col rounded-lg border px-3 py-3 ${kindStyle[step.kind]}`}
              >
                <span className="text-[10px] font-semibold uppercase tracking-wider opacity-70">
                  {step.label}
                </span>
                <span className="mt-1 text-sm font-bold">{step.valueLabel}</span>
              </div>
              {idx < steps.length - 1 ? (
                <ArrowRight className="hidden h-4 w-4 shrink-0 text-slate-400 sm:block" />
              ) : null}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function HistoricoChart({ points }: { points: HistoricoPoint[] }) {
  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Histórico Previsto x Realizado</CardTitle>
        <p className="text-xs text-slate-500">Últimos 6 meses — visão de tendência</p>
      </CardHeader>
      <CardContent className="pb-4">
        <div className="h-48 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={points}
              margin={{ top: 8, right: 16, bottom: 8, left: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="mes" tick={{ fontSize: 11, fill: "#64748b" }} />
              <YAxis tick={{ fontSize: 11, fill: "#64748b" }} width={36} />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
                formatter={(value) => `${Number(value ?? 0).toLocaleString("pt-BR")} mil`}
              />
              <Legend wrapperStyle={{ fontSize: 12, paddingTop: 4 }} iconType="circle" />
              <Line
                type="monotone"
                dataKey="previsto"
                name="Previsto"
                stroke="#94a3b8"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
              <Line
                type="monotone"
                dataKey="realizado"
                name="Realizado"
                stroke="#0ea5e9"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
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

      {/* 3 + 4. Previsto x Realizado + Composicao (lado a lado em desktop) */}
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <PrevistoRealizadoChart items={data.previstoRealizado} />
        </div>
        <div className="lg:col-span-2">
          <ComposicaoBlock steps={data.composicao} />
        </div>
      </div>

      {/* 5 + 7. Historico + Semaforo */}
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
