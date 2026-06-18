import type { SupabaseClient } from "@supabase/supabase-js";

import {
  aggregateDreRows,
  findResultadoExercicio,
  loadScopedDreAccounts,
} from "@/lib/dashboard/dre";
import { buildCashFlowRows, previousMonth } from "@/lib/dashboard/cash-flow";
import type { CashFlowAccountBase } from "@/lib/dashboard/cash-flow";

export const fmtFin = new Intl.NumberFormat("pt-BR", {
  style: "decimal",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// Perfil mínimo que os loaders precisam (subset de UnifiedProfile).
export interface FinProfile {
  id: string;
  role: string;
  profile: string;
  company_ids: string[];
}

export interface HomeFinanceiroCaps {
  showGrupo: boolean; // KPIs do grupo + Caixa (gestão/admin com financeiro)
  showMiniDre: boolean; // Mini-DRE da unidade (franqueado com financeiro)
}

export function deriveFinanceiroCaps(
  profile: FinProfile | null,
  canFinanceiro: boolean,
): HomeFinanceiroCaps {
  if (!profile || !canFinanceiro) return { showGrupo: false, showMiniDre: false };
  const isFranqueado = profile.profile === "franqueado";
  return {
    showGrupo: !isFranqueado,
    showMiniDre: isFranqueado && profile.company_ids.length > 0,
  };
}

export interface HomeKpiPoint {
  label: string; // mês curto (ex.: "jun")
  receita: number;
  despesa: number;
  resultado: number;
}
export interface HomeKpis {
  receita: number;
  despesa: number;
  resultado: number;
  resultadoVariacaoPct: number | null; // vs mês anterior; null se mês anterior = 0
  mesLabel: string;
  series: HomeKpiPoint[]; // últimos 6 meses (asc), p/ sparkline e Receita×Despesa
}
export interface HomeCaixa {
  caixaGeradoMes: number;
  mesLabel: string;
}
export interface HomeMiniDre {
  resultado: number;
  receita: number;
  mesLabel: string;
}

const MES_LABELS = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

const MES_SHORT = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

function monthBounds(year: number, month: number): { from: string; to: string } {
  return {
    from: new Date(Date.UTC(year, month - 1, 1)).toISOString().slice(0, 10),
    to: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10),
  };
}

// Últimos N meses (incluindo o atual), em ordem ascendente.
function lastNMonths(n: number): { year: number; month: number }[] {
  const now = new Date();
  let y = now.getUTCFullYear();
  let m = now.getUTCMonth() + 1;
  const out: { year: number; month: number }[] = [];
  for (let i = 0; i < n; i++) {
    out.unshift({ year: y, month: m });
    const p = previousMonth(y, m);
    y = p.year;
    m = p.month;
  }
  return out;
}

function receitaLiquida(rows: { code: string; value: number }[]): number {
  return rows.find((r) => r.code === "4")?.value ?? 0;
}

async function allowedCompanies(
  supabase: SupabaseClient,
  profile: FinProfile,
): Promise<string[]> {
  const { data: allData } = await supabase.from("companies").select("id").eq("active", true);
  const allIds = (allData ?? []).map((c) => c.id as string);

  // admin enxerga todas; demais consultam user_company_access.
  if (profile.role === "admin") return allIds;

  const { data: accessData } = await supabase
    .from("user_company_access")
    .select("company_id")
    .eq("user_id", profile.id);
  const accessIds = (accessData ?? []).map((r) => r.company_id as string);

  if (accessIds.length > 0) return allIds.filter((id) => accessIds.includes(id));

  // franqueado usa company_ids do perfil como fallback
  if (profile.company_ids.length > 0)
    return allIds.filter((id) => profile.company_ids.includes(id));

  return [];
}

// KPIs do grupo (ou das empresas que o usuário enxerga): receita líquida,
// despesas (= receita − resultado), resultado do exercício, do mês corrente,
// com variação do resultado vs mês anterior.
export async function loadKpisGrupo(
  supabase: SupabaseClient,
  profile: FinProfile,
): Promise<HomeKpis | null> {
  try {
    const companyIds = await allowedCompanies(supabase, profile);
    if (companyIds.length === 0) return null;

    const months = lastNMonths(6);
    const scope = await loadScopedDreAccounts(supabase, companyIds);

    // Um único lote de 6 agregações DRE (paralelas) alimenta a série inteira:
    // sparkline de resultado, mini-gráfico Receita×Despesa, mês atual e variação.
    const rowsByMonth = await Promise.all(
      months.map(({ year, month }) => {
        const { from, to } = monthBounds(year, month);
        return aggregateDreRows({ supabase, scope, companyIds, dateFrom: from, dateTo: to });
      }),
    );

    const series: HomeKpiPoint[] = months.map((mo, i) => {
      const rows = rowsByMonth[i];
      const receita = receitaLiquida(rows);
      const resultado = findResultadoExercicio(rows);
      return { label: MES_SHORT[mo.month - 1], receita, despesa: receita - resultado, resultado };
    });

    const cur = series[series.length - 1];
    const prev = series.length > 1 ? series[series.length - 2] : null;
    const resultadoVariacaoPct =
      prev && prev.resultado !== 0
        ? ((cur.resultado - prev.resultado) / Math.abs(prev.resultado)) * 100
        : null;

    const last = months[months.length - 1];
    return {
      receita: cur.receita,
      despesa: cur.despesa,
      resultado: cur.resultado,
      resultadoVariacaoPct,
      mesLabel: `${MES_LABELS[last.month - 1]}/${last.year}`,
      series,
    };
  } catch {
    return null;
  }
}

// Caixa gerado no mês (entradas − saídas) = "Caixa Final" (code 90.3) calculado
// com saldo inicial 0. Reusa o motor de Fluxo de Caixa para respeitar os sinais
// por tipo de conta e o Resultado do Exercício do mês.
export async function loadCaixaMes(
  supabase: SupabaseClient,
  profile: FinProfile,
): Promise<HomeCaixa | null> {
  try {
    const companyIds = await allowedCompanies(supabase, profile);
    if (companyIds.length === 0) return null;

    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;
    const { from, to } = monthBounds(year, month);

    const { data: cfData } = await supabase
      .from("cash_flow_accounts")
      .select(
        "id,code,name,parent_id,level,type,is_summary,formula,source,is_highlight_block,sort_order,active",
      )
      .eq("active", true)
      .is("company_id", null)
      .order("sort_order");

    const accounts: CashFlowAccountBase[] = (cfData ?? []).map((a) => ({
      id: a.id as string,
      code: a.code as string,
      name: a.name as string,
      parent_id: (a.parent_id as string | null) ?? null,
      level: a.level as number,
      type: a.type as CashFlowAccountBase["type"],
      is_summary: Boolean(a.is_summary),
      formula: (a.formula as string | null) ?? null,
      source: (a.source as CashFlowAccountBase["source"]) ?? null,
      is_highlight_block: Boolean(a.is_highlight_block),
      sort_order: a.sort_order as number,
      active: Boolean(a.active),
    }));
    if (accounts.length === 0) return null;

    const scope = await loadScopedDreAccounts(supabase, companyIds);
    const dreRows = await aggregateDreRows({
      supabase,
      scope,
      companyIds,
      dateFrom: from,
      dateTo: to,
    });
    const dreResultado = findResultadoExercicio(dreRows);

    const { data: cfAgg } = await supabase.rpc("cash_flow_aggregate", {
      p_company_ids: companyIds,
      p_date_from: from,
      p_date_to: to,
    });
    const amounts = new Map<string, number>();
    (
      (cfAgg as Array<{ cash_flow_account_id: string; amount: number | string | null }> | null) ??
      []
    ).forEach((i) => amounts.set(i.cash_flow_account_id, Number(i.amount ?? 0)));

    const { rows } = buildCashFlowRows(accounts, amounts, {
      dreResultadoExercicio: dreResultado,
      saldoInicial: 0,
    });
    const caixaGeradoMes = rows.find((r) => r.code === "90.3")?.value ?? 0;

    return { caixaGeradoMes, mesLabel: `${MES_LABELS[month - 1]}/${year}` };
  } catch {
    return null;
  }
}

// Mini-DRE da unidade do franqueado: resultado e receita do mês corrente,
// escopado às empresas do franqueado (profile.company_ids).
export async function loadMiniDreFranqueado(
  supabase: SupabaseClient,
  profile: FinProfile,
): Promise<HomeMiniDre | null> {
  try {
    const companyIds = profile.company_ids;
    if (companyIds.length === 0) return null;

    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;
    const { from, to } = monthBounds(year, month);

    const scope = await loadScopedDreAccounts(supabase, companyIds);
    const rows = await aggregateDreRows({
      supabase,
      scope,
      companyIds,
      dateFrom: from,
      dateTo: to,
    });

    return {
      resultado: findResultadoExercicio(rows),
      receita: receitaLiquida(rows),
      mesLabel: `${MES_LABELS[month - 1]}/${year}`,
    };
  } catch {
    return null;
  }
}
