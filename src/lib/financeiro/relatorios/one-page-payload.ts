import type { SupabaseClient } from "@supabase/supabase-js";

import {
  buildDashboardRows,
  fetchAllDreAccountRows,
  scopeDreAccounts,
  type RawDreAccount,
} from "@/lib/dashboard/dre";
import { resolveFranquiasVivaCustosNegation } from "@/lib/dashboard/franquias-viva-custos";
import type { OnePageInput } from "@/lib/intelligence/one-page-schema";

import {
  buildCaseShowsCustodyClosing,
  type CaseShowsCustodyClosingPayload,
} from "./case-shows-custody-closing";
import { buildFeatEventos, type FeatEventosPayload } from "./feat-eventos";
import { resolveReportTemplate } from "./templates/report-template-registry";
import type { ReportTemplateId } from "./templates/report-template-types";

// ============================================================================
// buildOnePagePayload — calculo numerico compartilhado entre a rota oficial
// e a rota dev-only "sem IA".
//
// Recebe `supabase` + body (companyId, dateFrom, dateTo, periodLabel?) e
// devolve TODOS os blocos numericos prontos para serem retornados ao
// cliente: `input`, `kpis`, `previstoRealizado`, `composicaoResultado`,
// `historicoResultado` e `generatedAt`.
//
// O caller decide o que fazer com `payload.input` — a rota oficial envia
// para o motor de IA; a rota dev-only injeta uma analysis mockada.
//
// Errors sao retornados como `{ ok: false, status, error }`. O caller
// transforma em `NextResponse.json(...)` com o status apropriado.
// ============================================================================

// Nomes longos de mês (pt-BR) — usado só como fallback do rótulo de referência
// do quadro Feat quando `periodLabel` não é informado pelo caller.
const MONTH_NAMES_LONG = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

// ─── Tipos da resposta (espelho do que sai do helper) ─────────────────────

type KpiStatus = "positivo" | "neutro" | "atencao" | "critico";

export interface KpiCardPayload {
  label: string;
  value: number | null;
  formattedValue: string | null;
  variationValue: number | null;
  variationLabel: string | null;
  status: KpiStatus;
  // Quando true, o card não concatena " vs orçamento" (ex.: Margem Líquida,
  // que é um indicador % sem comparação com orçado).
  omitComparisonSuffix?: boolean;
}

