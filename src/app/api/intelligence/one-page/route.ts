import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";
import {
  buildDashboardRows,
  filterCoreDreAccounts,
  type DreAccountBase,
} from "@/lib/dashboard/dre";
import {
  analyzeOnePageReport,
  OnePageReportError,
} from "@/lib/financeiro/relatorios/one-page-analyzer";
import type { OnePageInput } from "@/lib/intelligence/one-page-schema";

// ============================================================================
// POST /api/intelligence/one-page
//
// Endpoint que monta o input com TODOS os calculos ja resolvidos (DRE, vs.
// orcamento, variacoes, FEE/VVR) e envia ao motor `analyzeOnePageReport`.
// A IA recebe apenas o JSON pronto — nao tem acesso ao banco e nao calcula
// nada. Numeros sao derivados aqui (regra: a IA nao calcula nem reformata).
//
// Body: { companyId, dateFrom, dateTo, periodLabel? }
//
// Resposta (campos aditivos — callers antigos continuam funcionando):
//   {
//     analysis,            // OnePageReport (saida da IA, novo schema)
//     input,               // OnePageInput (enviado a IA, para alinhar com a UI)
//     generatedAt,         // ISO timestamp da geracao
//     kpis,                // 5 cards prontos (Receita, Resultado, Margem,
//                          //                  FEE Disponivel, VVR)
//     previstoRealizado,   // 5 indicadores (sem FEE)
//     composicaoResultado, // waterfall: Receita -> Custos -> Despesas -> Resultado
//     historicoResultado,  // [] por enquanto; sera implementado na proxima etapa
//   }
// ============================================================================

interface RequestBody {
  companyId?: string;
  dateFrom?: string;
  dateTo?: string;
  periodLabel?: string;
}

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

