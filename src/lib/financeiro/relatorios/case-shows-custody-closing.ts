import type { SupabaseClient } from "@supabase/supabase-js";

import type { CashFlowAccountBase } from "@/lib/dashboard/cash-flow";
import {
  CASE_SHOWS_COMPANY_NAME,
  COMPETENCIA_FLOOR_YEAR,
  buildCompetenciaSection,
  custodyNetFromAmounts,
  resolveCustodyAccounts,
  type CompetenciaRegistrationRow,
} from "@/lib/dashboard/case-shows-custody";

// ============================================================================
// Saldo final da "Custódia de Artistas" da Case Shows para o One Page Report.
//
// A tela de Fluxo de Caixa já calcula DOIS saldos finais de custódia para a
// Case Shows; este módulo reproduz APENAS o valor de fechamento de cada um, no
// MÊS DE REFERÊNCIA do relatório (mês de `dateTo`), reaproveitando o mesmo
// motor de cálculo do Fluxo (case-shows-custody.ts) — sem duplicar a regra:
//
//   1. Regime de CAIXA (aparece primeiro no Fluxo): saldo corrido por DATA DE
//      PAGAMENTO. É LINEAR no movimento líquido (Entradas - Saídas - Comissões),
//      então o saldo de fechamento do mês de `dateTo` = movimento líquido
//      acumulado desde o início da história até `dateTo` — uma única agregação
//      de Fluxo de Caixa (cash_flow_aggregate), igual ao seed encadeado na tela.
//
//   2. Regime de COMPETÊNCIA ("Análise Competência", mais abaixo no Fluxo):
//      saldo corrido por DATA DE REGISTRO, lido da tabela dedicada
//      `case_shows_custody_competencia`. Reaproveita `buildCompetenciaSection`
//      pedindo um único bucket = mês de `dateTo`; o saldo final daquele mês é o
//      acumulado desde o piso (2026) até ele.
//
// ISOLAMENTO: só dispara quando a empresa analisada é a Case Shows (gate por
// NOME, mesmo padrão de resolveCaseShowsCompanyId) e o plano de Fluxo dela tem
// o núcleo "6 Custódia" com as 5 sublinhas. Caso contrário devolve null e o
// quadro simplesmente não aparece — não toca nenhuma outra empresa nem o cálculo
// oficial. Ver src/lib/dashboard/case-shows-custody.ts.
// ============================================================================

// Baseline "desde o início da história" para o saldo corrido de caixa — mesmo
// valor usado no seed da custódia em fluxo-de-caixa/page.tsx.
const SALDO_BASELINE_FAR_PAST = "1900-01-01";

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function round2(n: number): number {
  return Number(n.toFixed(2));
}

// Bloco enviado ao One Page Report (preview/PDF). Valores em R$ cheios.
export interface CaseShowsCustodyClosingPayload {
  // Mês de referência do relatório (mesmo rótulo do cabeçalho/período).
  referenciaLabel: string;
  // Saldo final da custódia no regime de CAIXA (por data de pagamento).
  saldoFinalCaixa: number;
  // Saldo final da custódia no regime de COMPETÊNCIA (por data de registro).
  // null quando o mês de referência é anterior ao piso (2026) — sem dados.
  saldoFinalCompetencia: number | null;
}

interface BuildArgs {
  companyId: string;
  companyName: string;
  // Data final do período do relatório (ISO "YYYY-MM-DD"). O mês de referência
  // é derivado dela.
  dateTo: string;
  referenciaLabel: string;
}

/**
 * Constrói o quadro de saldo final de custódia (caixa + competência) da Case
 * Shows até o mês de `dateTo`. Devolve null quando a empresa não é a Case Shows
 * ou seu plano de Fluxo não tem o núcleo de Custódia (no-op seguro).
 */
