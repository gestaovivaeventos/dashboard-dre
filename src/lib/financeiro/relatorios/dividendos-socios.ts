import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClientIfAvailable } from "@/lib/supabase/admin";

import { CASH_FLOW_DRILLDOWN, fetchDrilldownRowsByMonth } from "./drilldown-chunked";
import { formatIsoDate } from "./dividendos-unidades";
import { normalizeCompanyName } from "./templates/hero-holding-template";

// ============================================================================
// Quadro de DIVIDENDOS PAGOS AOS SÓCIOS — EXCLUSIVO da Hero Holding.
// ============================================================================
// De onde vem o número: da linha "Dividendos Pagos" do FLUXO DE CAIXA da holding
// (conta 4.2 do plano custom da Hero) — a mesma linha e o mesmo detalhamento da
// tela. No drill-down, o sócio que recebeu aparece no campo FORNECEDOR
// (`supplier_customer`), com o nome completo da Omie ("RENAN SOTRATE FERREIRA -
// BB CC 43891-X"). Leitura mês a mês (ver drilldown-chunked.ts).
//
// DIFERENÇA IMPORTANTE em relação ao quadro de dividendos RECEBIDOS: aqui a
// lista de sócios é FIXA e vem da configuração do template (`partnerNames`). A
// empresa tem mais sócios cadastrados, mas só os configurados interessam ao
// relatório. Consequências:
//
//   1. Um sócio configurado SEMPRE aparece, inclusive com 0,00 — "não recebeu no
//      período" é informação, não motivo para sumir da lista.
//   2. Lançamentos de sócios NÃO configurados são ignorados e NÃO entram no
//      total. O total do quadro é a soma dos sócios listados, não o total da
//      linha 4.2 do Fluxo — por isso o rodapé do quadro diz isso explicitamente.
//
// O casamento é por CONTÉM: o nome do fornecedor (normalizado, sem acento e em
// minúsculas) contém o nome configurado do sócio ("Renan" casa com "RENAN
// SOTRATE FERREIRA - BB CC 43891-X"). Nomes mais longos são testados primeiro e
// cada lançamento é atribuído a NO MÁXIMO um sócio, para não contar duas vezes.
// ============================================================================

/** Code padrão da conta de Fluxo "Dividendos Pagos" no plano da Hero Holding. */
const DEFAULT_ACCOUNT_CODE = "4.2";
/** Fallback por nome, caso o code mude no plano da empresa. */
const DEFAULT_ACCOUNT_NAME = "Dividendos Pagos";

const LOG_LABEL = "dividendos-socios";

export interface DividendoSocioRow {
  /** Nome do sócio como configurado no template (ex.: "Renan"). */
  socio: string;
  /** Total pago no período de referência (0 quando não houve pagamento). */
  valor: number;
  /** % sobre o total pago aos sócios listados (null quando o total é 0). */
  pct: number | null;
}

export interface DividendosSociosResult {
  /** ReportBlockKey p/ gating ("dividendosSocios"). */
  key: string;
  title: string;
  /** Período de referência já formatado ("01/01/2026 a 30/06/2026"). */
  periodoLabel: string;
  rows: DividendoSocioRow[];
  total: number;
}

/** Conta de Fluxo de Caixa da empresa (linha do plano). */
interface CashFlowAccountRow {
  id: string;
  code: string;
  name: string;
  company_id: string | null;
}

interface BuildArgs {
  key: string;
  title: string;
  /** Empresa analisada (a holding que PAGA os dividendos). */
  companyId: string;
  /** Sócios a exibir, NA ORDEM. Quem não está aqui não entra no quadro. */
  partnerNames: string[];
  dateFrom: string;
  dateTo: string;
  /** Code da conta de Fluxo (default "4.2"). */
  accountCode?: string;
  /** Nome da conta de Fluxo p/ fallback (default "Dividendos Pagos"). */
  accountName?: string;
}

/**
 * Resolve a conta "Dividendos Pagos" no plano de Fluxo de Caixa da empresa.
 * Mesmo critério de escopo da tela: plano custom da empresa quando existe, senão
 * o global. Casa por CODE e, se não achar, por NOME normalizado.
 */