// O campo `vvr_meta` substitui o antigo `fee` na tabela company_fee_vvr —
// rename feito na migration 20260521150000. Mantemos o nome externo
// `fee_mes` no OnePageInput por estabilidade do contrato com o motor; aqui
// somamos o valor da coluna `vvr_meta` e expomos como `fee_mes`. Caso o
// motor/schema seja reescrito para `vvr_meta_mes`, troque os dois pontos
// abaixo (interface + nome do campo no input final).
interface FeeVvrRow {
  vvr_meta: number | string | null;
  vvr: number | string | null;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(request: Request) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user || !profile) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (profile.role !== "admin") {
    return NextResponse.json({ error: "Acesso restrito." }, { status: 403 });
  }

  // -------------------------------------------------------------------------
  // 1. Validacao basica do body
  // -------------------------------------------------------------------------
  const body = (await request.json().catch(() => ({}))) as RequestBody;
  const { companyId, dateFrom, dateTo, periodLabel } = body;

  if (!companyId || !dateFrom || !dateTo) {
    return NextResponse.json(
      { error: "Campos obrigatorios: companyId, dateFrom, dateTo." },
      { status: 400 },
    );
  }
  if (!ISO_DATE_RE.test(dateFrom) || !ISO_DATE_RE.test(dateTo)) {
    return NextResponse.json(
      { error: "Datas devem estar no formato YYYY-MM-DD." },
      { status: 400 },
    );
  }

  // -------------------------------------------------------------------------
  // 2. Empresa + plano de contas DRE (mesma logica de scope do dashboard:
  //    se a empresa tem plano custom, usa o dela; senao usa o global).
  // -------------------------------------------------------------------------
  const { data: company } = await supabase
    .from("companies")
    .select("id,name,fee_disponivel,fee_a_receber")
    .eq("id", companyId)
    .maybeSingle<{
      id: string;
      name: string;
      fee_disponivel: number | string | null;
      fee_a_receber: number | string | null;
    }>();
  if (!company) {
    return NextResponse.json({ error: "Empresa nao encontrada." }, { status: 404 });
  }

  const { data: rawAccounts } = await supabase
    .from("dre_accounts")
    .select("id,code,name,parent_id,level,type,is_summary,formula,sort_order,active,company_id")
    .eq("active", true)
    .order("code");

  const allAccounts = (rawAccounts ?? []) as Array<
    DreAccountBase & { company_id: string | null }
  >;
  const hasCustomPlan = allAccounts.some((a) => a.company_id === companyId);
  const scopedAccounts: DreAccountBase[] = allAccounts
    .filter((a) =>
      hasCustomPlan ? a.company_id === companyId : a.company_id === null,
    )
    .map((a) => ({
      id: a.id,
      code: a.code,
      name: a.name,
      parent_id: a.parent_id,
      level: a.level,
      type: a.type,
      is_summary: a.is_summary,
      formula: a.formula,
      sort_order: a.sort_order,
      active: a.active,
    }));
  const accounts = filterCoreDreAccounts(scopedAccounts);

  // -------------------------------------------------------------------------
  // 3. Agregar DRE realizado no periodo
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
    return NextResponse.json(
      { error: `Falha ao agregar DRE: ${realizedErr.message}` },
      { status: 500 },
    );
  }
  const realizedMap = new Map<string, number>();
  ((realizedAgg ?? []) as AggregateRow[]).forEach((r) => {
    realizedMap.set(
      r.dre_account_id,
      (realizedMap.get(r.dre_account_id) ?? 0) + Number(r.amount),
    );
  });

  // -------------------------------------------------------------------------
  // 4. Agregar orcamento no periodo (somando meses fechados dentro de
  //    [dateFrom, dateTo]). Faz isso em JS para evitar dependencia da RPC
  //    `budget_aggregate` — leitura direta de budget_entries.
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
      budgetMap.set(
        b.dre_account_id,
        (budgetMap.get(b.dre_account_id) ?? 0) + Number(b.amount),
      );
    }
  });

  // -------------------------------------------------------------------------
  // 5. Build de linhas com fórmulas aplicadas (mesmo motor do dashboard).
  //    Faz para realizado e para orcamento separadamente — `buildDashboardRows`
  //    aplica as fórmulas de contas calculadas (Receita Liquida, Lucro Op.,
  //    Resultado do Exercicio, etc.).
  // -------------------------------------------------------------------------
  const { rows: realizedRows } = buildDashboardRows(accounts, realizedMap);
  const { rows: budgetedRows } = buildDashboardRows(accounts, budgetMap);
  const budgetedById = new Map(budgetedRows.map((r) => [r.id, r]));

  // -------------------------------------------------------------------------
  // 6. Selecao dos indicadores que vao para a IA: nivel <= 2 (Pais e filhos
  //    diretos) — evita carregar 60+ contas-folha que a IA nao precisa
  //    comentar. Cap em 30 (limite do schema).
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
      const variacaoPct =
        orcado !== null && orcado !== 0
          ? Number((((realizado - orcado) / Math.abs(orcado)) * 100).toFixed(2))
          : null;
      return {
        code: r.code,
        name: r.name,
        realizado: Number(realizado.toFixed(2)),
        orcado: orcado !== null ? Number(orcado.toFixed(2)) : null,
        variacao_absoluta: variacaoAbs,
        variacao_percentual: variacaoPct,
        pct_receita_liquida:
          r.percentageOverNetRevenue !== null &&
          r.percentageOverNetRevenue !== undefined
            ? Number(r.percentageOverNetRevenue.toFixed(2))
            : null,
      };
    });

  if (dreInput.length === 0) {
    return NextResponse.json(
      { error: "Nenhum indicador DRE disponivel para o periodo selecionado." },
      { status: 400 },
    );
  }

  // -------------------------------------------------------------------------
  // 7. FEE/VVR do periodo (somando os meses contidos em [dateFrom, dateTo]).
  //    A tabela e por (year, month) — fazemos a varredura em JS.
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

  // `fee_mes` mantido por compatibilidade com o schema antigo (guardava a
  // soma de VVR META). `vvr_meta_mes` e o nome semanticamente correto e
  // deve ser usado pelos novos callers.
  const feeVvrInput = hasAny
    ? {
        fee_mes: Number(feeSum.toFixed(2)),
        vvr_mes: Number(vvrSum.toFixed(2)),
        vvr_meta_mes: Number(feeSum.toFixed(2)),
      }
    : null;

  // -------------------------------------------------------------------------
  // 8. Monta input final
  // -------------------------------------------------------------------------
  const input: OnePageInput = {
    empresa: { id: company.id, nome: company.name },
    periodo: {
      date_from: dateFrom,
      date_to: dateTo,
      label: periodLabel ?? `${dateFrom} a ${dateTo}`,
    },
    dre: dreInput,
    fee_vvr: feeVvrInput,
  };

  // -------------------------------------------------------------------------
  // 9. Derivacoes numericas (sem IA). Estes blocos sao puramente derivados
  //    do `realizedRows`, `budgetedRows`, `feeVvrInput` e
  //    `companies.fee_disponivel`. A IA NAO calcula nada disso — esses
  //    valores sao prontos e podem ser consumidos diretamente pela UI.
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

  // ── Margem operacional (Resultado / Receita Liquida * 100) ──────────────
  // Divisao por zero -> null (fallback seguro; o caller deve omitir a
  // variacao quando a base for zero ou ausente).
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

  // Variacao percentual auxiliar — null quando orcamento ausente ou zero.
  const variacaoPct = (real: number, orc: number | null): number | null => {
    if (orc === null || orc === 0) return null;
    return ((real - orc) / Math.abs(orc)) * 100;
  };

  // ── Regras de status por indicador ─────────────────────────────────────
  type KpiStatus = "positivo" | "neutro" | "atencao" | "critico";

  const statusFromVariacaoPercent = (varPct: number | null): KpiStatus => {
    if (varPct === null) return "neutro";
    if (varPct >= 0) return "positivo";
    if (varPct >= -5) return "atencao";
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

  // ── Helpers de formatacao ──────────────────────────────────────────────
  const formatBRL = (v: number) =>
    v.toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
      maximumFractionDigits: 0,
    });
  const formatPct = (v: number) => `${v.toFixed(1)}%`;
  const formatPp = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)} p.p.`;
  const formatVarPct = (v: number | null) =>
    v === null ? null : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

  // ── KPIs ──────────────────────────────────────────────────────────────
  const feeDisponivel =
    company.fee_disponivel === null || company.fee_disponivel === undefined
      ? null
      : Number(company.fee_disponivel);

  const vvrRealizado = feeVvrInput?.vvr_mes ?? null;
  const vvrMetaPeriodo = feeVvrInput?.vvr_meta_mes ?? null;
  const varReceita = variacaoPct(getRealized("1"), getBudgeted("1"));
  const varResultado = variacaoPct(resultadoRealizado, resultadoOrcado);
  const varVvr =
    vvrRealizado !== null && vvrMetaPeriodo !== null
      ? variacaoPct(vvrRealizado, vvrMetaPeriodo)
      : null;

  const kpis = {
    receita: {
      label: "Receita",
      value: getRealized("1"),
      formattedValue: formatBRL(getRealized("1")),
      variationValue: varReceita,
      variationLabel: formatVarPct(varReceita),
      status: statusFromVariacaoPercent(varReceita),
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
        margemRealizada !== null ? formatPct(margemRealizada) : null,
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
  };

  // ── Previsto x Realizado (sem FEE) ────────────────────────────────────
  const previstoRealizado = [
    {
      label: "Receita",
      realizado: getRealized("1"),
      previsto: getBudgeted("1"),
      unidade: "currency" as const,
    },
    {
      label: "Despesas",
      realizado: getRealized("7"),
      previsto: getBudgeted("7"),
      unidade: "currency" as const,
    },
    {
      label: "Resultado",
      realizado: resultadoRealizado,
      previsto: resultadoOrcado,
      unidade: "currency" as const,
    },
    {
      label: "Margem",
      realizado: margemRealizada,
      previsto: margemPrevista,
      unidade: "percent" as const,
    },
    {
      label: "VVR",
      realizado: vvrRealizado,
      previsto: vvrMetaPeriodo,
      unidade: "currency" as const,
    },
  ];

  // ── Composicao do resultado (waterfall) ────────────────────────────────
  // Sinal explicito: custos e despesas saem como negativos para a UI nao
  // ter que inferir. Resultado mantem o sinal original.
  const composicaoResultado = [
    {
      label: "Receita Bruta",
      value: getRealized("1"),
      type: "entrada" as const,
    },
    {
      label: "Custos",
      value: -Math.abs(getRealized("5")),
      type: "saida" as const,
    },
    {
      label: "Despesas",
      value: -Math.abs(getRealized("7")),
      type: "saida" as const,
    },
    {
      label: "Resultado",
      value: resultadoRealizado,
      type: "resultado" as const,
    },
  ];

  // ── historicoResultado: TODO proxima etapa ─────────────────────────────
  // Precisa rodar `dashboard_dre_aggregate` para os 6 meses anteriores
  // e ler `budget_entries` no mesmo range, filtrando dre code "11".
  // Sera implementado na proxima iteracao para evitar inflar este PR.
  const historicoResultado: Array<{
    mes: string;
    previsto: number | null;
    realizado: number;
  }> = [];

  // -------------------------------------------------------------------------
  // 10. Chamada do motor + resposta unica (aditiva)
  // -------------------------------------------------------------------------
  const generatedAt = new Date().toISOString();

  try {
    const analysis = await analyzeOnePageReport(input);
    return NextResponse.json({
      analysis,
      input,
      generatedAt,
      kpis,
      previstoRealizado,
      composicaoResultado,
      historicoResultado,
    });
  } catch (err) {
    // Mesmo em falha do motor, devolvemos os blocos numericos — a UI pode
    // exibir os KPIs e graficos enquanto re-tenta a analise.
    const numericPayload = {
      input,
      generatedAt,
      kpis,
      previstoRealizado,
      composicaoResultado,
      historicoResultado,
    };
    if (err instanceof OnePageReportError) {
      return NextResponse.json(
        { error: err.message, ...numericPayload },
        { status: 502 },
      );
    }
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Erro inesperado no motor.",
        ...numericPayload,
      },
      { status: 500 },
    );
  }
}
