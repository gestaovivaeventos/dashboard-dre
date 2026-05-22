import type {
  AcaoCard,
  AlertaCard,
  ComposicaoStep,
  HistoricoPoint,
  KpiCard,
  OnePageReportPreviewData,
  PrevistoRealizadoItem,
  SemaforoItem,
} from "@/components/financeiro/relatorios/OnePageReportPreview";
import type { OnePageReport } from "@/lib/financeiro/relatorios/one-page-schema";

// ============================================================================
// Mapper entre a resposta da rota /api/intelligence/one-page e o shape
// consumido pelo componente OnePageReportPreview.
//
// Princípios:
//   - Apenas mapeia/formata. NAO chama API, NAO consulta banco, NAO faz IA.
//   - Tolerante a campos null/ausentes — quando algo nao vem da rota,
//     usa fallback visual seguro (string vazia, array vazio, etc.).
//   - NAO inventa numeros, variacoes ou nomes financeiros.
//   - NAO mistura mock com real: o que nao vier da rota nao aparece (ou
//     aparece em estado "vazio" controlado).
// ============================================================================

// ─── Shape da resposta da rota (espelhada localmente) ─────────────────────

type ApiKpiStatus = "positivo" | "neutro" | "atencao" | "critico";

interface ApiKpiCard {
  label: string;
  value: number | null;
  formattedValue: string | null;
  variationValue: number | null;
  variationLabel: string | null;
  status: ApiKpiStatus;
}

interface ApiKpis {
  receita: ApiKpiCard;
  resultado: ApiKpiCard;
  margem: ApiKpiCard;
  fee_disponivel: ApiKpiCard;
  vvr: ApiKpiCard;
}

interface ApiPrevistoRealizado {
  label: string;
  realizado: number | null;
  previsto: number | null;
  unidade: "currency" | "percent" | "number";
}

interface ApiComposicao {
  label: string;
  value: number;
  type: "entrada" | "saida" | "resultado";
}

interface ApiHistorico {
  mes: string;
  previsto: number | null;
  realizado: number | null;
}

interface ApiVvrSerieAnual {
  mes: string;
  realizado: number | null;
  meta: number | null;
}