async function resolveDividendosPagosAccountId(
  supabase: SupabaseClient,
  companyId: string,
  accountCode: string,
  accountName: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("cash_flow_accounts")
    .select("id,code,name,company_id")
    .eq("active", true)
    .or(`company_id.is.null,company_id.eq.${companyId}`);
  if (error) {
    console.warn(`[${LOG_LABEL}] falha ao ler o plano de fluxo: ${error.message}`);
    return null;
  }

  const all = (data ?? []) as CashFlowAccountRow[];
  const hasCustomPlan = all.some((a) => a.company_id === companyId);
  const scoped = all.filter((a) =>
    hasCustomPlan ? a.company_id === companyId : a.company_id === null,
  );

  const byCode = scoped.find((a) => a.code === accountCode);
  if (byCode) return byCode.id;

  const wantedName = normalizeCompanyName(accountName);
  const byName = scoped.find((a) => normalizeCompanyName(a.name) === wantedName);
  return byName?.id ?? null;
}

/**
 * Monta o quadro de dividendos pagos aos sócios configurados no período.
 * Devolve `undefined` quando não há sócio configurado, quando a conta não existe
 * no plano de fluxo da empresa ou quando o período não pôde ser lido por
 * completo. NÃO devolve undefined por total zero: sócio configurado sem
 * pagamento é exibido com 0,00 (é informação relevante para a holding).
 */
export async function buildDividendosSociosBlock(
  supabase: SupabaseClient,
  args: BuildArgs,
): Promise<DividendosSociosResult | undefined> {
  const {
    key,
    title,
    companyId,
    partnerNames,
    dateFrom,
    dateTo,
    accountCode = DEFAULT_ACCOUNT_CODE,
    accountName = DEFAULT_ACCOUNT_NAME,
  } = args;

  const socios = (partnerNames ?? []).filter((n) => n && n.trim().length > 0);
  if (socios.length === 0) return undefined;

  // Admin client pelo mesmo motivo dos demais blocos da holding (ver
  // dividendos-unidades.ts). Estritamente LEITURA, da própria empresa analisada.
  const db = createAdminClientIfAvailable() ?? supabase;

  const accountId = await resolveDividendosPagosAccountId(
    db,
    companyId,
    accountCode,
    accountName,
  );
  if (!accountId) {
    console.warn(
      `[${LOG_LABEL}] conta "${accountName}" (code ${accountCode}) nao encontrada no plano de fluxo da empresa ${companyId}`,
    );
    return undefined;
  }

  const entries = await fetchDrilldownRowsByMonth(db, {
    source: CASH_FLOW_DRILLDOWN,
    accountId,
    companyId,
    dateFrom,
    dateTo,
    logLabel: LOG_LABEL,
  });
  if (entries === null) {
    console.warn(
      `[${LOG_LABEL}] periodo ${dateFrom}..${dateTo} incompleto para a empresa ${companyId}; quadro omitido`,
    );
    return undefined;
  }

  // Sócios configurados, testados do nome mais LONGO para o mais curto: evita
  // que um nome curto capture o lançamento de um sócio de nome mais específico.
  const candidates = socios
    .map((name) => ({ name, norm: normalizeCompanyName(name) }))
    .filter((c) => c.norm.length > 0)
    .sort((a, b) => b.norm.length - a.norm.length);

  // Começa com TODOS os sócios configurados em zero — quem não recebeu no
  // período aparece com 0,00 em vez de sumir do quadro.
  const bySocio = new Map<string, number>(socios.map((n) => [n, 0]));
  entries.forEach((e) => {
    const supplier = (e.supplier_customer ?? "").trim();
    if (!supplier) return;
    const norm = normalizeCompanyName(supplier);
    // No máximo UM sócio por lançamento (o primeiro casamento, mais longo).
    const hit = candidates.find((c) => norm.includes(c.norm));
    // Sócio fora da lista configurada: ignorado de propósito (ver cabeçalho).
    if (!hit) return;
    bySocio.set(hit.name, (bySocio.get(hit.name) ?? 0) + Number(e.value ?? 0));
  });

  // Ordem = a configurada no template (não por valor): a leitura da holding é
  // sempre a mesma lista de sócios, na mesma ordem, período após período.
  const total = socios.reduce((acc, n) => acc + (bySocio.get(n) ?? 0), 0);
  const rows: DividendoSocioRow[] = socios.map((socio) => {
    const valor = bySocio.get(socio) ?? 0;
    return { socio, valor, pct: total !== 0 ? (valor / total) * 100 : null };
  });

  return {
    key,
    title,
    periodoLabel: `${formatIsoDate(dateFrom)} a ${formatIsoDate(dateTo)}`,
    rows,
    total,
  };
}
