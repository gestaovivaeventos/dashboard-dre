import type {
  AcaoCard,
  AlertaCard,
  ComposicaoStep,
  CustodyClosingBlock,
  DreIndicatorsBlock,
  FeatContasReceberAbertoBlock,
  FeatEventosBlock,
  HistoricoPoint,
  HoldingComparativoBlock,
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
  // Card sem comparação com orçado (ex.: Margem Líquida) — não concatena
  // " vs orçamento".
  omitComparisonSuffix?: boolean;
}

interface ApiKpis {
  receita: ApiKpiCard;
  despesas: ApiKpiCard;
  resultado: ApiKpiCard;
  margem: ApiKpiCard;
  // Blocos específicos de Franquias Viva — OPCIONAIS. Só chegam quando o
  // template da empresa os suporta; templates Real Estate/genérico não os
  // enviam e o card correspondente não é renderizado.
  fee_disponivel?: ApiKpiCard;
  // % de FEE disponível (FEE disponível ÷ FEE a receber) — só Franquias Viva.
  fee_disponivel_pct?: ApiKpiCard;
  vvr?: ApiKpiCard;
  sobrevivencia_caixa?: ApiKpiCard;
  margem_media_eventos?: ApiKpiCard;
  // Inadimplencia atual (R$) — só chega para empresas do segmento Franquias Viva.
  inadimplencia_atual?: ApiKpiCard;
}

