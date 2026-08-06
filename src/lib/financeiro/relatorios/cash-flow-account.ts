import type { SupabaseClient } from "@supabase/supabase-js";

import type { CashFlowAccountBase } from "@/lib/dashboard/cash-flow";

import { normalizeCompanyName } from "./templates/hero-holding-template";

// ============================================================================
// Resolução de conta do FLUXO DE CAIXA no plano escopado da empresa.
// ============================================================================
// Mesmo critério de escopo da tela de Fluxo de Caixa: se a empresa tem plano
// CUSTOM, usa só o dela; senão, o plano GLOBAL. Concentrado aqui porque mais de
// um bloco do relatório precisa da mesma resolução (dividendos pagos aos sócios,
// dividendos recebidos das unidades e a linha complementar do Resumo Executivo)
// — três cópias da mesma regra divergiriam com o tempo.
//
// O casamento é por CODE e, quando não encontra, por NOME normalizado (sem
// acento, minúsculo): assim a linha continua sendo encontrada se o code mudar de
// posição no plano da empresa. Nunca "adivinha" outra conta: sem casamento,
// devolve null e o chamador omite o bloco.
// ============================================================================

/** Linha crua do plano de fluxo (inclui o dono do plano). */
type ScopedRow = CashFlowAccountBase & { company_id: string | null };

const SELECT_COLUMNS =
  "id,code,name,parent_id,level,type,is_summary,formula,source,is_highlight_block,sort_order,active,company_id";

/**
 * Plano de Fluxo de Caixa JÁ ESCOPADO na empresa (custom quando existe, senão o
 * global), ordenado por `sort_order` — o mesmo insumo que a tela usa para montar
 * as linhas. Devolve `null` quando a leitura falha (o chamador distingue "plano
 * vazio" de "não consegui ler").
 */
export async function fetchScopedCashFlowAccounts(
  supabase: SupabaseClient,
  companyId: string,
  logLabel: string,
): Promise<CashFlowAccountBase[] | null> {
  const { data, error } = await supabase
    .from("cash_flow_accounts")
    .select(SELECT_COLUMNS)
    .eq("active", true)
    // Só o plano global + o da própria empresa: mantém a consulta bem abaixo do
    // cap de 1000 linhas do PostgREST, mesmo com muitas empresas cadastradas.
    .or(`company_id.is.null,company_id.eq.${companyId}`)
    .order("sort_order");
  if (error) {
    console.warn(`[${logLabel}] falha ao ler o plano de fluxo: ${error.message}`);
    return null;
  }

  const all = (data ?? []) as ScopedRow[];
  const hasCustomPlan = all.some((a) => a.company_id === companyId);
  return all
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
}

/** Acha a conta por CODE e, no fallback, por NOME normalizado. */
export function findCashFlowAccount(
  accounts: CashFlowAccountBase[],
  accountCode: string,
  accountName: string,
): CashFlowAccountBase | null {
  const byCode = accounts.find((a) => a.code === accountCode);
  if (byCode) return byCode;

  const wantedName = normalizeCompanyName(accountName);
  return accounts.find((a) => normalizeCompanyName(a.name) === wantedName) ?? null;
}

/**
 * Id da conta de fluxo (code → nome) dentro do plano escopado da empresa.
 * `null` quando o plano não pôde ser lido ou a conta não existe nele.
 */
export async function resolveScopedCashFlowAccountId(
  supabase: SupabaseClient,
  args: {
    companyId: string;
    accountCode: string;
    accountName: string;
    logLabel: string;
  },
): Promise<string | null> {
  const { companyId, accountCode, accountName, logLabel } = args;
  const accounts = await fetchScopedCashFlowAccounts(supabase, companyId, logLabel);
  if (!accounts) return null;
  return findCashFlowAccount(accounts, accountCode, accountName)?.id ?? null;
}