// Bloco "Performance por Parceiro" (ex.: Young Med): realizado por fornecedor
// (supplier_customer) da conta de parceiros, no mês e no acumulado do ano.
// Valores em R$ (o mapper divide por 1000 p/ escala "mil"); percentuais já
// vêm prontos. Orçamento por fornecedor não existe → realizado-only.
export interface PartnerPerformancePayload {
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

// Bloco de BREAKDOWN (ex.: Spot — Composição da Receita, Frete). Cada linha tem
// valor realizado (em R$; o mapper divide por 1000) e % opcional sobre o total
// das linhas sem `emphasis`. `key` = ReportBlockKey p/ gating no preview.
export interface BreakdownBlockPayload {
  key: string;
  title: string;
  rows: Array<{ label: string; value: number; pct: number | null; emphasis: boolean }>;
}

// Quadro de INDICADORES por conta DRE (ex.: Terrazzo — "Locação de Espaço").
// Cada item = realizado no período de referência (mês selecionado). Valores em
// R$ cheios (o componente formata). `key` = ReportBlockKey p/ gating.
export interface DreIndicatorsPayload {
  key: string;
  title: string;
  referenciaLabel: string;
  items: Array<{ label: string; value: number }>;
}

export interface KpisPayload {
  receita: KpiCardPayload;
  despesas: KpiCardPayload;
  resultado: KpiCardPayload;
  margem: KpiCardPayload;
  // Blocos específicos de Franquias Viva — OPCIONAIS: só entram quando o
  // template da empresa os suporta (capabilities.vvrFee / .sobrevivenciaCaixa).
  // Templates Real Estate/genérico os omitem, e o mapper não renderiza o card.
  fee_disponivel?: KpiCardPayload;
  vvr?: KpiCardPayload;
  // Sobrevivencia de caixa: por quantos meses o FEE disponivel cobre a
  // media das despesas operacionais dos meses ja fechados do ano corrente.
  sobrevivencia_caixa?: KpiCardPayload;
  // Presente apenas para empresas do segmento Franquias Viva — indicador
  // manual preenchido em Configuracoes > Empresas > FEE / VVR. Em demais
  // segmentos a chave nao e enviada (mapper ignora ausencia).
  margem_media_eventos?: KpiCardPayload;
}

export interface PrevistoRealizadoPayload {
  label: string;
  realizado: number | null;
  previsto: number | null;
  unidade: "currency" | "percent" | "number";
  // Agrupamento opcional da tabela (subtítulo) + nota de rodapé. Só templates
  // com `report.previstoRealizado` os definem; demais ficam undefined.
  group?: string;
  footnote?: string;
}

export interface ComposicaoPayload {
  label: string;
  value: number;
  type: "entrada" | "saida" | "resultado";
}

export interface HistoricoPayload {
  mes: string;
  previsto: number | null;
  realizado: number | null;
}

// Gráfico de colunas (acumulado do ano, só realizado). Ex.: Village — Gap.
export interface BarSeriePayload {
  mes: string;
  valor: number | null;
}

// Gráfico de linhas multi-série (6 meses). `values` alinha com `linesSeriesLabels`.
export interface MultiLineSeriePayload {
  mes: string;
  values: (number | null)[];
}

// Gráfico de colunas Previsto × Realizado mensal (acum. do ano) + acumulado.
export interface PrevRealChartPayload {
  title: string;
  serie: { mes: string; previsto: number | null; realizado: number | null }[];
  previstoAcum: number | null;
  realizadoAcum: number | null;
}

// Bloco consolidado de um grupo de empresas (ex.: Salvaterra). Cada linha =
// Resultado de uma empresa; a última (emphasis) = soma consolidada.
export interface ConsolidatedRowPayload {
  label: string;
  previsto: number | null;
  realizado: number | null;
  emphasis?: boolean;
}
export interface ConsolidatedPayload {
  title: string;
  rows: ConsolidatedRowPayload[];
  // Acumulado do ano (Jan→análise) do consolidado: previsto + realizado.
  acum?: { previsto: number | null; realizado: number | null };
}

// Serie temporal do VVR de Jan/ano(dateTo) ate o mes(dateTo). Realizado vira
// barras no chart; meta vira linha sobreposta.
export interface VvrSerieAnualPayload {
  mes: string;
  realizado: number | null;
  meta: number | null;
}

export interface OnePagePayload {
  input: OnePageInput;
  generatedAt: string;
  // Template de relatório resolvido para a empresa (rótulo discreto de debug).
  template: { id: ReportTemplateId; name: string };
  kpis: KpisPayload;
  // KPIs CUSTOM por conta DRE (templates com `report.kpiCards`, ex.: SGX).
  // Quando presente, a UI usa esta lista no lugar do conjunto fixo `kpis`.
  kpisList?: KpiCardPayload[];
  // Allowlist de blocos visíveis (templates com `report.enabledBlocks`).
  // Ausência = todos os blocos (comportamento atual de Franquias Viva).
  enabledBlocks?: string[];
  // Título do gráfico de histórico (templates com `report.historicoTitle`).
  // Ausência = título atual no componente (Franquias Viva inalterado).
  historicoTitle?: string;
  // Rótulos do histórico em "Xk" (milhar) — só templates que pedem (ex.: SGX).
  historicoKLabels?: boolean;
  // Nº de colunas da grade de KPIs (templates com `report.kpiColumns`).
  // Ausência = 4 (comportamento atual).
  kpiColumns?: number;
  previstoRealizado: PrevistoRealizadoPayload[];
  composicaoResultado: ComposicaoPayload[];
  historicoResultado: HistoricoPayload[];
  // Acumulado do ano: mesma forma do `previstoRealizado` mas com os valores
  // somados de Jan/ano(dateTo) ate o mes(dateTo).
  acumuladoAno: PrevistoRealizadoPayload[];
  vvrSerieAnual: VvrSerieAnualPayload[];
  // Quadro gerencial de eventos — EXCLUSIVO da Feat Produções. Ausente
  // (undefined) para todas as demais empresas. Alimenta o quadro próprio no
  // One Page Report (2 indicadores + 2 gráficos por tipo de evento).
  featEventos?: FeatEventosPayload;
  // Saldo final da "Custódia de Artistas" (regime de caixa + competência) —
  // EXCLUSIVO da Case Shows. Ausente (undefined) para todas as demais empresas.
  custodyClosing?: CaseShowsCustodyClosingPayload;
  // Quadro de indicadores por conta DRE (ex.: Terrazzo — "Locação de Espaço").
  // Ausência = não renderiza (só templates com `report.indicadoresDre`).
  indicadoresDre?: DreIndicatorsPayload;
  // Gráficos extras por template (ex.: Village). Ausência = não renderiza.
  // `barsChart`: colunas do acumulado do ano (Jan→mês de análise, realizado).
  // `linesChart`: linhas dos últimos 6 meses (N séries; labels separados).
  barsSerie?: BarSeriePayload[];
  barsTitle?: string;
  // Acumulado do ano (Jan→análise) do gráfico de colunas (ex.: Gap total).
  barsAcum?: number | null;
  linesSerie?: MultiLineSeriePayload[];
  linesSeriesLabels?: string[];
  linesTitle?: string;
  // Acumulado do ano por série do gráfico de linhas (3 barras horizontais).
  linesAcum?: (number | null)[];
  // Índice da série orçada — baseline da variação % das demais barras.
  linesAcumBaseIndex?: number;
  // Gráficos de colunas Previsto × Realizado mensais (ex.: SGX Locações/Projetos).
  prevRealCharts?: PrevRealChartPayload[];
  // Bloco consolidado do grupo (ex.: Salvaterra). undefined p/ os demais.
  consolidated?: ConsolidatedPayload;
  // Acumulado do ano (Jan→análise) do métrico do gráfico de histórico
  // (previsto + realizado) — rodapé do gráfico. undefined quando sem histórico.
  historicoAcum?: { previsto: number | null; realizado: number | null };
  // Bloco Performance por Parceiro (ex.: Young Med). undefined p/ os demais.
  partnerPerformance?: PartnerPerformancePayload;
  // Blocos de breakdown (ex.: Spot — composição/frete). undefined p/ os demais.
  breakdownBlocks?: BreakdownBlockPayload[];
}

export type BuildOnePagePayloadResult =
  | { ok: true; payload: OnePagePayload }
  | { ok: false; status: number; error: string };

// ─── Tipos internos para queries ──────────────────────────────────────────

interface BudgetRow {
  dre_account_id: string;
  amount: number | string;
  year: number;
  month: number;
}

interface AggregateRow {
  dre_account_id: string;
  amount: number | string;
}

interface FeeVvrRow {
  vvr_meta: number | string | null;
  vvr: number | string | null;
}

interface BuildOnePagePayloadBody {
  companyId: string;
  dateFrom: string;
  dateTo: string;
  periodLabel?: string;
}

// ─── Implementacao ────────────────────────────────────────────────────────

export async function buildOnePagePayload(
  supabase: SupabaseClient,
  body: BuildOnePagePayloadBody,
): Promise<BuildOnePagePayloadResult> {
  const { companyId, dateFrom, dateTo, periodLabel } = body;

  // -------------------------------------------------------------------------
  // 1. Empresa + plano de contas DRE (scope custom/global, mesma logica do
  //    dashboard).
  // -------------------------------------------------------------------------
  const { data: company } = await supabase
    .from("companies")
    .select("id,name,fee_disponivel,fee_a_receber,margem_media_eventos,segment_id")
    .eq("id", companyId)
    .maybeSingle<{
      id: string;
      name: string;
      fee_disponivel: number | string | null;
      fee_a_receber: number | string | null;
      margem_media_eventos: number | string | null;
      segment_id: string | null;
    }>();
  if (!company) {
    return { ok: false, status: 404, error: "Empresa nao encontrada." };
  }

  // Resolve o slug do segmento da empresa. O KPI "Margem media dos eventos"
  // so e renderizado quando segmento = franquias-viva — empresas de outros
  // segmentos nunca exibem esse indicador, mesmo que o valor tenha sido
  // gravado por engano via API.
  let segmentSlug: string | null = null;
  let segmentNome: string | null = null;
  if (company.segment_id) {
    const { data: seg } = await supabase
      .from("segments")
      .select("slug,name")
      .eq("id", company.segment_id)
      .maybeSingle<{ slug: string; name: string }>();
    segmentSlug = seg?.slug ?? null;
    segmentNome = seg?.name ?? null;
  }
  const isFranquiasViva = segmentSlug === "franquias-viva";

  // Template de relatório da empresa (camada de templates por empresa/segmento).
  // Decide quais blocos específicos de Franquias Viva entram no payload e no
  // input da IA. Franquias Viva resolve para um template com TODAS as
  // capacidades ligadas → saída idêntica ao comportamento atual.
  const template = resolveReportTemplate({
    companyId,
    companyName: company.name,
    segmentSlug,
  });
  // Code do histórico principal: default "11" (Resultado do Exercício); o
  // template pode sobrescrever (ex.: SGX usa "15" = Resultado Consolidado).
  const historicoCode = template.report?.historicoAccountCode ?? "11";

  // Paginado: o cap de 1000 do PostgREST truncava os codes "8"/"9" (ver fetchAllDreAccountRows).
  const allAccounts = await fetchAllDreAccountRows<RawDreAccount>((from, to) =>
    supabase
      .from("dre_accounts")
      .select("id,code,name,parent_id,level,type,is_summary,formula,sort_order,active,company_id")
      .eq("active", true)
      .order("code")
      .range(from, to),
  );
  // Escopo + tradutor de ids identicos ao dashboard. CRITICO: a RPC
  // `dashboard_dre_aggregate` devolve valores indexados pelo id da conta com
  // que o agregado foi materializado (frequentemente a conta GLOBAL), mesmo
  // quando a empresa tem plano custom. Sem traduzir rawId → code → scopedId,
  // os valores nao casam com `accounts` (custom) e todos os KPIs zeram.
  const { coreAccounts: accounts, translateToScopedId } = scopeDreAccounts(allAccounts, [companyId]);

  // Franquias Viva: "Receitas Ressarciveis - Fundos" (5.8) é receita dentro do
  // grupo de custos (5) e reduz o total — mesma regra do Dashboard DRE, para o
  // One Page (KPIs, Previsto x Realizado, Composição, Histórico) não divergir da
  // tela. Inerte para outros segmentos. `segmentSlug` já resolvido acima.
  const custosNegation = resolveFranquiasVivaCustosNegation(segmentSlug, accounts);

  // -------------------------------------------------------------------------
  // 2. Agregar DRE realizado no periodo
  // -------------------------------------------------------------------------
  const { data: realizedAgg, error: realizedErr } = await supabase.rpc(
    "dashboard_dre_aggregate",
    {
      p_company_ids: [companyId],
      p_date_from: dateFrom,
      p_date_to: dateTo,
    },
  );
  if (realizedErr) {
    return {
      ok: false,
      status: 500,
      error: `Falha ao agregar DRE: ${realizedErr.message}`,
    };
  }
  const realizedMap = new Map<string, number>();
  ((realizedAgg ?? []) as AggregateRow[]).forEach((r) => {
    const scopedId = translateToScopedId(r.dre_account_id);
    if (!scopedId) return;
    realizedMap.set(scopedId, (realizedMap.get(scopedId) ?? 0) + Number(r.amount));
  });

  // -------------------------------------------------------------------------
  // 3. Agregar orcamento no periodo
  // -------------------------------------------------------------------------
  const fromYear = parseInt(dateFrom.slice(0, 4), 10);
  const fromMonth = parseInt(dateFrom.slice(5, 7), 10);
  const toYear = parseInt(dateTo.slice(0, 4), 10);
  const toMonth = parseInt(dateTo.slice(5, 7), 10);

  const { data: budgetRows } = await supabase
    .from("budget_entries")
    .select("dre_account_id, amount, year, month")
    .eq("company_id", companyId)
    .gte("year", fromYear)
    .lte("year", toYear);

  const budgetMap = new Map<string, number>();
  ((budgetRows ?? []) as BudgetRow[]).forEach((b) => {
    const inRange =
      b.year > fromYear || (b.year === fromYear && b.month >= fromMonth);
    const beforeEnd =
      b.year < toYear || (b.year === toYear && b.month <= toMonth);
    if (inRange && beforeEnd) {
      const scopedId = translateToScopedId(b.dre_account_id);
      if (!scopedId) return;
      budgetMap.set(scopedId, (budgetMap.get(scopedId) ?? 0) + Number(b.amount));
    }
  });

  // -------------------------------------------------------------------------
  // 4. Build de linhas com formulas aplicadas (mesmo motor do dashboard)
  // -------------------------------------------------------------------------
  const { rows: realizedRows } = buildDashboardRows(accounts, realizedMap, {
    negateChildCodesInSummary: custosNegation,
  });
  const { rows: budgetedRows } = buildDashboardRows(accounts, budgetMap, {
    negateChildCodesInSummary: custosNegation,
  });
  const budgetedById = new Map(budgetedRows.map((r) => [r.id, r]));

  // -------------------------------------------------------------------------
  // 5. Indicadores DRE enviados a IA (nivel <= 2, cap 30)
  // -------------------------------------------------------------------------
  const SELECTED_LEVELS = new Set([1, 2]);
  const dreInput = realizedRows
    .filter((r) => SELECTED_LEVELS.has(r.level))
    .slice(0, 30)
    .map((r) => {
      const realizado = r.value;
      const budgetedRow = budgetedById.get(r.id);
      const orcado = budgetedRow ? budgetedRow.value : null;
      const variacaoAbs =
        orcado !== null ? Number((realizado - orcado).toFixed(2)) : null;
      const variacaoPctV =
        orcado !== null && orcado !== 0
          ? Number((((realizado - orcado) / Math.abs(orcado)) * 100).toFixed(2))
          : null;
      return {
        code: r.code,
        name: r.name,
        realizado: Number(realizado.toFixed(2)),
        orcado: orcado !== null ? Number(orcado.toFixed(2)) : null,
        variacao_absoluta: variacaoAbs,
        variacao_percentual: variacaoPctV,
        pct_receita_liquida:
          r.percentageOverNetRevenue !== null &&
          r.percentageOverNetRevenue !== undefined
            ? Number(r.percentageOverNetRevenue.toFixed(2))
            : null,
      };
    });

  if (dreInput.length === 0) {
    return {
      ok: false,
      status: 400,
      error: "Nenhum indicador DRE disponivel para o periodo selecionado.",
    };
  }

  // -------------------------------------------------------------------------
  // 6. FEE/VVR do periodo
  // -------------------------------------------------------------------------
  const { data: feeVvrRows } = await supabase
    .from("company_fee_vvr")
    .select("vvr_meta, vvr, year, month")
    .eq("company_id", companyId)
    .gte("year", fromYear)
    .lte("year", toYear);

  let feeSum = 0;
  let vvrSum = 0;
  let hasAny = false;
  ((feeVvrRows ?? []) as Array<FeeVvrRow & { year: number; month: number }>).forEach(
    (row) => {
      const inRange =
        row.year > fromYear || (row.year === fromYear && row.month >= fromMonth);
      const beforeEnd =
        row.year < toYear || (row.year === toYear && row.month <= toMonth);
      if (inRange && beforeEnd) {
        const vvrMeta = row.vvr_meta !== null ? Number(row.vvr_meta) : null;
        const vvr = row.vvr !== null ? Number(row.vvr) : null;
        if (vvrMeta !== null) {
          feeSum += vvrMeta;
          hasAny = true;
        }
        if (vvr !== null) {
          vvrSum += vvr;
          hasAny = true;
        }
      }
    },
  );

  const feeVvrInput = hasAny
    ? {
        fee_mes: Number(feeSum.toFixed(2)),
        vvr_mes: Number(vvrSum.toFixed(2)),
        vvr_meta_mes: Number(feeSum.toFixed(2)),
      }
    : null;

  // -------------------------------------------------------------------------
  // 7. Input final (enviado a IA na rota oficial)
  //
  // O `fee_disponivel` (snapshot atual) tambem entra no input pra IA poder
  // calibrar a regra de saude financeira ("FEE Disponivel cobre 2+ meses
  // de despesas? entao nao e Crítica"). O mesmo valor e reusado mais
  // abaixo pelo KPI card de FEE Disponivel.
  // -------------------------------------------------------------------------
  const feeDisponivel =
    company.fee_disponivel === null || company.fee_disponivel === undefined
      ? null
      : Number(company.fee_disponivel);

  // Rótulo de referência do quadro de eventos da Feat (fallback do periodLabel).
  // O bloco em si (6b) é montado mais abaixo, após o cálculo do Resultado do
  // Exercício acumulado do DRE — que é a base da projeção gerencial.
  const referenciaLabel =
    periodLabel ?? `${MONTH_NAMES_LONG[toMonth - 1]}/${toYear}`;

  const input: OnePageInput = {
    empresa: { id: company.id, nome: company.name },
    periodo: {
      date_from: dateFrom,
      date_to: dateTo,
      label: periodLabel ?? `${dateFrom} a ${dateTo}`,
    },
    dre: dreInput,
    fee_vvr: feeVvrInput,
    fee_disponivel: feeDisponivel,
    // Segmento da empresa — usado pelo motor de IA para escolher o contexto
    // de negocio correto (regras Franquias Viva vs. prompt generico).
    segmento: { slug: segmentSlug, nome: segmentNome },
    // `feat_eventos` é injetado no retorno final (depende do Resultado do
    // Exercício acumulado do DRE, calculado mais abaixo).
  };

  // -------------------------------------------------------------------------
  // 8. Derivacoes numericas (sem IA): KPIs, Previsto x Realizado, Composicao
  // -------------------------------------------------------------------------
  const realizedByCode = new Map<string, number>();
  realizedRows.forEach((r) => realizedByCode.set(r.code, r.value));
  const budgetedByCode = new Map<string, number>();
  budgetedRows.forEach((r) => budgetedByCode.set(r.code, r.value));

  const getRealized = (code: string): number => realizedByCode.get(code) ?? 0;
  const getBudgeted = (code: string): number | null => {
    const v = budgetedByCode.get(code);
    return v === undefined ? null : v;
  };

  // Soma de várias contas (ex.: Receitas Operacionais = code 1 + code 12).
  // Orçado: soma só as contas com orçamento; null quando nenhuma tem.
  const sumRealized = (codes: string[]): number =>
    codes.reduce((s, c) => s + getRealized(c), 0);
  const sumBudgeted = (codes: string[]): number | null => {
    let any = false;
    let total = 0;
    for (const c of codes) {
      const b = getBudgeted(c);
      if (b !== null) {
        any = true;
        total += b;
      }
    }
    return any ? total : null;
  };

  const receitaLiquidaRealizada = getRealized("4");
  const resultadoRealizado = getRealized("11");
  const receitaLiquidaOrcada = getBudgeted("4");
  const resultadoOrcado = getBudgeted("11");

  const margemRealizada =
    receitaLiquidaRealizada > 0
      ? (resultadoRealizado / receitaLiquidaRealizada) * 100
      : null;
  const margemPrevista =
    receitaLiquidaOrcada !== null &&
    receitaLiquidaOrcada > 0 &&
    resultadoOrcado !== null
      ? (resultadoOrcado / receitaLiquidaOrcada) * 100
      : null;
  const variacaoMargemPp =
    margemRealizada !== null && margemPrevista !== null
      ? margemRealizada - margemPrevista
      : null;

  const variacaoPct = (real: number, orc: number | null): number | null => {
    if (orc === null || orc === 0) return null;
    return ((real - orc) / Math.abs(orc)) * 100;
  };

  const statusFromVariacaoPercent = (varPct: number | null): KpiStatus => {
    if (varPct === null) return "neutro";
    if (varPct >= 0) return "positivo";
    if (varPct >= -5) return "atencao";
    return "critico";
  };
  // Despesas tem direcao invertida: gastar MENOS que o orcado = bom.
  const statusDespesasFromVariacao = (varPct: number | null): KpiStatus => {
    if (varPct === null) return "neutro";
    if (varPct <= 0) return "positivo";
    if (varPct <= 5) return "atencao";
    return "critico";
  };
  const statusMargemPp = (varPp: number | null): KpiStatus => {
    if (varPp === null) return "neutro";
    if (varPp >= 0) return "positivo";
    if (varPp >= -1) return "atencao";
    return "critico";
  };
  const statusFeeDisponivel = (v: number | null): KpiStatus => {
    if (v === null) return "neutro";
    if (v > 0) return "neutro";
    if (v === 0) return "atencao";
    return "critico";
  };
  // Farol da Sobrevivencia de caixa (em meses). Regra: >=6 verde, <=3
  // vermelho, intermediario amarelo. Calculado a partir do valor ja
  // computado (sobrevivenciaCaixaMeses); nao altera o calculo.
  const statusSobrevivenciaCaixa = (n: number | null): KpiStatus => {
    if (n === null) return "neutro";
    if (n >= 6) return "positivo";
    if (n <= 3) return "critico";
    return "atencao";
  };
  // Farol da Margem media dos eventos (em %). Regra: >=15 verde, <=5
  // vermelho, intermediario amarelo. So aplica ao valor informado.
  const statusMargemMediaEventos = (v: number | null): KpiStatus => {
    if (v === null) return "neutro";
    if (v >= 15) return "positivo";
    if (v <= 5) return "critico";
    return "atencao";
  };

  const formatBRL = (v: number) =>
    v.toLocaleString("pt-BR", {
      style: "decimal",
      maximumFractionDigits: 0,
    });
  const formatPctFn = (v: number) => `${v.toFixed(1)}%`;
  const formatPp = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)} p.p.`;
  const formatVarPct = (v: number | null) =>
    v === null ? null : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

  const vvrRealizado = feeVvrInput?.vvr_mes ?? null;
  const vvrMetaPeriodo = feeVvrInput?.vvr_meta_mes ?? null;
  const varReceita = variacaoPct(getRealized("1"), getBudgeted("1"));
  const despesasRealizadas = getRealized("7");
  const despesasOrcadas = getBudgeted("7");
  const varDespesas = variacaoPct(despesasRealizadas, despesasOrcadas);
  const varResultado = variacaoPct(resultadoRealizado, resultadoOrcado);
  const varVvr =
    vvrRealizado !== null && vvrMetaPeriodo !== null
      ? variacaoPct(vvrRealizado, vvrMetaPeriodo)
      : null;

  // -------------------------------------------------------------------------
  // 8b. Sobrevivencia de caixa
  //
  // Por quantos meses o FEE disponivel cobre a media das despesas
  // operacionais (code "7") dos meses JA FECHADOS do ano corrente. O
  // calculo e independente do periodo selecionado: usa sempre o ano e o
  // mes do "hoje" do servidor — o mes corrente nunca conta como fechado,
  // mesmo quando o usuario esta visualizando-o.
  //
  // Atualizacao automatica: a cada virada de mes, o mes anterior passa a
  // entrar na media sem nenhuma intervencao manual. Em janeiro nao ha
  // meses fechados no ano corrente — o card cai para null/"—".
  //
  // Fontes reutilizadas (sem duplicar logica):
  //   - FEE disponivel: `feeDisponivel` ja resolvido acima (mesma fonte
  //     do card "FEE Disponivel").
  //   - Despesas operacionais: RPC `dashboard_dre_aggregate` + plano DRE
  //     escopado por empresa, mesmo motor do dashboard.
  // -------------------------------------------------------------------------
  const today = new Date();
  const currentYear = today.getUTCFullYear();
  const currentMonth = today.getUTCMonth() + 1;
  const closedMonthsCount = currentMonth - 1;

  let sobrevivenciaCaixaMeses: number | null = null;
  if (closedMonthsCount >= 1 && feeDisponivel !== null) {
    const lastDay = new Date(
      Date.UTC(currentYear, closedMonthsCount, 0),
    ).getUTCDate();
    const closedFrom = `${currentYear}-01-01`;
    const closedTo = `${currentYear}-${String(closedMonthsCount).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

    const { data: closedAgg, error: closedErr } = await supabase.rpc(
      "dashboard_dre_aggregate",
      {
        p_company_ids: [companyId],
        p_date_from: closedFrom,
        p_date_to: closedTo,
      },
    );

    if (!closedErr) {
      const closedMap = new Map<string, number>();
      ((closedAgg ?? []) as AggregateRow[]).forEach((r) => {
        const scopedId = translateToScopedId(r.dre_account_id);
        if (!scopedId) return;
        closedMap.set(scopedId, (closedMap.get(scopedId) ?? 0) + Number(r.amount));
      });
      const { rows: closedRows } = buildDashboardRows(accounts, closedMap, {
        negateChildCodesInSummary: custosNegation,
      });
      const despesasOpTotal = Math.abs(
        closedRows.find((r) => r.code === "7")?.value ?? 0,
      );
      if (despesasOpTotal > 0) {
        const mediaDespesasOp = despesasOpTotal / closedMonthsCount;
        if (mediaDespesasOp > 0) {
          sobrevivenciaCaixaMeses = Math.round(feeDisponivel / mediaDespesasOp);
        }
      }
    }
  }

  const formatMeses = (n: number) => `${n} ${n === 1 ? "mês" : "meses"}`;

  const kpis: KpisPayload = {
    receita: {
      label: "Receita",
      value: getRealized("1"),
      formattedValue: formatBRL(getRealized("1")),
      variationValue: varReceita,
      variationLabel: formatVarPct(varReceita),
      status: statusFromVariacaoPercent(varReceita),
    },
    despesas: {
      label: "Despesas",
      value: despesasRealizadas,
      formattedValue: formatBRL(Math.abs(despesasRealizadas)),
      variationValue: varDespesas,
      variationLabel: formatVarPct(varDespesas),
      status: statusDespesasFromVariacao(varDespesas),
    },
    resultado: {
      label: "Resultado",
      value: resultadoRealizado,
      formattedValue: formatBRL(resultadoRealizado),
      variationValue: varResultado,
      variationLabel: formatVarPct(varResultado),
      status: statusFromVariacaoPercent(varResultado),
    },
    margem: {
      label: "Margem",
      value: margemRealizada,
      formattedValue:
        margemRealizada !== null ? formatPctFn(margemRealizada) : null,
      variationValue: variacaoMargemPp,
      variationLabel:
        variacaoMargemPp !== null ? formatPp(variacaoMargemPp) : null,
      status: statusMargemPp(variacaoMargemPp),
    },
    fee_disponivel: {
      label: "FEE Disponível",
      value: feeDisponivel,
      formattedValue: feeDisponivel !== null ? formatBRL(feeDisponivel) : null,
      variationValue: null,
      variationLabel: "Saldo atual",
      status: statusFeeDisponivel(feeDisponivel),
    },
    vvr: {
      label: "VVR",
      value: vvrRealizado,
      formattedValue: vvrRealizado !== null ? formatBRL(vvrRealizado) : null,
      variationValue: varVvr,
      variationLabel: formatVarPct(varVvr),
      status: statusFromVariacaoPercent(varVvr),
    },
    sobrevivencia_caixa: {
      label: "Sobrevivência de caixa",
      value: sobrevivenciaCaixaMeses,
      formattedValue:
        sobrevivenciaCaixaMeses !== null
          ? formatMeses(sobrevivenciaCaixaMeses)
          : null,
      variationValue: null,
      variationLabel: "Cobertura do FEE",
      status: statusSobrevivenciaCaixa(sobrevivenciaCaixaMeses),
    },
  };

  // KPI extra "Margem media dos eventos": valor manual por empresa,
  // exibido como percentual. So entra no payload para empresas do segmento
  // Franquias Viva — para outros segmentos a chave fica ausente e o mapper
  // nao renderiza o card. NULL e tratado como "—" no formattedValue.
  if (isFranquiasViva) {
    const margemMediaEventos =
      company.margem_media_eventos === null ||
      company.margem_media_eventos === undefined
        ? null
        : Number(company.margem_media_eventos);
    kpis.margem_media_eventos = {
      label: "Margem média dos eventos",
      value: margemMediaEventos,
      formattedValue:
        margemMediaEventos !== null ? formatPctFn(margemMediaEventos) : null,
      variationValue: null,
      variationLabel: "Valor informado",
      status: statusMargemMediaEventos(margemMediaEventos),
    };
  }

  // Gating por template: remove os cards específicos de Franquias Viva quando o
  // template da empresa não os suporta (Real Estate / genérico). Franquias Viva
  // tem todas as capacidades = true, então NADA é removido (saída idêntica).
  if (!template.capabilities.vvrFee) {
    delete kpis.fee_disponivel;
    delete kpis.vvr;
  }
  if (!template.capabilities.sobrevivenciaCaixa) {
    delete kpis.sobrevivencia_caixa;
  }

  // -------------------------------------------------------------------------
  // 8b. Performance por PARCEIRO (ex.: Young Med). Quebra os FORNECEDORES
  //     (supplier_customer) da conta `partnerAccountCode` (ex.: 1.1 = BVs) via
  //     drill-down (RPC dashboard_dre_drilldown — casa por code, estável). Mês
  //     [dateFrom..dateTo] + acumulado do ano (Jan→análise). Orçamento existe
  //     por CONTA, não por fornecedor → bloco realizado-only. "Turmas Heppi"
  //     (outra conta) fica naturalmente fora. Só roda quando o template
  //     configura `partnerPerformance` ou um card `kind: "parceiro"`.
  // -------------------------------------------------------------------------
  const partnerCfg = template.report?.partnerPerformance;
  const parceiroCardSpec = template.report?.kpiCards?.find((c) => c.kind === "parceiro");
  const partnerAccountCode = partnerCfg?.accountCode ?? parceiroCardSpec?.partnerAccountCode;
  let partnerPerformance: PartnerPerformancePayload | undefined;
  let principalPartner: { nome: string; pct: number | null } | null = null;
  if (partnerAccountCode) {
    const partnerAccId = accounts.find((a) => a.code === partnerAccountCode)?.id;
    if (partnerAccId) {
      const firstName = (s: string) => s.trim().split(/\s+/)[0] || s.trim();
      const drillBySupplier = async (df: string, dt: string) => {
        const { data } = await supabase.rpc("dashboard_dre_drilldown", {
          p_dre_account_id: partnerAccId,
          p_company_ids: [companyId],
          p_date_from: df,
          p_date_to: dt,
          p_search: "",
          p_limit: 1000,
          p_offset: 0,
        });
        const m = new Map<string, number>();
        ((data ?? []) as Array<{ supplier_customer: string | null; value: number | string | null }>).forEach(
          (r) => {
            const nome = (r.supplier_customer ?? "").trim() || "Não identificado";
            m.set(nome, (m.get(nome) ?? 0) + Number(r.value ?? 0));
          },
        );
        return m;
      };
      const consDateFromP = `${toYear}-01-01`;
      const [mesMap, ytdMap] = await Promise.all([
        drillBySupplier(dateFrom, dateTo),
        drillBySupplier(consDateFromP, dateTo),
      ]);
      const totMes = Array.from(mesMap.values()).reduce((a, b) => a + b, 0);
      const totYtd = Array.from(ytdMap.values()).reduce((a, b) => a + b, 0);
      // Principal Parceiro = maior fornecedor no PERÍODO (mês de análise).
      if (mesMap.size > 0) {
        const [topRaw, topVal] = Array.from(mesMap.entries()).sort((a, b) => b[1] - a[1])[0];
        principalPartner = {
          nome: firstName(topRaw),
          pct: totMes !== 0 ? (topVal / totMes) * 100 : null,
        };
      }
      // Linhas do bloco: ordenadas pelo realizado ACUMULADO (desc).
      const allNames = Array.from(mesMap.keys()).concat(Array.from(ytdMap.keys()));
      const partners = Array.from(new Set(allNames))
        .map((raw) => {
          const rMes = mesMap.get(raw) ?? 0;
          const rYtd = ytdMap.get(raw) ?? 0;
          return {
            nome: firstName(raw),
            realizadoMes: rMes,
            pctMes: totMes !== 0 ? (rMes / totMes) * 100 : null,
            realizadoAcum: rYtd,
            pctAcum: totYtd !== 0 ? (rYtd / totYtd) * 100 : null,
          };
        })
        .sort((a, b) => b.realizadoAcum - a.realizadoAcum);
      if (partners.length > 0) {
        partnerPerformance = {
          title: partnerCfg?.title ?? "Performance por Parceiro — Mês e Acumulado",
          categoria: partnerCfg?.categoryLabel ?? null,
          partners,
          totalMes: totMes,
          totalAcum: totYtd,
        };
      }
    }
  }

  // KPIs CUSTOM por conta DRE (templates com report.kpiCards — ex.: SGX).
  // Reutiliza os helpers acima: despesa exibe magnitude (Math.abs) e usa o
  // farol invertido (gastar menos que o previsto = melhor). Receita/Resultado
  // seguem o farol normal (maior = melhor). NÃO inverte sinal armazenado.
  const kpisList: KpiCardPayload[] | undefined = template.report?.kpiCards?.map(
    (spec) => {
      // Card de PARCEIRO (ex.: Young Med "Principal Parceiro"): valor = 1º nome
      // do maior fornecedor da conta no período; subtítulo = % da receita de
      // BVs. Sem comparação com orçado (omitComparisonSuffix). Estado seguro
      // ("—" / "sem dados no período") quando não há fornecedor no período.
      if (spec.kind === "parceiro") {
        const pct = principalPartner?.pct ?? null;
        return {
          label: spec.label,
          value: null,
          formattedValue: principalPartner?.nome ?? "—",
          variationValue: pct,
          variationLabel:
            pct !== null ? `${formatPctFn(pct)} da receita de BVs` : "sem dados no período",
          status: "neutro" as const,
          omitComparisonSuffix: true,
        };
      }
      // Card de FONTE (ex.: Spot "Principal Fonte de Receita"): a fonte de MAIOR
      // valor realizado entre `fonteSources` + seu % sobre o total das fontes.
      // Cálculo direto das contas (sem drill-down); estado seguro se sem dados.
      if (spec.kind === "fonte") {
        const sources = (spec.fonteSources ?? []).map((s) => ({
          label: s.label,
          val: sumRealized(s.codes) - sumRealized(s.minus ?? []),
        }));
        const total = sources.reduce((a, s) => a + Math.max(0, s.val), 0);
        const top = sources.slice().sort((a, b) => b.val - a.val)[0];
        const pct = top && total > 0 ? (top.val / total) * 100 : null;
        return {
          label: spec.label,
          value: null,
          formattedValue: top && top.val > 0 ? top.label : "—",
          variationValue: pct,
          variationLabel:
            pct !== null ? `${formatPctFn(pct)} da receita` : "sem dados no período",
          status: "neutro" as const,
          omitComparisonSuffix: true,
        };
      }
      // Margem (%): razão soma(numerador) / soma(denominador). É um indicador
      // sem comparação com orçado — verde se positiva, vermelho se negativa.
      if (spec.kind === "margem" && spec.ratio) {
        const num = sumRealized(spec.ratio.numerator);
        const den = sumRealized(spec.ratio.denominator);
        const margem = den !== 0 ? (num / den) * 100 : null;
        // Margem ORÇADA: o MESMO cálculo usando os valores orçados.
        const numB = sumBudgeted(spec.ratio.numerator);
        const denB = sumBudgeted(spec.ratio.denominator);
        const margemPrevista =
          numB !== null && denB !== null && denB !== 0
            ? (numB / denB) * 100
            : null;
        // Variação em pontos percentuais (realizado − orçado), mesmo padrão
        // do card "Margem" da Viva. Farol: acima do orçado = melhor.
        const margemVarPp =
          margem !== null && margemPrevista !== null
            ? margem - margemPrevista
            : null;
        // Farol: por padrão acima do orçado = melhor; com `invertStatus`,
        // acima = pior (ex.: Freelancers / Receita — subir a razão é ruim).
        const statusVarPp =
          spec.invertStatus && margemVarPp !== null ? -margemVarPp : margemVarPp;
        return {
          label: spec.label,
          value: margem,
          formattedValue: margem !== null ? formatPctFn(margem) : null,
          variationValue: margemVarPp,
          variationLabel: margemVarPp !== null ? formatPp(margemVarPp) : null,
          status: statusMargemPp(statusVarPp),
          // Sem orçamento comparável → não exibe " vs orçamento" vazio.
          omitComparisonSuffix: margemVarPp === null,
        };
      }
      // Suporta resultado DERIVADO em card via `minus` (ex.: Gap de Reembolso
      // = Reembolsos − Custos; Resultado Ajustado = Res. Op. + Custos −
      // Reembolsos). Orçado: combina os orçados de plus/minus, null só quando
      // nenhuma das contas tem orçamento.
      const plusCodes = spec.codes ?? (spec.code ? [spec.code] : []);
      const minusCodes = spec.minus ?? [];
      const realized = sumRealized(plusCodes) - sumRealized(minusCodes);
      const prevPlus = sumBudgeted(plusCodes);
      const prevMinus = sumBudgeted(minusCodes);
      const budgeted =
        prevPlus === null && prevMinus === null
          ? null
          : (prevPlus ?? 0) - (prevMinus ?? 0);
      const varp = variacaoPct(realized, budgeted);
      const isDespesa = spec.kind === "despesa";
      const status = isDespesa
        ? statusDespesasFromVariacao(varp)
        : statusFromVariacaoPercent(varp);
      // Subtítulo "% da receita" (ex.: Comissões / Receita Total): troca a
      // variação "vs orçamento" pelo percentual sobre a base. O farol continua
      // refletindo a comparação com o orçado (status acima).
      if (spec.subtitlePctOf) {
        const base = sumRealized(spec.subtitlePctOf);
        const pctReceita = base !== 0 ? (Math.abs(realized) / base) * 100 : null;
        return {
          label: spec.label,
          value: realized,
          formattedValue: formatBRL(isDespesa ? Math.abs(realized) : realized),
          variationValue: pctReceita,
          variationLabel: pctReceita !== null ? `${formatPctFn(pctReceita)} da receita` : null,
          status,
          omitComparisonSuffix: true,
        };
      }
      return {
        label: spec.label,
        value: realized,
        formattedValue: formatBRL(isDespesa ? Math.abs(realized) : realized),
        variationValue: varp,
        variationLabel: formatVarPct(varp),
        status,
      };
    },
  );

  // Blocos de BREAKDOWN (ex.: Spot — Composição da Receita, Frete: Receita ×
  // Custo Logístico). Cada linha = Σ(codes) − Σ(minus) sobre o realizado; % (se
  // showPctOfTotal) sobre o total das linhas SEM `emphasis`. Só roda quando o
  // template define `breakdownBlocks`; ausente p/ os demais (fallback intacto).
  const breakdownBlocks: BreakdownBlockPayload[] | undefined =
    template.report?.breakdownBlocks?.map((blk) => {
      const raw = blk.rows.map((r) => ({
        label: r.label,
        value: sumRealized(r.codes) - sumRealized(r.minus ?? []),
        emphasis: r.emphasis ?? false,
      }));
      const total = raw
        .filter((r) => !r.emphasis)
        .reduce((acc, r) => acc + Math.max(0, r.value), 0);
      return {
        key: blk.key,
        title: blk.title,
        rows: raw.map((r) => ({
          label: r.label,
          value: r.value,
          pct:
            blk.showPctOfTotal && total > 0 && !r.emphasis
              ? (r.value / total) * 100
              : null,
          emphasis: r.emphasis,
        })),
      };
    });

  // Quadro de INDICADORES por conta DRE (ex.: Terrazzo — "Locação de Espaço":
  // 1.1 Formaturas, 1.2 Shows/Palestras). Cada item = Σ(codes) − Σ(minus) sobre
  // o REALIZADO no período de referência (mês selecionado) — o mesmo valor da
  // célula do mês no DRE gerencial. Só roda quando o template o configura.
  const indicadoresDreCfg = template.report?.indicadoresDre;
  const indicadoresDre: DreIndicatorsPayload | undefined = indicadoresDreCfg
    ? {
        key: indicadoresDreCfg.key,
        title: indicadoresDreCfg.title,
        referenciaLabel,
        items: indicadoresDreCfg.items.map((it) => ({
          label: it.label,
          value: sumRealized(it.codes) - sumRealized(it.minus ?? []),
        })),
      }
    : undefined;

  const previstoRealizado: PrevistoRealizadoPayload[] = [
    {
      label: "Receita",
      realizado: getRealized("1"),
      previsto: getBudgeted("1"),
      unidade: "currency",
    },
    {
      label: "Despesas",
      realizado: getRealized("7"),
      previsto: getBudgeted("7"),
      unidade: "currency",
    },
    {
      label: "Resultado",
      realizado: resultadoRealizado,
      previsto: resultadoOrcado,
      unidade: "currency",
    },
    {
      label: "Margem",
      realizado: margemRealizada,
      previsto: margemPrevista,
      unidade: "percent",
    },
    {
      label: "VVR",
      realizado: vvrRealizado,
      previsto: vvrMetaPeriodo,
      unidade: "currency",
    },
  ];

  const composicaoResultado: ComposicaoPayload[] = [
    {
      label: "Receita Bruta",
      value: getRealized("1"),
      type: "entrada",
    },
    {
      label: "Custos",
      value: -Math.abs(getRealized("5")),
      type: "saida",
    },
    {
      label: "Despesas",
      value: -Math.abs(getRealized("7")),
      type: "saida",
    },
    {
      label: "Resultado",
      value: resultadoRealizado,
      type: "resultado",
    },
  ];

  // -------------------------------------------------------------------------
  // 9. Historico de 6 meses do Resultado do Exercicio (code "11")
  // -------------------------------------------------------------------------
  const MONTH_NAMES_SHORT = [
    "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
    "Jul", "Ago", "Set", "Out", "Nov", "Dez",
  ];

  // Histórico: conta única (historicoCode) ou DERIVADO por soma/subtração de
  // contas (historicoCodes − historicoMinus, ex.: Gap de Reembolso da Village
  // = Reembolsos − Custos Reembolsáveis). Por mês, valor = Σ(plus) − Σ(minus).
  // Gate: existe se ALGUMA conta "plus" estiver no plano em escopo.
  const histPlusCodes = template.report?.historicoCodes ?? [historicoCode];
  const histMinusCodes = template.report?.historicoMinus ?? [];
  const histExists = histPlusCodes.some((c) => accounts.some((a) => a.code === c));
  // Templates que ocultam o bloco "historico" (ex.: Village, que usa
  // barsChart/linesChart no lugar) não precisam computá-lo — economiza RPCs.
  const wantHistorico =
    !template.report?.enabledBlocks ||
    template.report.enabledBlocks.includes("historico");
  const histValue = (
    rows: ReturnType<typeof buildDashboardRows>["rows"],
  ): number => {
    const sumCodes = (codes: string[]) =>
      codes.reduce((acc, c) => acc + (rows.find((r) => r.code === c)?.value ?? 0), 0);
    return sumCodes(histPlusCodes) - sumCodes(histMinusCodes);
  };
  let historicoResultado: HistoricoPayload[] = [];

  if (histExists && wantHistorico) {
    const months: Array<{ year: number; month: number }> = [];
    for (let i = 5; i >= 0; i--) {
      let y = toYear;
      let m = toMonth - i;
      while (m <= 0) {
        m += 12;
        y -= 1;
      }
      months.push({ year: y, month: m });
    }

    const monthKey = (y: number, m: number) =>
      `${y}-${String(m).padStart(2, "0")}`;

    const minYear = months[0].year;
    const maxYear = months[months.length - 1].year;
    const { data: historicoBudgetRows } = await supabase
      .from("budget_entries")
      .select("dre_account_id, amount, year, month")
      .eq("company_id", companyId)
      .gte("year", minYear)
      .lte("year", maxYear);

    const validMonths = new Set(months.map((m) => monthKey(m.year, m.month)));
    const budgetMaps = new Map<string, Map<string, number>>();
    ((historicoBudgetRows ?? []) as BudgetRow[]).forEach((b) => {
      const key = monthKey(b.year, b.month);
      if (!validMonths.has(key)) return;
      let mMap = budgetMaps.get(key);
      if (!mMap) {
        mMap = new Map();
        budgetMaps.set(key, mMap);
      }
      const scopedId = translateToScopedId(b.dre_account_id);
      if (!scopedId) return;
      mMap.set(scopedId, (mMap.get(scopedId) ?? 0) + Number(b.amount));
    });

    const realizedPerMonth = await Promise.all(
      months.map(async (m) => {
        const lastDay = new Date(Date.UTC(m.year, m.month, 0)).getUTCDate();
        const mm = String(m.month).padStart(2, "0");
        const monthFrom = `${m.year}-${mm}-01`;
        const monthTo = `${m.year}-${mm}-${String(lastDay).padStart(2, "0")}`;

        const { data, error } = await supabase.rpc("dashboard_dre_aggregate", {
          p_company_ids: [companyId],
          p_date_from: monthFrom,
          p_date_to: monthTo,
        });

        if (error || !data) {
          return {
            year: m.year,
            month: m.month,
            map: null as Map<string, number> | null,
          };
        }

        const rows = data as AggregateRow[];
        if (rows.length === 0) {
          return {
            year: m.year,
            month: m.month,
            map: null as Map<string, number> | null,
          };
        }
        const map = new Map<string, number>();
        rows.forEach((r) => {
          const scopedId = translateToScopedId(r.dre_account_id);
          if (!scopedId) return;
          map.set(scopedId, (map.get(scopedId) ?? 0) + Number(r.amount));
        });
        return { year: m.year, month: m.month, map };
      }),
    );

    historicoResultado = realizedPerMonth.map((entry) => {
      const yearShort = String(entry.year).slice(-2);
      const mes = `${MONTH_NAMES_SHORT[entry.month - 1]}/${yearShort}`;

      const realizado =
        entry.map === null
          ? null
          : histValue(
              buildDashboardRows(accounts, entry.map, {
                negateChildCodesInSummary: custosNegation,
              }).rows,
            );

      const bMap = budgetMaps.get(monthKey(entry.year, entry.month));
      const previsto =
        !bMap || bMap.size === 0
          ? null
          : histValue(
              buildDashboardRows(accounts, bMap, {
                negateChildCodesInSummary: custosNegation,
              }).rows,
            );

      return { mes, previsto, realizado };
    });
  }

  // -------------------------------------------------------------------------
  // 9b. Gráficos extras por template (ex.: Village): COLUNAS do acumulado do
  //     ano (barsChart — só realizado, Jan→mês de análise) + LINHAS dos últimos
  //     6 meses (linesChart — N séries realizado/orçado/derivado). Reaproveita
  //     o padrão do histórico: 1 RPC por mês + buildDashboardRows; calcula o
  //     union dos dois ranges para não buscar o mês duas vezes.
  // -------------------------------------------------------------------------
  const barsCfg = template.report?.barsChart;
  const linesCfg = template.report?.linesChart;
  const prevRealCfg = template.report?.prevRealCharts;
  let barsSerie: BarSeriePayload[] | undefined;
  let barsTitle: string | undefined;
  let barsAcum: number | null | undefined; // gap acumulado do ano (Jan→análise)
  let linesSerie: MultiLineSeriePayload[] | undefined;
  let linesSeriesLabels: string[] | undefined;
  let linesTitle: string | undefined;
  let linesAcum: (number | null)[] | undefined; // acum. do ano por série
  let linesAcumBaseIndex: number | undefined; // índice da série orçada (baseline da variação)
  let prevRealCharts: PrevRealChartPayload[] | undefined; // ex.: SGX Locações/Projetos

  if (barsCfg || linesCfg || prevRealCfg) {
    const analysisIdx = toYear * 12 + (toMonth - 1);
    // Só recua 6 meses (antes de Jan) quando há linesChart; senão começa em Jan
    // (barsChart/prevRealCharts são acumulado do ano — não precisam do recuo).
    const startIdx = linesCfg ? Math.min(toYear * 12, analysisIdx - 5) : toYear * 12;
    const unionMonths: Array<{ year: number; month: number }> = [];
    for (let i = startIdx; i <= analysisIdx; i++) {
      unionMonths.push({ year: Math.floor(i / 12), month: (i % 12) + 1 });
    }
    const mKey = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;
    const mLabel = (y: number, m: number) =>
      `${MONTH_NAMES_SHORT[m - 1]}/${String(y).slice(-2)}`;

    const uMinYear = unionMonths[0].year;
    const uMaxYear = unionMonths[unionMonths.length - 1].year;
    const { data: uBudgetRows } = await supabase
      .from("budget_entries")
      .select("dre_account_id, amount, year, month")
      .eq("company_id", companyId)
      .gte("year", uMinYear)
      .lte("year", uMaxYear);
    const uValid = new Set(unionMonths.map((m) => mKey(m.year, m.month)));
    const uBudgetMaps = new Map<string, Map<string, number>>();
    ((uBudgetRows ?? []) as BudgetRow[]).forEach((b) => {
      const key = mKey(b.year, b.month);
      if (!uValid.has(key)) return;
      let mm = uBudgetMaps.get(key);
      if (!mm) {
        mm = new Map();
        uBudgetMaps.set(key, mm);
      }
      const sid = translateToScopedId(b.dre_account_id);
      if (!sid) return;
      mm.set(sid, (mm.get(sid) ?? 0) + Number(b.amount));
    });

    const uRealized = await Promise.all(
      unionMonths.map(async (m) => {
        const lastDay = new Date(Date.UTC(m.year, m.month, 0)).getUTCDate();
        const mm = String(m.month).padStart(2, "0");
        const { data, error } = await supabase.rpc("dashboard_dre_aggregate", {
          p_company_ids: [companyId],
          p_date_from: `${m.year}-${mm}-01`,
          p_date_to: `${m.year}-${mm}-${String(lastDay).padStart(2, "0")}`,
        });
        const key = mKey(m.year, m.month);
        if (error || !data || (data as AggregateRow[]).length === 0) {
          return { key, map: null as Map<string, number> | null };
        }
        const map = new Map<string, number>();
        (data as AggregateRow[]).forEach((r) => {
          const sid = translateToScopedId(r.dre_account_id);
          if (sid) map.set(sid, (map.get(sid) ?? 0) + Number(r.amount));
        });
        return { key, map };
      }),
    );

    type Rows = ReturnType<typeof buildDashboardRows>["rows"];
    const builtByKey = new Map<string, { realized: Rows | null; budget: Rows | null }>();
    for (const entry of uRealized) {
      const realized =
        entry.map === null
          ? null
          : buildDashboardRows(accounts, entry.map, {
              negateChildCodesInSummary: custosNegation,
            }).rows;
      const bMap = uBudgetMaps.get(entry.key);
      const budget =
        !bMap || bMap.size === 0
          ? null
          : buildDashboardRows(accounts, bMap, {
              negateChildCodesInSummary: custosNegation,
            }).rows;
      builtByKey.set(entry.key, { realized, budget });
    }
    const sumRows = (rows: Rows, codes: string[]) =>
      codes.reduce((a, c) => a + (rows.find((r) => r.code === c)?.value ?? 0), 0);
    const deriveVal = (rows: Rows | null, codes: string[], minus?: string[]): number | null =>
      rows ? sumRows(rows, codes) - sumRows(rows, minus ?? []) : null;

    // Meses do acumulado do ano (Jan do ano de análise → mês de análise).
    const ytdMonths = unionMonths.filter((m) => m.year === toYear);

    if (barsCfg) {
      barsSerie = ytdMonths.map((m) => {
        const { realized } = builtByKey.get(mKey(m.year, m.month)) ?? { realized: null };
        return {
          mes: mLabel(m.year, m.month),
          valor: deriveVal(realized, barsCfg.codes, barsCfg.minus),
        };
      });
      barsTitle = barsCfg.title;
      // Acumulado do ano = soma de todos os gaps mensais (Jan→análise).
      barsAcum = ytdMonths.reduce((acc, m) => {
        const { realized } = builtByKey.get(mKey(m.year, m.month)) ?? { realized: null };
        return acc + (deriveVal(realized, barsCfg.codes, barsCfg.minus) ?? 0);
      }, 0);
    }

    if (linesCfg) {
      const lineMonths = unionMonths.slice(-6);
      linesSerie = lineMonths.map((m) => {
        const built = builtByKey.get(mKey(m.year, m.month)) ?? { realized: null, budget: null };
        const values = linesCfg.series.map((s) =>
          deriveVal(s.source === "budget" ? built.budget : built.realized, s.codes, s.minus),
        );
        return { mes: mLabel(m.year, m.month), values };
      });
      linesSeriesLabels = linesCfg.series.map((s) => s.label);
      linesTitle = linesCfg.title;
      // Acumulado do ano por série (Jan→análise) — alimenta as 3 barras horizontais.
      linesAcum = linesCfg.series.map((s) =>
        ytdMonths.reduce((acc, m) => {
          const built = builtByKey.get(mKey(m.year, m.month)) ?? { realized: null, budget: null };
          return acc + (deriveVal(s.source === "budget" ? built.budget : built.realized, s.codes, s.minus) ?? 0);
        }, 0),
      );
      // Série orçada (source "budget") = baseline da variação das demais.
      const baseIdx = linesCfg.series.findIndex((s) => s.source === "budget");
      linesAcumBaseIndex = baseIdx >= 0 ? baseIdx : undefined;
    }

    if (prevRealCfg) {
      // Cada gráfico: barras mensais Previsto × Realizado (Jan→análise) +
      // previsto/realizado acumulados do ano. previsto = orçado, realizado =
      // realizado; ambos = Σ(codes) − Σ(minus) do mês.
      prevRealCharts = prevRealCfg.map((cfg) => {
        const serie = ytdMonths.map((m) => {
          const built = builtByKey.get(mKey(m.year, m.month)) ?? { realized: null, budget: null };
          return {
            mes: mLabel(m.year, m.month),
            previsto: deriveVal(built.budget, cfg.codes, cfg.minus),
            realizado: deriveVal(built.realized, cfg.codes, cfg.minus),
          };
        });
        const previstoAcum = serie.reduce((acc, p) => acc + (p.previsto ?? 0), 0);
        const realizadoAcum = serie.reduce((acc, p) => acc + (p.realizado ?? 0), 0);
        return { title: cfg.title, serie, previstoAcum, realizadoAcum };
      });
    }
  }

  // -------------------------------------------------------------------------
  // 9c. Bloco CONSOLIDADO do grupo (ex.: Salvaterra). Para CADA empresa cujo
  //     nome casa com matchName (ILIKE), busca o `resultCode` (ex.: "11" =
  //     Resultado do Exercício) realizado (dashboard_dre_aggregate) e orçado
  //     (budget_aggregate) no período, e soma. Bloco COMPLEMENTAR — não mistura
  //     o restante da análise individual (cards/tabela usam só a empresa atual).
  // -------------------------------------------------------------------------
  let consolidated: ConsolidatedPayload | undefined;
  const cg = template.report?.consolidatedGroup;
  if (cg) {
    type AggRow = { dre_account_id: string; amount: number | string | null };
    // Empresas do grupo: por NOMES EXATOS ordenados (matchNames, ex.: Spot+
    // Express) ou por ILIKE de um único nome (matchName, ex.: família Salvaterra).
    let groupList: Array<{ id: string; name: string }>;
    if (cg.matchNames && cg.matchNames.length > 0) {
      const { data } = await supabase
        .from("companies")
        .select("id,name")
        .in("name", cg.matchNames)
        .eq("active", true);
      const byName = new Map(
        ((data ?? []) as Array<{ id: string; name: string }>).map((c) => [c.name, c]),
      );
      groupList = cg.matchNames
        .map((n) => byName.get(n))
        .filter((c): c is { id: string; name: string } => Boolean(c));
    } else {
      const { data } = await supabase
        .from("companies")
        .select("id,name")
        .ilike("name", `%${cg.matchName}%`)
        .eq("active", true)
        .order("name");
      groupList = (data ?? []) as Array<{ id: string; name: string }>;
    }
    const groupIds = groupList.map((c) => c.id);
    // Resultado (resultCode) das empresas `cids` num intervalo [df, dt].
    //  - perCompanyPlan: escopa CADA chamada no plano CUSTOM das próprias `cids`
    //    (ex.: Spot+Express somam o code 15 custom de cada uma).
    //  - default: escopa no GRUPO INTEIRO → plano CONSOLIDADO (global), igual ao
    //    DRE consolidado do sistema multi-empresa (ex.: Salvaterra, code 11 =
    //    8+9−10). NÃO mudar o default — Salvaterra depende dele.
    const resultFor = async (
      cids: string[],
      df: string,
      dt: string,
    ): Promise<{ realizado: number; previsto: number | null }> => {
      const [{ data: realData }, { data: budData }] = await Promise.all([
        supabase.rpc("dashboard_dre_aggregate", { p_company_ids: cids, p_date_from: df, p_date_to: dt }),
        supabase.rpc("budget_aggregate", { p_company_ids: cids, p_date_from: df, p_date_to: dt }),
      ]);
      const { coreAccounts: ga, translateToScopedId: gt } = scopeDreAccounts(
        allAccounts,
        cg.perCompanyPlan ? cids : groupIds,
      );
      const buildMap = (rows: AggRow[] | null) => {
        const m = new Map<string, number>();
        (rows ?? []).forEach((r) => {
          const sid = gt(r.dre_account_id);
          if (sid) m.set(sid, (m.get(sid) ?? 0) + Number(r.amount ?? 0));
        });
        return m;
      };
      const valueOf = (m: Map<string, number>) =>
        buildDashboardRows(ga, m).rows.find((r) => r.code === cg.resultCode)?.value ?? 0;
      const budRows = (budData as AggRow[] | null) ?? [];
      return {
        realizado: valueOf(buildMap(realData as AggRow[] | null)),
        previsto: budRows.length > 0 ? valueOf(buildMap(budRows)) : null,
      };
    };
    const consDateFrom = `${toYear}-01-01`; // acumulado do ano (Jan→análise)
    const rows: ConsolidatedRowPayload[] = [];
    type Res = { realizado: number; previsto: number | null };
    const periodResults: Res[] = [];
    const ytdResults: Res[] = [];
    for (const gc of groupList) {
      const period = await resultFor([gc.id], dateFrom, dateTo);
      rows.push({ label: `Resultado ${gc.name}`, previsto: period.previsto, realizado: period.realizado });
      periodResults.push(period);
      // Só o modo per-company precisa do acumulado por empresa (a soma vira o
      // acumulado consolidado). No default, o total/acumulado vêm do agregado.
      if (cg.perCompanyPlan) ytdResults.push(await resultFor([gc.id], consDateFrom, dateTo));
    }
    if (rows.length > 0) {
      const groupName = cg.matchName.charAt(0).toUpperCase() + cg.matchName.slice(1);
      const label = cg.consolidatedLabel ?? `Resultado Consolidado ${groupName}`;
      let totalPeriod: Res;
      let totalYtd: Res;
      if (cg.perCompanyPlan) {
        // SOMA dos resultados individuais. Previsto = soma dos orçamentos que
        // EXISTEM (empresa sem budget contribui 0; ex.: Express sem orçamento →
        // consolidado mostra só o da Spot). null apenas se NENHUMA tem orçamento.
        const sumR = (xs: Res[]) => xs.reduce((a, x) => a + x.realizado, 0);
        const sumP = (xs: Res[]) =>
          xs.some((x) => x.previsto !== null) ? xs.reduce((a, x) => a + (x.previsto ?? 0), 0) : null;
        totalPeriod = { realizado: sumR(periodResults), previsto: sumP(periodResults) };
        totalYtd = { realizado: sumR(ytdResults), previsto: sumP(ytdResults) };
      } else {
        // AGREGADO das empresas juntas (plano global do grupo) — igual ao DRE.
        [totalPeriod, totalYtd] = await Promise.all([
          resultFor(groupIds, dateFrom, dateTo),
          resultFor(groupIds, consDateFrom, dateTo),
        ]);
      }
      rows.push({
        label,
        previsto: totalPeriod.previsto,
        realizado: totalPeriod.realizado,
        emphasis: true,
      });
      consolidated = {
        title: cg.title,
        rows,
        acum: { previsto: totalYtd.previsto, realizado: totalYtd.realizado },
      };
    }
  }

  // -------------------------------------------------------------------------
  // 10. Acumulado do ano (Jan/ano de dateTo ate dateTo).
  //
  // Faz 1 RPC consolidando o range inteiro (Jan-1 ate dateTo) + 1 query
  // ao budget cobrindo o mesmo range. Em seguida aplica
  // `buildDashboardRows` para extrair Receita/Despesas/Resultado/Margem.
  // -------------------------------------------------------------------------
  const ytdYear = toYear;
  const ytdDateFrom = `${ytdYear}-01-01`;
  const ytdDateTo = dateTo;

  const { data: ytdRealizedAgg } = await supabase.rpc(
    "dashboard_dre_aggregate",
    {
      p_company_ids: [companyId],
      p_date_from: ytdDateFrom,
      p_date_to: ytdDateTo,
    },
  );

  const ytdRealizedMap = new Map<string, number>();
  ((ytdRealizedAgg ?? []) as AggregateRow[]).forEach((r) => {
    const scopedId = translateToScopedId(r.dre_account_id);
    if (!scopedId) return;
    ytdRealizedMap.set(scopedId, (ytdRealizedMap.get(scopedId) ?? 0) + Number(r.amount));
  });

  const { data: ytdBudgetRows } = await supabase
    .from("budget_entries")
    .select("dre_account_id, amount, year, month")
    .eq("company_id", companyId)
    .eq("year", ytdYear)
    .lte("month", toMonth);

  const ytdBudgetMap = new Map<string, number>();
  ((ytdBudgetRows ?? []) as BudgetRow[]).forEach((b) => {
    const scopedId = translateToScopedId(b.dre_account_id);
    if (!scopedId) return;
    ytdBudgetMap.set(scopedId, (ytdBudgetMap.get(scopedId) ?? 0) + Number(b.amount));
  });

  const { rows: ytdRealizedRows } = buildDashboardRows(accounts, ytdRealizedMap, {
    negateChildCodesInSummary: custosNegation,
  });
  const { rows: ytdBudgetedRows } = buildDashboardRows(accounts, ytdBudgetMap, {
    negateChildCodesInSummary: custosNegation,
  });

  const ytdRealizedByCode = new Map<string, number>();
  ytdRealizedRows.forEach((r) => ytdRealizedByCode.set(r.code, r.value));
  const ytdBudgetedByCode = new Map<string, number>();
  ytdBudgetedRows.forEach((r) => ytdBudgetedByCode.set(r.code, r.value));

  const ytdGetR = (code: string): number => ytdRealizedByCode.get(code) ?? 0;
  const ytdGetB = (code: string): number | null => {
    const v = ytdBudgetedByCode.get(code);
    return v === undefined ? null : v;
  };

  const ytdReceitaLiqR = ytdGetR("4");
  const ytdResultadoR = ytdGetR("11");
  const ytdReceitaLiqB = ytdGetB("4");
  const ytdResultadoB = ytdGetB("11");

  // -------------------------------------------------------------------------
  // Quadro de eventos da FEAT PRODUÇÕES (exclusivo). Montado AQUI porque a
  // projeção de "Fechamentos em aberto" usa o Resultado do Exercício acumulado
  // do DRE (`ytdResultadoR`, code "11", Jan→dateTo) como base — o MESMO número
  // do bloco "Acumulado do Ano > Resultado" e do Resultado acumulado do
  // Dashboard DRE. Gate por template (`feat-producoes`): nenhuma outra empresa
  // carrega ou exibe este bloco. Complemento gerencial: não altera DRE, Fluxo,
  // KPIs nem demais blocos.
  // -------------------------------------------------------------------------
  const featEventosResult =
    template.id === "feat-producoes"
      ? await buildFeatEventos(
          supabase,
          companyId,
          toYear,
          toMonth,
          referenciaLabel,
          ytdResultadoR,
          ytdResultadoB,
        )
      : null;

  // Saldo final da Custódia de Artistas (regime de caixa + competência) —
  // EXCLUSIVO da Case Shows. Reproduz, no mês de referência (dateTo), os dois
  // saldos de fechamento já calculados na tela de Fluxo de Caixa. Gate por NOME
  // dentro do helper: qualquer outra empresa devolve null (quadro não aparece).
  const custodyClosing = await buildCaseShowsCustodyClosing(supabase, {
    companyId,
    companyName: company.name,
    dateTo,
    referenciaLabel,
  });

  const ytdMargemR =
    ytdReceitaLiqR > 0 ? (ytdResultadoR / ytdReceitaLiqR) * 100 : null;
  const ytdMargemB =
    ytdReceitaLiqB !== null && ytdReceitaLiqB > 0 && ytdResultadoB !== null
      ? (ytdResultadoB / ytdReceitaLiqB) * 100
      : null;

  const acumuladoAno: PrevistoRealizadoPayload[] = [
    {
      label: "Receita",
      realizado: ytdGetR("1"),
      previsto: ytdGetB("1"),
      unidade: "currency",
    },
    {
      label: "Despesas",
      realizado: ytdGetR("7"),
      previsto: ytdGetB("7"),
      unidade: "currency",
    },
    {
      label: "Resultado",
      realizado: ytdResultadoR,
      previsto: ytdResultadoB,
      unidade: "currency",
    },
    {
      label: "Margem",
      realizado: ytdMargemR,
      previsto: ytdMargemB,
      unidade: "percent",
    },
  ];

  // Acumulado do ano (Jan→análise) do MÉTRICO do gráfico de histórico (mesmo
  // code/derivação do gráfico) — alimenta o rodapé "Acumulado no ano".
  let historicoAcum:
    | { previsto: number | null; realizado: number | null }
    | undefined;
  if (histExists && wantHistorico && template.report?.historicoShowAcum) {
    const sumYtdR = (codes: string[]) => codes.reduce((s, c) => s + ytdGetR(c), 0);
    const sumYtdB = (codes: string[]) => {
      let any = false;
      let total = 0;
      codes.forEach((c) => {
        const b = ytdGetB(c);
        if (b !== null) {
          any = true;
          total += b;
        }
      });
      return any ? total : null;
    };
    const realizado = sumYtdR(histPlusCodes) - sumYtdR(histMinusCodes);
    const pP = sumYtdB(histPlusCodes);
    const pM = sumYtdB(histMinusCodes);
    const previsto = pP === null && pM === null ? null : (pP ?? 0) - (pM ?? 0);
    historicoAcum = { previsto, realizado };
  }

  // -------------------------------------------------------------------------
  // 11. VVR serie anual: Jan/ano(dateTo) ate mes(dateTo). Realizado e meta
  //     mensais — para grafico com barras (realizado) + linha (meta).
  // -------------------------------------------------------------------------
  const { data: vvrYtdRows } = await supabase
    .from("company_fee_vvr")
    .select("vvr_meta, vvr, year, month")
    .eq("company_id", companyId)
    .eq("year", ytdYear)
    .lte("month", toMonth);

  const vvrByMonth = new Map<
    number,
    { meta: number | null; realizado: number | null }
  >();
  (
    (vvrYtdRows ?? []) as Array<FeeVvrRow & { year: number; month: number }>
  ).forEach((row) => {
    vvrByMonth.set(row.month, {
      meta: row.vvr_meta !== null ? Number(row.vvr_meta) : null,
      realizado: row.vvr !== null ? Number(row.vvr) : null,
    });
  });

  const vvrSerieAnual: VvrSerieAnualPayload[] = [];
  for (let m = 1; m <= toMonth; m++) {
    const yShort = String(ytdYear).slice(-2);
    const mes = `${MONTH_NAMES_SHORT[m - 1]}/${yShort}`;
    const entry = vvrByMonth.get(m);
    vvrSerieAnual.push({
      mes,
      realizado: entry?.realizado ?? null,
      meta: entry?.meta ?? null,
    });
  }

  // -------------------------------------------------------------------------
  // 11b. Resumo YTD do VVR para a IA (acumulado realizado vs meta +
  //      flag de "ficou abaixo nos 2 ultimos meses"). Calculado a partir
  //      do `vvrSerieAnual` ja montado acima — mesma fonte de dados.
  //
  //      "Ultimos 2 meses" = os 2 ultimos pontos da serie YTD, ou seja,
  //      o mes do periodo + o mes imediatamente anterior. Quando ha
  //      menos de 2 pontos com dados completos (meta e realizado), o
  //      flag fica false.
  // -------------------------------------------------------------------------
  const vvrRealizadoAcumulado = vvrSerieAnual.reduce(
    (sum, p) => sum + (p.realizado ?? 0),
    0,
  );
  const vvrMetaAcumulada = vvrSerieAnual.reduce(
    (sum, p) => sum + (p.meta ?? 0),
    0,
  );
  const acimaDaMeta = vvrRealizadoAcumulado >= vvrMetaAcumulada;
  const last2 = vvrSerieAnual.slice(-2);
  const abaixoMetaUltimos2 =
    last2.length === 2 &&
    last2.every(
      (p) =>
        p.realizado !== null &&
        p.meta !== null &&
        p.realizado < p.meta,
    );

  const vvrYtdResumo = {
    realizado_acumulado: Number(vvrRealizadoAcumulado.toFixed(2)),
    meta_acumulada: Number(vvrMetaAcumulada.toFixed(2)),
    acima_da_meta: acimaDaMeta,
    abaixo_meta_ultimos_2_meses: abaixoMetaUltimos2,
  };

  // -------------------------------------------------------------------------
  // 12. Retorno consolidado
  //
  // `vvr_ytd_resumo` e injetado aqui (e nao na construcao inicial de
  // `input`) porque depende de `vvrSerieAnual`, que e computado mais
  // abaixo no fluxo. O input final que vai pra IA fica enriquecido.
  // -------------------------------------------------------------------------
  // Blocos REAIS por conta DRE quando o template define (ex.: SGX). Ausência
  // => mantém os blocos genéricos (Franquias Viva e demais ficam idênticos).
  // Sinal: entrada = +valor; saida (despesa) = -|valor|; resultado = como está.
  const previstoRealizadoFinal: PrevistoRealizadoPayload[] =
    template.report?.previstoRealizado
      ? template.report.previstoRealizado.map((s) => {
          // Margem (%) como linha da tabela: razão Σnum / Σden — realizado e
          // orçado pelo MESMO cálculo (ex.: Margem Líquida = Resultado Final ÷
          // Receita Líquida). Orçado null quando faltam dados orçados.
          if (s.ratio) {
            const num = sumRealized(s.ratio.numerator);
            const den = sumRealized(s.ratio.denominator);
            const realizado = den !== 0 ? (num / den) * 100 : 0;
            const numB = sumBudgeted(s.ratio.numerator);
            const denB = sumBudgeted(s.ratio.denominator);
            const previsto =
              numB !== null && denB !== null && denB !== 0
                ? (numB / denB) * 100
                : null;
            return {
              label: s.label,
              realizado,
              previsto,
              unidade: s.unidade,
              group: s.group,
              footnote: s.footnote,
            };
          }
          // Valor = soma(plus) − soma(minus). `minus` permite resultados
          // derivados (ex.: Resultado Operacional = Receitas Op − Despesas Op).
          const plusCodes = s.codes ?? (s.code ? [s.code] : []);
          const minusCodes = s.minus ?? [];
          const realizado = sumRealized(plusCodes) - sumRealized(minusCodes);
          const prevPlus = sumBudgeted(plusCodes);
          const prevMinus = sumBudgeted(minusCodes);
          const previsto =
            prevPlus === null && prevMinus === null
              ? null
              : (prevPlus ?? 0) - (prevMinus ?? 0);
          return {
            label: s.label,
            realizado,
            previsto,
            unidade: s.unidade,
            group: s.group,
            footnote: s.footnote,
          };
        })
      : previstoRealizado;

  const composicaoResultadoFinal: ComposicaoPayload[] = template.report?.composicao
    ? template.report.composicao.map((s) => ({
        label: s.label,
        value:
          s.type === "saida"
            ? -Math.abs(getRealized(s.code))
            : getRealized(s.code),
        type: s.type,
      }))
    : composicaoResultado;

  return {
    ok: true,
    payload: {
      // Gating dos campos enviados à IA: templates sem capacidade de VVR/FEE
      // NÃO recebem esses indicadores (e o prompt do template não fala deles).
      // Franquias Viva mantém todos (capacidades true) → input idêntico.
      input: {
        ...input,
        fee_vvr: template.capabilities.vvrFee ? input.fee_vvr : null,
        fee_disponivel: template.capabilities.vvrFee ? input.fee_disponivel : null,
        vvr_ytd_resumo: template.capabilities.vvrFee ? vvrYtdResumo : null,
        sobrevivencia_caixa_meses: template.capabilities.sobrevivenciaCaixa
          ? sobrevivenciaCaixaMeses
          : null,
        // Resumo gerencial de eventos — só presente para a Feat Produções.
        feat_eventos: featEventosResult?.resumoIA ?? null,
      },
      generatedAt: new Date().toISOString(),
      template: { id: template.id, name: template.name },
      kpis,
      // KPIs custom (SGX etc.) — quando presentes, a UI os usa no lugar do fixo.
      kpisList,
      // Allowlist de blocos visíveis (undefined = todos, comportamento Viva).
      enabledBlocks: template.report?.enabledBlocks,
      // Título do histórico (undefined = título atual no componente).
      historicoTitle: template.report?.historicoTitle,
      historicoKLabels: template.report?.historicoKLabels,
      // Colunas da grade de KPIs (undefined = 4).
      kpiColumns: template.report?.kpiColumns,
      previstoRealizado: previstoRealizadoFinal,
      composicaoResultado: composicaoResultadoFinal,
      historicoResultado,
      acumuladoAno,
      // Série anual de VVR só faz sentido para quem tem VVR (Franquias Viva).
      vvrSerieAnual: template.capabilities.vvrFee ? vvrSerieAnual : [],
      // Quadro de eventos — só presente para a Feat Produções (undefined nos demais).
      featEventos: featEventosResult?.payload,
      // Saldo final da Custódia de Artistas — só presente para a Case Shows.
      custodyClosing: custodyClosing ?? undefined,
      // Quadro de indicadores por conta DRE — só presente p/ templates que o
      // configuram (ex.: Terrazzo — "Locação de Espaço").
      indicadoresDre,
      // Gráficos extras por template (ex.: Village). undefined p/ os demais.
      barsSerie,
      barsTitle,
      barsAcum,
      linesSerie,
      linesSeriesLabels,
      linesTitle,
      linesAcum,
      linesAcumBaseIndex,
      prevRealCharts,
      consolidated,
      historicoAcum,
      // Bloco Performance por Parceiro (ex.: Young Med). undefined nos demais.
      partnerPerformance,
      // Blocos de breakdown (ex.: Spot — composição/frete). undefined nos demais.
      breakdownBlocks,
    },
  };
}