export interface OnePageApiResponse {
  analysis?: OnePageReport;
  input?: {
    empresa?: { id?: string; nome?: string };
    periodo?: { label?: string; date_from?: string; date_to?: string };
  };
  generatedAt?: string;
  kpis?: ApiKpis;
  previstoRealizado?: ApiPrevistoRealizado[];
  composicaoResultado?: ApiComposicao[];
  historicoResultado?: ApiHistorico[];
  acumuladoAno?: ApiPrevistoRealizado[];
  vvrSerieAnual?: ApiVvrSerieAnual[];
  error?: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

type Sign = KpiCard["sign"]; // "Positivo" | "Atenção" | "Neutro" | "Crítico"

function statusToSign(status: ApiKpiStatus | undefined): Sign {
  switch (status) {
    case "positivo":
      return "Positivo";
    case "atencao":
      return "Atenção";
    case "critico":
      return "Crítico";
    case "neutro":
    default:
      return "Neutro";
  }
}

// Formata numero como "R$ X,Y mil" — mesmo padrao do mock visual. Usa o
// valor absoluto / 1000 para escala "mil"; preserva o sinal explicitamente.
function formatBRLMil(n: number): string {
  const v = Math.abs(n) / 1000;
  const formatted = v.toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  const sign = n < 0 ? "-" : "";
  return `${sign}R$ ${formatted} mil`;
}

// ─── KPIs ──────────────────────────────────────────────────────────────────
//
// Regra especial: o card "FEE Disponível" NAO tem variacao vs orcamento. A
// rota envia variationLabel="Saldo atual" com variationValue=null. O mapper
// preserva esse rotulo no campo `variation` e marca `omitComparisonSuffix:
// true` para o componente NAO concatenar " vs orçamento" no render.
function mapKpiCard(
  api: ApiKpiCard | undefined,
  fallbackLabel: string,
  options: {
    omitComparisonSuffix?: boolean;
    comparisonLabel?: string;
  } = {},
): KpiCard {
  const extra = {
    ...(options.omitComparisonSuffix ? { omitComparisonSuffix: true } : {}),
    ...(options.comparisonLabel ? { comparisonLabel: options.comparisonLabel } : {}),
  };

  if (!api) {
    return {
      label: fallbackLabel,
      value: "—",
      variation: "",
      sign: "Neutro",
      ...extra,
    };
  }

  // Garante "VVR" sempre em maiusculo (regra 2 do briefing).
  const label =
    fallbackLabel.toLowerCase() === "vvr" ? "VVR" : api.label || fallbackLabel;

  return {
    label,
    value: api.formattedValue ?? "—",
    variation: api.variationLabel ?? "",
    sign: statusToSign(api.status),
    ...extra,
  };
}

function mapKpis(api: ApiKpis | undefined): KpiCard[] {
  return [
    mapKpiCard(api?.receita, "Receita"),
    mapKpiCard(api?.resultado, "Resultado"),
    mapKpiCard(api?.margem, "Margem"),
    mapKpiCard(api?.fee_disponivel, "FEE disponível", {
      omitComparisonSuffix: true,
    }),
    // VVR usa "meta" no lugar de "orçamento" — VVR e comparado contra
    // VVR META, nao contra orcamento contabil.
    mapKpiCard(api?.vvr, "VVR", { comparisonLabel: "meta" }),
  ];
}

// ─── Previsto x Realizado ──────────────────────────────────────────────────
//
// Componente espera unidade "mil" | "%". Quando a rota indica "currency"
// (valor em R$ cheio, ex.: 118853.89), convertemos a escala dividindo por
// 1000 para casar com o eixo "mil" do grafico. Quando indica "percent",
// passamos o numero como esta com unidade "%".
function mapPrevistoRealizadoItem(
  item: ApiPrevistoRealizado,
): PrevistoRealizadoItem | null {
  // Sem nenhum valor (realizado e previsto null), nao faz sentido renderizar
  // a linha — retorna null e o caller filtra.
  if (item.realizado === null && item.previsto === null) return null;

  const isPercent = item.unidade === "percent";
  const scale = item.unidade === "currency" ? 1000 : 1;

  return {
    indicador: item.label,
    realizado: (item.realizado ?? 0) / scale,
    previsto: (item.previsto ?? 0) / scale,
    unidade: isPercent ? "%" : "mil",
  };
}

function mapPrevistoRealizado(
  api: ApiPrevistoRealizado[] | undefined,
): PrevistoRealizadoItem[] {
  if (!api) return [];
  // VVR foi removido do grafico Previsto x Realizado por decisao de produto
  // — o VVR tem grafico proprio (serie temporal anual). FEE Disponivel
  // tambem nunca entra aqui (saldo, nao comparacao).
  const EXCLUDED = new Set(["fee disponível", "fee disponivel", "vvr"]);
  return api
    .filter((item) => !EXCLUDED.has(item.label.toLowerCase()))
    .map(mapPrevistoRealizadoItem)
    .filter((x): x is PrevistoRealizadoItem => x !== null);
}

// ─── Composicao do resultado ────────────────────────────────────────────────

function mapComposicaoItem(item: ApiComposicao): ComposicaoStep {
  // "resultado" no payload da rota mapeia para "final" no componente.
  const kind: ComposicaoStep["kind"] =
    item.type === "resultado" ? "final" : item.type;
  return {
    label: item.label,
    valueLabel: formatBRLMil(item.value),
    kind,
  };
}

function mapComposicao(api: ApiComposicao[] | undefined): ComposicaoStep[] {
  if (!api) return [];
  return api.map(mapComposicaoItem);
}

// ─── Acumulado do ano ─────────────────────────────────────────────────────
//
// Mesma forma do `previstoRealizado` — reusa o mapper item-a-item. NUNCA
// inclui VVR nem FEE (sao tratados em outros blocos).
function mapAcumuladoAno(
  api: ApiPrevistoRealizado[] | undefined,
): PrevistoRealizadoItem[] {
  if (!api) return [];
  const EXCLUDED = new Set(["fee disponível", "fee disponivel", "vvr"]);
  return api
    .filter((item) => !EXCLUDED.has(item.label.toLowerCase()))
    .map(mapPrevistoRealizadoItem)
    .filter((x): x is PrevistoRealizadoItem => x !== null);
}

// ─── VVR serie anual ──────────────────────────────────────────────────────
//
// Mesma escala usada nos demais graficos: rota envia R$ bruto, mapper divide
// por 1000. Pontos com realizado e meta ambos null sao descartados — nao
// poluem o eixo X com mes vazio.
function mapVvrSerieAnual(
  api: ApiVvrSerieAnual[] | undefined,
): Array<{ mes: string; realizado: number | null; meta: number | null }> {
  if (!api || api.length === 0) return [];
  return api
    .filter((p) => p.realizado !== null || p.meta !== null)
    .map((p) => ({
      mes: p.mes,
      realizado: p.realizado === null ? null : p.realizado / 1000,
      meta: p.meta === null ? null : p.meta / 1000,
    }));
}

// ─── Historico ─────────────────────────────────────────────────────────────
//
// Rota envia valores em REAL bruto. Aqui dividimos por 1000 para casar com
// a escala "mil" do grafico (mesma convencao usada em previstoRealizado).
// Pontos onde ambos previsto e realizado sao null sao descartados — nao
// adianta plotar mes vazio. Quando apenas um dos dois e null, mantemos o
// outro: o recharts (com connectNulls=false por padrao) desenha um "gap"
// na linha nula, o que e o comportamento desejado.
function mapHistorico(api: ApiHistorico[] | undefined): HistoricoPoint[] {
  if (!api || api.length === 0) return [];
  return api
    .filter((p) => p.previsto !== null || p.realizado !== null)
    .map((p) => ({
      mes: p.mes,
      previsto: p.previsto === null ? null : p.previsto / 1000,
      realizado: p.realizado === null ? null : p.realizado / 1000,
    }));
}

// ─── Alertas ───────────────────────────────────────────────────────────────
//
// Prioriza pontosAtencao (risco real) sobre destaques (positivos). Limita a 3.
// Classificacao:
//   - pontoAtencao com risco Alto -> "Crítico"
//   - pontoAtencao com risco Médio/Baixo -> "Atenção"
//   - destaque (qualquer impacto) -> "Positivo"
function mapAlertas(analysis: OnePageReport | undefined): AlertaCard[] {
  if (!analysis) return [];

  const alertas: AlertaCard[] = [];

  for (const ponto of analysis.pontosAtencao ?? []) {
    if (alertas.length >= 3) break;
    alertas.push({
      titulo: ponto.titulo,
      texto: ponto.descricao,
      classificacao: ponto.risco === "Alto" ? "Crítico" : "Atenção",
    });
  }

  for (const destaque of analysis.destaques ?? []) {
    if (alertas.length >= 3) break;
    alertas.push({
      titulo: destaque.titulo,
      texto: destaque.descricao,
      classificacao: "Positivo",
    });
  }

  return alertas;
}

// ─── Semaforo ──────────────────────────────────────────────────────────────
//
// Indicadores fixos exibidos: Receita, Despesas, Resultado, Margem,
// FEE disponível, VVR. Para os 3 estruturais (Receita/Despesas/Resultado)
// tentamos casar com `analysis.leituraPorIndicador` (que usa nomes longos
// do plano, ex.: "Receita Operacional Bruta"). Margem/FEE/VVR nao chegam
// como linha do plano — caem direto no fallback derivado de kpis.status.
function findLeituraClassificacao(
  leituras: OnePageReport["leituraPorIndicador"] | undefined,
  searchTerms: string[],
): SemaforoItem["classificacao"] | null {
  if (!leituras) return null;
  for (const term of searchTerms) {
    const lowerTerm = term.toLowerCase();
    const match = leituras.find((l) => l.indicador.toLowerCase().includes(lowerTerm));
    if (match) return match.classificacao;
  }
  return null;
}

function mapSemaforo(
  analysis: OnePageReport | undefined,
  kpis: ApiKpis | undefined,
): SemaforoItem[] {
  // Cada entrada: rotulo a exibir + termos de busca no leituraPorIndicador
  // + kpi correspondente para fallback.
  const config: Array<{
    indicador: string;
    searchTerms: string[];
    fallbackKpi: ApiKpiCard | undefined;
  }> = [
    {
      indicador: "Receita",
      searchTerms: ["receita operacional bruta", "receita bruta", "receita"],
      fallbackKpi: kpis?.receita,
    },
    {
      indicador: "Despesas",
      searchTerms: ["despesas operacionais", "despesas"],
      fallbackKpi: undefined, // nao temos KPI de Despesas direto
    },
    {
      indicador: "Resultado",
      searchTerms: ["resultado do exercicio", "resultado do exercício", "resultado"],
      fallbackKpi: kpis?.resultado,
    },
    {
      indicador: "Margem",
      searchTerms: ["margem"],
      fallbackKpi: kpis?.margem,
    },
    {
      indicador: "FEE disponível",
      searchTerms: ["fee disponível", "fee disponivel"],
      fallbackKpi: kpis?.fee_disponivel,
    },
    {
      indicador: "VVR",
      searchTerms: ["vvr"],
      fallbackKpi: kpis?.vvr,
    },
  ];

  return config.map(({ indicador, searchTerms, fallbackKpi }) => {
    const fromIa = findLeituraClassificacao(analysis?.leituraPorIndicador, searchTerms);
    if (fromIa) return { indicador, classificacao: fromIa };
    // Fallback: derivar do KPI; se nao houver KPI, fica "Neutro" — nunca quebra.
    return { indicador, classificacao: statusToSign(fallbackKpi?.status) };
  });
}

// ─── Diagnostico principal ─────────────────────────────────────────────────

function mapDiagnostico(analysis: OnePageReport | undefined): string {
  if (!analysis) return "";
  if (analysis.diagnosticoPrincipal && analysis.diagnosticoPrincipal.trim()) {
    return analysis.diagnosticoPrincipal;
  }
  if (analysis.resumoExecutivo && analysis.resumoExecutivo.trim()) {
    return analysis.resumoExecutivo;
  }
  return "";
}

// ─── Acoes recomendadas ────────────────────────────────────────────────────

function mapAcoes(analysis: OnePageReport | undefined): AcaoCard[] {
  if (!analysis) return [];
  return (analysis.acoesRecomendadas ?? []).slice(0, 3).map((a) => ({
    acao: a.acao,
    impacto: a.impacto,
    urgencia: a.urgencia,
    area: a.areaResponsavel,
  }));
}

// ─── Cabecalho ─────────────────────────────────────────────────────────────

function mapCabecalho(
  response: OnePageApiResponse,
): OnePageReportPreviewData["cabecalho"] {
  return {
    empresa: response.input?.empresa?.nome ?? "—",
    periodo: response.input?.periodo?.label ?? "—",
    geradoEm: response.generatedAt ?? "",
    statusGeral: response.analysis?.statusGeral ?? "Atenção",
    notaGeral:
      typeof response.analysis?.notaGeral === "number"
        ? response.analysis.notaGeral
        : 0,
  };
}

// ─── Funcao principal ──────────────────────────────────────────────────────

export function mapOnePageApiResponseToPreviewData(
  response: OnePageApiResponse,
): OnePageReportPreviewData {
  return {
    cabecalho: mapCabecalho(response),
    kpis: mapKpis(response.kpis),
    previstoRealizado: mapPrevistoRealizado(response.previstoRealizado),
    composicao: mapComposicao(response.composicaoResultado),
    historico: mapHistorico(response.historicoResultado),
    acumuladoAno: mapAcumuladoAno(response.acumuladoAno),
    vvrSerieAnual: mapVvrSerieAnual(response.vvrSerieAnual),
    alertas: mapAlertas(response.analysis),
    semaforo: mapSemaforo(response.analysis, response.kpis),
    diagnosticoPrincipal: mapDiagnostico(response.analysis),
    acoes: mapAcoes(response.analysis),
  };
}
