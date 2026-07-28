import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClientIfAvailable } from "@/lib/supabase/admin";

import { normalizeCompanyName } from "./templates/hero-holding-template";

// ============================================================================
// Quadro de DIVIDENDOS RECEBIDOS POR UNIDADE — EXCLUSIVO da Hero Holding.
// ============================================================================
// De onde vem o número: da MESMA fonte da tela de Fluxo de Caixa. A linha
// "Dividendos Recebidos" do Fluxo é alimentada pelos lançamentos da Omie
// mapeados para aquela conta de fluxo; no drill-down da tela, a unidade que
// distribuiu o dividendo aparece no campo FORNECEDOR (`supplier_customer`).
//
// Este módulo apenas AGRUPA esse mesmo drill-down por fornecedor, no período de
// referência escolhido pelo usuário na geração do relatório — via a RPC
// `cash_flow_drilldown`, a mesma que a tela usa. Nenhum cálculo paralelo, nenhum
// valor manual: mudou na Omie, muda aqui na próxima geração do relatório.
//
// Nome exibido: o fornecedor vem da Omie com a razão social ("VIVA VOLTA
// REDONDA EVENTOS LTDA"). Quando o nome do fornecedor CONTÉM o nome de uma
// empresa cadastrada no mesmo segmento (comparação normalizada — sem acento,
// minúscula), exibimos o nome da empresa cadastrada ("Viva Volta Redonda") e
// somamos as grafias diferentes numa linha só. Sem casamento, mantemos o nome
// cru do fornecedor — nunca inventamos nem escondemos valor.
//
// REGRA DE EXIBIÇÃO: só entram unidades com dividendo no período (total ≠ 0).
// Sem nenhuma linha, o builder devolve `undefined` e o quadro não aparece.
// ============================================================================

/** Code padrão da conta de Fluxo de Caixa "Dividendos Recebidos" (plano global). */
const DEFAULT_ACCOUNT_CODE = "4.1";
/** Fallback por nome, caso a empresa tenha plano custom com outro code. */
const DEFAULT_ACCOUNT_NAME = "Dividendos Recebidos";

/** Página do drill-down. O cap do PostgREST é 1000 — pagina até esgotar. */
const PAGE_SIZE = 1000;
const MAX_PAGES = 20;

export interface DividendoUnidadeRow {
  /** Nome da unidade (empresa cadastrada) ou o fornecedor cru da Omie. */
  unidade: string;
  /** Total recebido no período de referência. */
  valor: number;
  /** % sobre o total de dividendos do período (null quando o total é 0). */
  pct: number | null;
}

export interface DividendosUnidadesResult {
  /** ReportBlockKey p/ gating ("dividendosUnidades"). */
  key: string;
  title: string;
  /** Período de referência já formatado ("01/01/2026 a 30/04/2026"). */
  periodoLabel: string;
  rows: DividendoUnidadeRow[];
  total: number;
}

interface BuildArgs {
  key: string;
  title: string;
  /** Empresa analisada (a holding que RECEBE os dividendos). */
  companyId: string;
  /** Segmento da empresa — usado só para resolver os nomes das unidades. */
  segmentId: string | null;
  dateFrom: string;
  dateTo: string;
  /** Code da conta de Fluxo (default "4.1"). */
  accountCode?: string;
  /** Nome da conta de Fluxo p/ fallback (default "Dividendos Recebidos"). */
  accountName?: string;
}

interface CashFlowAccountRow {
  id: string;
  code: string;
  name: string;
  company_id: string | null;
}

interface DrilldownRow {
  supplier_customer: string | null;
  value: number | string | null;
  total_count: number | string | null;
}

/** "2026-01-01" → "01/01/2026". Entrada inválida volta como veio. */
function formatIsoDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/**
 * Resolve a conta "Dividendos Recebidos" no plano de Fluxo de Caixa da empresa.
 * Mesmo critério de escopo da tela: plano custom da empresa quando existe, senão
 * o global. Casa por CODE e, se não achar, por NOME normalizado.
 */
