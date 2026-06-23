import type { SupabaseClient } from "@supabase/supabase-js";

import {
  buildDashboardRows,
  fetchAllDreAccountRows,
  scopeDreAccounts,
  type RawDreAccount,
} from "@/lib/dashboard/dre";
import type { OnePageInput } from "@/lib/intelligence/one-page-schema";

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

// ─── Tipos da resposta (espelho do que sai do helper) ─────────────────────

type KpiStatus = "positivo" | "neutro" | "atencao" | "critico";

export interface KpiCardPayload {
  label: string;
  value: number | null;
  formattedValue: string | null;
  variationValue: number | null;
  variationLabel: string | null;
  status: KpiStatus;
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
  previstoRealizado: PrevistoRealizadoPayload[];
  composicaoResultado: ComposicaoPayload[];
  historicoResultado: HistoricoPayload[];
  // Acumulado do ano: mesma forma do `previstoRealizado` mas com os valores
  // somados de Jan/ano(dateTo) ate o mes(dateTo).
  acumuladoAno: PrevistoRealizadoPayload[];
  vvrSerieAnual: VvrSerieAnualPayload[];
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
  const { rows: realizedRows } = buildDashboardRows(accounts, realizedMap);
  const { rows: budgetedRows } = buildDashboardRows(accounts, budgetMap);
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
      const { rows: closedRows } = buildDashboardRows(accounts, closedMap);
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

  const account11 = accounts.find((a) => a.code === "11");
  let historicoResultado: HistoricoPayload[] = [];

  if (account11) {
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
          : (buildDashboardRows(accounts, entry.map).rows.find(
              (r) => r.code === "11",
            )?.value ?? null);

      const bMap = budgetMaps.get(monthKey(entry.year, entry.month));
      const previsto =
        !bMap || bMap.size === 0
          ? null
          : (buildDashboardRows(accounts, bMap).rows.find(
              (r) => r.code === "11",
            )?.value ?? null);

      return { mes, previsto, realizado };
    });
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

  const { rows: ytdRealizedRows } = buildDashboardRows(accounts, ytdRealizedMap);
  const { rows: ytdBudgetedRows } = buildDashboardRows(accounts, ytdBudgetMap);

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
      },
      generatedAt: new Date().toISOString(),
      template: { id: template.id, name: template.name },
      kpis,
      previstoRealizado,
      composicaoResultado,
      historicoResultado,
      acumuladoAno,
      // Série anual de VVR só faz sentido para quem tem VVR (Franquias Viva).
      vvrSerieAnual: template.capabilities.vvrFee ? vvrSerieAnual : [],
    },
  };
}
