import type { SupabaseClient } from "@supabase/supabase-js";

import { buildCashFlowRows } from "@/lib/dashboard/cash-flow";

import { fetchScopedCashFlowAccounts, findCashFlowAccount } from "./cash-flow-account";

// ============================================================================
// Linha COMPLEMENTAR do indicador "Resultado operacional do período" — hoje
// EXCLUSIVA da Hero Holding.
// ============================================================================
// O número grande do indicador continua sendo, para TODA empresa, o "Resultado
// do Exercício" da tela de DRE Gerencial no período de referência. Este módulo
// não toca nele: apenas calcula um SEGUNDO valor, exibido logo abaixo do
// percentual vs orçado, no mesmo quadro.
//
// Por que a Hero Holding precisa dele: a categoria "Dividendos Recebidos" das
// unidades voltou a ser apresentada na tela de FLUXO DE CAIXA (conta 4.1), ou
// seja, ela NÃO compõe mais o Resultado do Exercício do DRE. Como a operação da
// holding é justamente receber dividendos das unidades, a diretoria precisa ver
// as duas leituras lado a lado:
//
//     Resultado do Exercício (DRE)                    → número grande
//     Resultado do Exercício + Dividendos Recebidos   → linha complementar
//
// De onde vem o valor somado: da MESMA fonte da tela de Fluxo de Caixa — RPC
// `cash_flow_aggregate` no período do relatório + o plano de fluxo escopado na
// empresa, passados pelo mesmo `buildCashFlowRows` que monta as linhas da tela.
// Nenhum cálculo paralelo e nenhum valor manual: o que mudar na Omie muda aqui
// na próxima geração.
//
// ISOLAMENTO: só roda quando o template da empresa define
// `report.resumoResultadoComplemento` (hoje apenas hero-holding). Sem essa
// configuração o builder nem é chamado e nada muda para as demais empresas.
//
// Falha (plano ilegível, conta ausente do plano, RPC com erro) devolve
// `undefined`: a linha simplesmente não aparece. Nunca exibimos um total parcial
// como se fosse o valor somado.
// ============================================================================

/** Code padrão da conta de Fluxo "Dividendos Recebidos" (plano global e Hero). */
const DEFAULT_ACCOUNT_CODE = "4.1";
/** Fallback por nome, caso o code mude no plano da empresa. */
const DEFAULT_ACCOUNT_NAME = "Dividendos Recebidos";

const LOG_LABEL = "resumo-resultado-complemento";

export interface ResumoResultadoComplementoResult {
  /** Rótulo exibido acima do valor (ex.: "Somando os dividendos recebidos"). */
  label: string;
  /** Resultado do Exercício + valor da conta de fluxo, em R$ cheios. */
  value: number;
  /** Apenas a parcela somada (a conta de fluxo) — usado no input da IA. */
  complementValue: number;
}

interface BuildArgs {
  companyId: string;
  dateFrom: string;
  dateTo: string;
  /** Resultado do Exercício do DRE no período (o número grande do indicador). */
  resultadoRealizado: number;
  label: string;
  /** Code da conta de Fluxo a somar (default "4.1"). */
  accountCode?: string;
  /** Nome da conta de Fluxo p/ fallback (default "Dividendos Recebidos"). */
  accountName?: string;
}

export async function buildResumoResultadoComplemento(
  supabase: SupabaseClient,
  args: BuildArgs,
): Promise<ResumoResultadoComplementoResult | undefined> {
  const {
    companyId,
    dateFrom,
    dateTo,
    resultadoRealizado,
    label,
    accountCode = DEFAULT_ACCOUNT_CODE,
    accountName = DEFAULT_ACCOUNT_NAME,
  } = args;

  const accounts = await fetchScopedCashFlowAccounts(supabase, companyId, LOG_LABEL);
  if (!accounts || accounts.length === 0) return undefined;

  const account = findCashFlowAccount(accounts, accountCode, accountName);
  if (!account) {
    console.warn(
      `[${LOG_LABEL}] conta "${accountName}" (code ${accountCode}) nao encontrada no plano de fluxo da empresa ${companyId}`,
    );
    return undefined;
  }

  const { data, error } = await supabase.rpc("cash_flow_aggregate", {
    p_company_ids: [companyId],
    p_date_from: dateFrom,
    p_date_to: dateTo,
  });
  if (error) {
    console.warn(
      `[${LOG_LABEL}] cash_flow_aggregate falhou em ${dateFrom}..${dateTo}: ${error.message}`,
    );
    return undefined;
  }

  const amounts = new Map<string, number>();
  (
    (data as Array<{
      cash_flow_account_id: string;
      amount: number | string | null;
    }> | null) ?? []
  ).forEach((row) => {
    amounts.set(row.cash_flow_account_id, Number(row.amount ?? 0));
  });

  // Mesmo motor de linhas da tela de Fluxo: conta folha devolve o próprio
  // agregado; conta totalizadora soma os filhos com sinal. Assim o valor somado
  // é exatamente o que a tela mostra naquela linha, no mesmo período.
  const { rows } = buildCashFlowRows(accounts, amounts);
  const complementValue = rows.find((r) => r.id === account.id)?.value ?? 0;

  return {
    label,
    value: resultadoRealizado + complementValue,
    complementValue,
  };
}