interface ApiPrevistoRealizado {
  label: string;
  realizado: number | null;
  previsto: number | null;
  unidade: "currency" | "percent" | "number";
  // Agrupamento/nota opcionais (templates com tabela agrupada, ex.: Village).
  group?: string;
  footnote?: string;
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
  // Template de relatório resolvido (rótulo discreto de debug/admin).
  template?: { id?: string; name?: string };
  kpis?: ApiKpis;
  // KPIs CUSTOM por conta DRE (templates com report.kpiCards — ex.: SGX).
  // Quando presente, substitui o conjunto fixo `kpis` na renderização.
  kpisList?: ApiKpiCard[];
  // Allowlist de blocos visíveis (undefined = todos — comportamento Viva).
  enabledBlocks?: string[];
  // Título do gráfico de histórico (undefined = título atual no componente).
  historicoTitle?: string;
  // Rótulos do histórico em "Xk" (milhar) — ex.: SGX.
  historicoKLabels?: boolean;
  // Nº de colunas da grade de KPIs (undefined = 4).
  kpiColumns?: number;
  previstoRealizado?: ApiPrevistoRealizado[];
  composicaoResultado?: ApiComposicao[];
  historicoResultado?: ApiHistorico[];
  acumuladoAno?: ApiPrevistoRealizado[];
  vvrSerieAnual?: ApiVvrSerieAnual[];
  // Quadro de eventos exclusivo da Feat Produções (mesmo shape do componente).
  // Presente só quando a empresa analisada é a Feat Produções.
  featEventos?: FeatEventosBlock;
  featContasReceberAberto?: FeatContasReceberAbertoBlock;
  // Saldo final da Custódia de Artistas (Case Shows). Mesmo shape do componente
  // (R$ cheios). Presente só quando a empresa analisada é a Case Shows.
  custodyClosing?: CustodyClosingBlock;
  // Quadro de indicadores por conta DRE (ex.: Terrazzo — "Locação de Espaço").
  // Mesmo shape do componente (R$ cheios). Presente só p/ templates que o configuram.
  indicadoresDre?: DreIndicatorsBlock;
  // Comparativo das empresas da holding (Hero Holding). A rota envia
  // `{ title, referencia, empresas: [{ empresa, vvr*, fee*, ... }] }` (camelCase,
  // valores crus). O mapper monta o bloco do componente (o componente formata).
  holdingComparativo?: {
    title: string;
    referencia: string;
    empresas: Array<{
      empresa: string;
      pctMetaAnualVvrAcumulada: number | null;
      pctMetaVvrMes: number | null;
      pctFeeDisponivel: number | null;
      sobrevivenciaCaixaMeses: number | null;
      margemMediaEventos: number | null;
      inadimplenciaAtual: number | null;
    }>;
  };
  // Gráficos extras por template (ex.: Village): colunas (acum. do ano) + linhas
  // (6 meses, N séries). Valores em R$ — o mapper divide por 1000 (escala "mil").
  barsSerie?: { mes: string; valor: number | null }[];
  barsTitle?: string;
  barsAcum?: number | null;
  linesSerie?: { mes: string; values: (number | null)[] }[];
  linesSeriesLabels?: string[];
  linesTitle?: string;
  linesAcum?: (number | null)[];
  linesAcumBaseIndex?: number;
  prevRealCharts?: {
    title: string;
    serie: { mes: string; previsto: number | null; realizado: number | null }[];
    previstoAcum: number | null;
    realizadoAcum: number | null;
  }[];
  consolidated?: {
    title: string;
    rows: { label: string; previsto: number | null; realizado: number | null; emphasis?: boolean }[];
    acum?: { previsto: number | null; realizado: number | null };
  };
  historicoAcum?: { previsto: number | null; realizado: number | null };
  // Bloco Performance por Parceiro (ex.: Young Med). Valores em R$ (÷1000 no map).
  partnerPerformance?: {
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
  };
  // Blocos de breakdown (ex.: Spot — composição/frete). Valores R$ (÷1000 no map).
  breakdownBlocks?: Array<{
    key: string;
    title: string;
    rows: Array<{ label: string; value: number; pct: number | null; emphasis: boolean }>;
  }>;
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

// Formata numero como "X,Y mil" — mesmo padrao do mock visual. Usa o
// valor absoluto / 1000 para escala "mil"; preserva o sinal explicitamente.
function formatBRLMil(n: number): string {
  const v = Math.abs(n) / 1000;
  const formatted = v.toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  const sign = n < 0 ? "-" : "";
  return `${sign}${formatted} mil`;
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
  // Ordem dos cards: define a leitura visual da grade 4x2 do BI.
  // Linha 1: Receita | Despesas | Resultado | Margem
  // Linha 2: FEE disponível | Sobrevivência de caixa | VVR | Margem média
  //          dos eventos (este ultimo so renderiza para Franquias Viva)
  const cards: KpiCard[] = [
    mapKpiCard(api?.receita, "Receita"),
    mapKpiCard(api?.despesas, "Despesas"),
    mapKpiCard(api?.resultado, "Resultado"),
    mapKpiCard(api?.margem, "Margem"),
  ];

  // Blocos específicos de Franquias Viva — só entram quando a rota os envia
  // (templates Real Estate/genérico não enviam, então os cards não aparecem).
  if (api?.fee_disponivel) {
    cards.push(
      mapKpiCard(api.fee_disponivel, "FEE disponível", { omitComparisonSuffix: true }),
    );
  }
  // % de FEE disponível — logo após o FEE disponível absoluto (mesmo grupo de
  // saúde financeira). Indicador informativo, sem comparativo com orçamento.
  if (api?.fee_disponivel_pct) {
    cards.push(
      mapKpiCard(api.fee_disponivel_pct, "% de FEE disponível", {
        omitComparisonSuffix: true,
      }),
    );
  }
  if (api?.sobrevivencia_caixa) {
    // Sobrevivencia de caixa: indicador derivado em meses (sem comparativo
    // contra orcamento — omitComparisonSuffix=true preserva o rotulo
    // "Cobertura do FEE" sem concatenar " vs orçamento").
    cards.push(
      mapKpiCard(api.sobrevivencia_caixa, "Sobrevivência de caixa", { omitComparisonSuffix: true }),
    );
  }
  if (api?.vvr) {
    // VVR usa "meta" no lugar de "orçamento" — VVR e comparado contra
    // VVR META, nao contra orcamento contabil.
    cards.push(mapKpiCard(api.vvr, "VVR", { comparisonLabel: "meta" }));
  }

  // "Margem média dos eventos" so chega quando a empresa pertence ao
  // segmento Franquias Viva. Sem comparativo (e um valor informado), entao
  // omitComparisonSuffix=true para nao concatenar "vs orçamento".
  if (api?.margem_media_eventos) {
    cards.push(
      mapKpiCard(api.margem_media_eventos, "Margem média dos eventos", {
        omitComparisonSuffix: true,
      }),
    );
  }

  // "Inadimplência Atual" (R$) so chega para empresas do segmento Franquias
  // Viva. Valor informado manualmente — sem comparativo com orcamento.
  if (api?.inadimplencia_atual) {
    cards.push(
      mapKpiCard(api.inadimplencia_atual, "Inadimplência Atual", {
        omitComparisonSuffix: true,
      }),
    );
  }

  return cards;
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
    group: item.group,
    footnote: item.footnote,
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

// Direcao OBJETIVA de um indicador do quadro previsto x realizado, derivada
// APENAS dos numeros (mesma regra do `variationCell` da UI). Linhas redutoras
// (despesa/custo/deducao) invertem o sentido: abaixo do orcado = FAVORAVEL.
// Usada para impedir que uma classificacao textual da IA contradiga o sinal.
function numericClassificacao(
  label: string,
  realizado: number | null,
  previsto: number | null,
  unidade: ApiPrevistoRealizado["unidade"],
): SemaforoItem["classificacao"] | null {
  if (realizado === null || previsto === null) return null;
  if (unidade === "percent") {
    // Margem: variacao em pontos percentuais (diferenca absoluta).
    const diff = realizado - previsto;
    if (diff >= 0) return "Positivo";
    if (diff >= -1) return "Atenção";
    return "Crítico";
  }
  if (previsto === 0) return null;
  const pct = ((realizado - previsto) / Math.abs(previsto)) * 100;
  const nome = label.toLowerCase();
  const isRedutora =
    nome.includes("despesa") || nome.includes("custo") || nome.includes("dedu");
  if (isRedutora) {
    // Gastar MENOS que o orcado e favoravel.
    if (pct <= 0) return "Positivo";
    return pct > 10 ? "Crítico" : "Atenção";
  }
  if (pct >= 0) return "Positivo";
  return pct < -10 ? "Crítico" : "Atenção";
}

// Duas classificacoes apontam para a mesma direcao (favoravel / neutra /
// desfavoravel)? Positivo = favoravel; Atenção/Crítico = desfavoravel.
function sameDirection(
  a: SemaforoItem["classificacao"],
  b: SemaforoItem["classificacao"],
): boolean {
  const bucket = (c: SemaforoItem["classificacao"]) =>
    c === "Positivo" ? "fav" : c === "Neutro" ? "neu" : "desf";
  return bucket(a) === bucket(b);
}

function mapSemaforo(
  analysis: OnePageReport | undefined,
  kpis: ApiKpis | undefined,
  previstoRealizado: ApiPrevistoRealizado[] | undefined,
): SemaforoItem[] {
  // Cada entrada: rotulo a exibir + termos de busca no leituraPorIndicador
  // + kpi correspondente para fallback. `deterministic` marca os indicadores
  // estruturais cuja direcao vem do NUMERO (quadro previsto x realizado).
  const config: Array<{
    indicador: string;
    searchTerms: string[];
    fallbackKpi: ApiKpiCard | undefined;
    deterministic?: boolean;
  }> = [
    {
      indicador: "Receita",
      searchTerms: ["receita operacional bruta", "receita bruta", "receita"],
      fallbackKpi: kpis?.receita,
      deterministic: true,
    },
    {
      indicador: "Despesas",
      searchTerms: ["despesas operacionais", "despesas"],
      fallbackKpi: undefined, // nao temos KPI de Despesas direto
      deterministic: true,
    },
    {
      indicador: "Resultado",
      searchTerms: ["resultado do exercicio", "resultado do exercício", "resultado"],
      fallbackKpi: kpis?.resultado,
      deterministic: true,
    },
    {
      indicador: "Margem",
      searchTerms: ["margem"],
      fallbackKpi: kpis?.margem,
      deterministic: true,
    },
  ];

  // FEE disponível e VVR no semáforo só quando o template os fornece (Franquias
  // Viva). Templates Real Estate/genérico não enviam esses KPIs.
  if (kpis?.fee_disponivel) {
    config.push({
      indicador: "FEE disponível",
      searchTerms: ["fee disponível", "fee disponivel"],
      fallbackKpi: kpis.fee_disponivel,
    });
  }
  if (kpis?.vvr) {
    config.push({
      indicador: "VVR",
      searchTerms: ["vvr"],
      fallbackKpi: kpis.vvr,
    });
  }

  return config.map(({ indicador, searchTerms, fallbackKpi, deterministic }) => {
    const fromIa = findLeituraClassificacao(analysis?.leituraPorIndicador, searchTerms);

    // Indicadores estruturais: a direcao (favoravel/desfavoravel) e OBJETIVA e
    // vem do numero. A classificacao textual da IA pode divergir do sinal —
    // ex.: marcar despesa ABAIXO do orcado como "Atenção". Quando ha
    // contradicao, o numero prevalece; a IA so e usada quando concorda com a
    // direcao (podendo refinar Atenção <-> Crítico).
    if (deterministic) {
      const pr = previstoRealizado?.find(
        (p) => p.label.toLowerCase() === indicador.toLowerCase(),
      );
      const numerica = pr
        ? numericClassificacao(pr.label, pr.realizado, pr.previsto, pr.unidade)
        : null;
      if (numerica) {
        return {
          indicador,
          classificacao:
            fromIa && sameDirection(fromIa, numerica) ? fromIa : numerica,
        };
      }
    }

    if (fromIa) return { indicador, classificacao: fromIa };
    // Fallback: derivar do KPI; se nao houver KPI, fica "Neutro" — nunca quebra.
    return { indicador, classificacao: statusToSign(fallbackKpi?.status) };
  });
}

// Semáforo para templates CUSTOM (kpisList — ex.: SGX): um item por KPI,
// classificado pela leitura da IA (quando casar pelo rótulo) ou, no fallback,
// pelo próprio status do KPI. Não usa os indicadores fixos da Viva.
function mapSemaforoFromList(
  analysis: OnePageReport | undefined,
  list: ApiKpiCard[],
): SemaforoItem[] {
  return list.map((card) => {
    const fromIa = findLeituraClassificacao(analysis?.leituraPorIndicador, [
      card.label.toLowerCase(),
    ]);
    return {
      indicador: card.label,
      classificacao: fromIa ?? statusToSign(card.status),
    };
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

// ─── Comparativo da holding (Hero Holding) ─────────────────────────────────
//
// Passa os valores crus (R$/%/meses) para o componente, que faz a formatação e
// os destaques por coluna. Só monta o bloco quando há empresas.
function mapHoldingComparativo(
  api: OnePageApiResponse["holdingComparativo"],
): HoldingComparativoBlock | undefined {
  if (!api || !Array.isArray(api.empresas) || api.empresas.length === 0) {
    return undefined;
  }
  return {
    key: "holdingComparativo",
    title: api.title,
    referenciaLabel: api.referencia,
    empresas: api.empresas.map((e) => ({
      empresa: e.empresa,
      pctMetaAnualVvrAcumulada: e.pctMetaAnualVvrAcumulada,
      pctMetaVvrMes: e.pctMetaVvrMes,
      pctFeeDisponivel: e.pctFeeDisponivel,
      sobrevivenciaCaixaMeses: e.sobrevivenciaCaixaMeses,
      margemMediaEventos: e.margemMediaEventos,
      inadimplenciaAtual: e.inadimplenciaAtual,
    })),
  };
}

// ─── Funcao principal ──────────────────────────────────────────────────────

export function mapOnePageApiResponseToPreviewData(
  response: OnePageApiResponse,
): OnePageReportPreviewData {
  // Templates com KPIs custom (ex.: SGX) trazem `kpisList`; nesse caso a UI usa
  // essa lista (e o semáforo derivado dela) no lugar do conjunto fixo da Viva.
  const customKpis =
    Array.isArray(response.kpisList) && response.kpisList.length > 0
      ? response.kpisList
      : null;
  return {
    cabecalho: mapCabecalho(response),
    kpis: customKpis
      ? customKpis.map((c) =>
          mapKpiCard(c, c.label, { omitComparisonSuffix: c.omitComparisonSuffix }),
        )
      : mapKpis(response.kpis),
    previstoRealizado: mapPrevistoRealizado(response.previstoRealizado),
    composicao: mapComposicao(response.composicaoResultado),
    historico: mapHistorico(response.historicoResultado),
    acumuladoAno: mapAcumuladoAno(response.acumuladoAno),
    vvrSerieAnual: mapVvrSerieAnual(response.vvrSerieAnual),
    alertas: mapAlertas(response.analysis),
    semaforo: customKpis
      ? mapSemaforoFromList(response.analysis, customKpis)
      : mapSemaforo(response.analysis, response.kpis, response.previstoRealizado),
    diagnosticoPrincipal: mapDiagnostico(response.analysis),
    acoes: mapAcoes(response.analysis),
    // Allowlist de blocos visíveis (undefined = todos — comportamento Viva).
    blocks: response.enabledBlocks,
    // Título do gráfico de histórico (undefined = título atual no componente).
    historicoTitle: response.historicoTitle,
    historicoKLabels: response.historicoKLabels,
    // Nº de colunas da grade de KPIs (undefined = 4).
    kpiColumns: response.kpiColumns,
    // Título da seção de KPIs. Templates com KPIs custom (ex.: SGX) trazem
    // cards de resultado/indicador próprios — não os de "Saúde financeira &
    // caixa" da Viva; um título neutro evita rótulo enganoso.
    kpiSectionTitle: customKpis ? "Indicadores do mês" : undefined,
    // Quadro de eventos da Feat Produções — passa direto (já vem no shape do
    // componente); undefined para todas as demais empresas.
    featEventos: response.featEventos,
    featContasReceberAberto: response.featContasReceberAberto,
    // Saldo final da Custódia de Artistas (Case Shows) — passa direto (já vem
    // em R$ cheios, mesmo shape do componente). undefined nas demais empresas.
    custodyClosing: response.custodyClosing,
    // Quadro de indicadores por conta DRE (Terrazzo — "Locação de Espaço") —
    // passa direto (R$ cheios). undefined p/ templates que não o configuram.
    indicadoresDre: response.indicadoresDre,
    // Comparativo das empresas da holding (Hero Holding) — undefined nas demais.
    holdingComparativo: mapHoldingComparativo(response.holdingComparativo),
    // Gráficos extras por template (Village): R$ → "mil" (÷1000).
    barsSerie: response.barsSerie?.map((p) => ({
      mes: p.mes,
      valor: p.valor === null ? null : p.valor / 1000,
    })),
    barsTitle: response.barsTitle,
    barsAcum:
      response.barsAcum === null || response.barsAcum === undefined
        ? response.barsAcum
        : response.barsAcum / 1000,
    linesSerie: response.linesSerie?.map((p) => ({
      mes: p.mes,
      values: p.values.map((v) => (v === null ? null : v / 1000)),
    })),
    linesSeriesLabels: response.linesSeriesLabels,
    linesTitle: response.linesTitle,
    linesAcum: response.linesAcum?.map((v) => (v === null ? null : v / 1000)),
    linesAcumBaseIndex: response.linesAcumBaseIndex,
    prevRealCharts: response.prevRealCharts?.map((c) => ({
      title: c.title,
      serie: c.serie.map((p) => ({
        mes: p.mes,
        previsto: p.previsto === null ? null : p.previsto / 1000,
        realizado: p.realizado === null ? null : p.realizado / 1000,
      })),
      previstoAcum: c.previstoAcum === null ? null : c.previstoAcum / 1000,
      realizadoAcum: c.realizadoAcum === null ? null : c.realizadoAcum / 1000,
    })),
    consolidated: response.consolidated
      ? {
          title: response.consolidated.title,
          rows: response.consolidated.rows.map((r) => ({
            label: r.label,
            previsto: r.previsto === null ? null : r.previsto / 1000,
            realizado: r.realizado === null ? null : r.realizado / 1000,
            emphasis: r.emphasis,
          })),
          acum: response.consolidated.acum
            ? {
                previsto:
                  response.consolidated.acum.previsto === null
                    ? null
                    : response.consolidated.acum.previsto / 1000,
                realizado:
                  response.consolidated.acum.realizado === null
                    ? null
                    : response.consolidated.acum.realizado / 1000,
              }
            : undefined,
        }
      : undefined,
    historicoAcum: response.historicoAcum
      ? {
          previsto:
            response.historicoAcum.previsto === null
              ? null
              : response.historicoAcum.previsto / 1000,
          realizado:
            response.historicoAcum.realizado === null
              ? null
              : response.historicoAcum.realizado / 1000,
        }
      : undefined,
    // Bloco Performance por Parceiro (ex.: Young Med): valores R$ → "mil".
    partnerPerformance: response.partnerPerformance
      ? {
          title: response.partnerPerformance.title,
          categoria: response.partnerPerformance.categoria,
          partners: response.partnerPerformance.partners.map((p) => ({
            nome: p.nome,
            realizadoMes: p.realizadoMes / 1000,
            pctMes: p.pctMes,
            realizadoAcum: p.realizadoAcum / 1000,
            pctAcum: p.pctAcum,
          })),
          totalMes: response.partnerPerformance.totalMes / 1000,
          totalAcum: response.partnerPerformance.totalAcum / 1000,
        }
      : undefined,
    // Blocos de breakdown (ex.: Spot): valores R$ → "mil"; % já vem pronto.
    breakdownBlocks: response.breakdownBlocks?.map((b) => ({
      key: b.key,
      title: b.title,
      rows: b.rows.map((r) => ({
        label: r.label,
        value: r.value / 1000,
        pct: r.pct,
        emphasis: r.emphasis,
      })),
    })),
  };
}