async function resolveDividendosAccountId(
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
  if (error) return null;

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
 * Lê TODOS os lançamentos da conta no período, paginando a RPC do drill-down
 * (a mesma da tela de Fluxo de Caixa) até esgotar o `total_count`.
 */
async function fetchAllDrilldownRows(
  supabase: SupabaseClient,
  accountId: string,
  companyId: string,
  dateFrom: string,
  dateTo: string,
): Promise<DrilldownRow[]> {
  const rows: DrilldownRow[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data, error } = await supabase.rpc("cash_flow_drilldown", {
      p_cash_flow_account_id: accountId,
      p_company_ids: [companyId],
      p_date_from: dateFrom,
      p_date_to: dateTo,
      p_search: "",
      p_limit: PAGE_SIZE,
      p_offset: page * PAGE_SIZE,
    });
    if (error) return rows;
    const batch = (data ?? []) as DrilldownRow[];
    rows.push(...batch);
    const total = Number(batch[0]?.total_count ?? 0);
    if (batch.length < PAGE_SIZE || rows.length >= total) break;
  }
  return rows;
}

/**
 * Monta o quadro de dividendos recebidos por unidade no período. Devolve
 * `undefined` quando a conta não existe no plano da empresa ou quando não houve
 * nenhum dividendo no período (o relatório então não exibe o quadro).
 */
export async function buildDividendosUnidadesBlock(
  supabase: SupabaseClient,
  args: BuildArgs,
): Promise<DividendosUnidadesResult | undefined> {
  const {
    key,
    title,
    companyId,
    segmentId,
    dateFrom,
    dateTo,
    accountCode = DEFAULT_ACCOUNT_CODE,
    accountName = DEFAULT_ACCOUNT_NAME,
  } = args;

  const accountId = await resolveDividendosAccountId(
    supabase,
    companyId,
    accountCode,
    accountName,
  );
  if (!accountId) return undefined;

  const entries = await fetchAllDrilldownRows(
    supabase,
    accountId,
    companyId,
    dateFrom,
    dateTo,
  );
  if (entries.length === 0) return undefined;

  // Nomes das unidades do mesmo segmento, para exibir "Viva Volta Redonda" no
  // lugar da razão social crua da Omie. Leitura com admin client (quando
  // disponível) pelo mesmo motivo do comparativo/mútuos da holding: quem gera o
  // relatório da holding não tem, necessariamente, acesso a cada unidade.
  // Estritamente LEITURA de nome — nenhum dado financeiro vem daqui.
  const db = createAdminClientIfAvailable() ?? supabase;
  let unitNames: string[] = [];
  if (segmentId) {
    const { data: siblings } = await db
      .from("companies")
      .select("name")
      .eq("segment_id", segmentId);
    unitNames = ((siblings ?? []) as Array<{ name: string }>)
      .map((c) => c.name)
      .filter((n) => n && n.trim().length > 0);
  }
  // Mais longo primeiro: evita que "Viva Go" capture um fornecedor que casa com
  // um nome mais específico da lista.
  const candidates = unitNames
    .map((name) => ({ name, norm: normalizeCompanyName(name) }))
    .filter((c) => c.norm.length > 0)
    .sort((a, b) => b.norm.length - a.norm.length);

  const displayNameFor = (supplier: string): string => {
    const norm = normalizeCompanyName(supplier);
    const hit = candidates.find((c) => norm.includes(c.norm));
    return hit ? hit.name : supplier;
  };

  // Agrupa por unidade. Grafias diferentes do mesmo fornecedor que casam com a
  // mesma empresa cadastrada caem na MESMA linha.
  const byUnidade = new Map<string, number>();
  entries.forEach((e) => {
    const supplier = (e.supplier_customer ?? "").trim();
    const unidade = supplier ? displayNameFor(supplier) : "Não identificado";
    byUnidade.set(unidade, (byUnidade.get(unidade) ?? 0) + Number(e.value ?? 0));
  });

  // Só unidades com movimento no período; ordena da maior para a menor.
  const rowsRaw = Array.from(byUnidade.entries())
    .filter(([, valor]) => valor !== 0)
    .sort((a, b) => b[1] - a[1]);
  if (rowsRaw.length === 0) return undefined;

  const total = rowsRaw.reduce((acc, [, valor]) => acc + valor, 0);
  const rows: DividendoUnidadeRow[] = rowsRaw.map(([unidade, valor]) => ({
    unidade,
    valor,
    pct: total !== 0 ? (valor / total) * 100 : null,
  }));

  return {
    key,
    title,
    periodoLabel: `${formatIsoDate(dateFrom)} a ${formatIsoDate(dateTo)}`,
    rows,
    total,
  };
}