export async function buildCaseShowsCustodyClosing(
  supabase: SupabaseClient,
  { companyId, companyName, dateTo, referenciaLabel }: BuildArgs,
): Promise<CaseShowsCustodyClosingPayload | null> {
  if (normalizeName(companyName) !== normalizeName(CASE_SHOWS_COMPANY_NAME)) {
    return null;
  }

  // Plano de Fluxo de Caixa escopado na empresa (mesma lógica de scope da tela:
  // se a empresa tem plano custom, usa só o dela; senão o global).
  const { data: cfData, error: cfErr } = await supabase
    .from("cash_flow_accounts")
    .select(
      "id,code,name,parent_id,level,type,is_summary,formula,source,is_highlight_block,sort_order,active,company_id",
    )
    .eq("active", true)
    .order("sort_order");
  if (cfErr) return null;

  const allRaw = (cfData ?? []) as Array<
    CashFlowAccountBase & { company_id: string | null }
  >;
  const hasCustomPlan = allRaw.some((a) => a.company_id === companyId);
  const cashFlowAccounts: CashFlowAccountBase[] = allRaw
    .filter((a) => (hasCustomPlan ? a.company_id === companyId : a.company_id === null))
    .map((a) => ({
      id: a.id,
      code: a.code,
      name: a.name,
      parent_id: a.parent_id,
      level: a.level,
      type: a.type,
      is_summary: a.is_summary,
      formula: a.formula,
      source: a.source,
      is_highlight_block: a.is_highlight_block,
      sort_order: a.sort_order,
      active: a.active,
    }));

  const custody = resolveCustodyAccounts(cashFlowAccounts);
  if (!custody) return null;

  // ── 1. Saldo final REGIME DE CAIXA ──────────────────────────────────────
  // Movimento líquido acumulado (6.2 - 6.3 - 6.4) por data de pagamento, desde
  // o início da história até dateTo. (Case Shows não tem piso de período.)
  const { data: caixaAgg, error: caixaErr } = await supabase.rpc(
    "cash_flow_aggregate",
    {
      p_company_ids: [companyId],
      p_date_from: SALDO_BASELINE_FAR_PAST,
      p_date_to: dateTo,
    },
  );
  if (caixaErr) return null;

  const caixaAmounts = new Map<string, number>();
  (
    (caixaAgg as Array<{
      cash_flow_account_id: string;
      amount: number | string | null;
    }> | null) ?? []
  ).forEach((item) => {
    caixaAmounts.set(item.cash_flow_account_id, Number(item.amount ?? 0));
  });
  const saldoFinalCaixa = custodyNetFromAmounts(caixaAmounts, custody);

  // ── 2. Saldo final REGIME DE COMPETÊNCIA ────────────────────────────────
  // Por data de registro, lido de case_shows_custody_competencia. Acumula do
  // piso (2026) até o mês de dateTo. Anterior ao piso → sem dados (null).
  const toYear = parseInt(dateTo.slice(0, 4), 10);
  const toMonth = parseInt(dateTo.slice(5, 7), 10);

  let saldoFinalCompetencia: number | null = null;
  if (toYear >= COMPETENCIA_FLOOR_YEAR) {
    // De/para categoria→conta (6.2/6.3/6.4): escopo da empresa tem prioridade
    // sobre o global — mesmo critério da tela de Fluxo.
    const { data: mapData } = await supabase
      .from("cash_flow_category_mappings")
      .select("omie_category_code, cash_flow_account_id, company_id")
      .in("cash_flow_account_id", [
        custody.entradasId,
        custody.saidasId,
        custody.comissoesId,
      ]);

    const accountByCode = new Map<string, string>();
    (
      (mapData as Array<{
        omie_category_code: string;
        cash_flow_account_id: string;
        company_id: string | null;
      }> | null) ?? []
    )
      .filter((m) => m.company_id === companyId || m.company_id === null)
      .forEach((m) => {
        if (m.company_id === companyId || !accountByCode.has(m.omie_category_code)) {
          accountByCode.set(m.omie_category_code, m.cash_flow_account_id);
        }
      });

    const { data: compData, error: compErr } = await supabase
      .from("case_shows_custody_competencia")
      .select("period_year, period_month, category_code, amount")
      .eq("company_id", companyId)
      .gte("period_year", COMPETENCIA_FLOOR_YEAR)
      .lte("period_year", toYear);
    if (compErr) return null;

    const registrationRows: CompetenciaRegistrationRow[] = (
      (compData as Array<{
        period_year: number | string;
        period_month: number | string;
        category_code: string;
        amount: number | string | null;
      }> | null) ?? []
    )
      .map((r) => {
        const accountId = accountByCode.get(r.category_code);
        if (!accountId) return null;
        return {
          period_year: Number(r.period_year),
          period_month: Number(r.period_month),
          cash_flow_account_id: accountId,
          amount: Number(r.amount ?? 0),
        } as CompetenciaRegistrationRow;
      })
      .filter((r): r is CompetenciaRegistrationRow => r !== null);

    // Um único bucket = mês de referência. currentYear/Month = mês de
    // referência: o saldo corrido acumula exatamente até ele (não além).
    const section = buildCompetenciaSection({
      custody,
      rows: registrationRows,
      visibleBuckets: [{ key: "ref", year: toYear, month: toMonth }],
      currentYear: toYear,
      currentMonth: toMonth,
    });
    const saldoFinalLine = section.lines.find((l) => l.key === "saldo_final");
    saldoFinalCompetencia = saldoFinalLine
      ? round2(saldoFinalLine.accumulatedValue)
      : null;
  }

  return {
    referenciaLabel,
    saldoFinalCaixa: round2(saldoFinalCaixa),
    saldoFinalCompetencia,
  };
}
