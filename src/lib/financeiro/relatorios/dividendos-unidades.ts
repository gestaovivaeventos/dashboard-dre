import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClientIfAvailable } from "@/lib/supabase/admin";

import { DRE_DRILLDOWN, fetchDrilldownRowsByMonth } from "./drilldown-chunked";
import { normalizeCompanyName } from "./templates/hero-holding-template";

// ============================================================================
// Quadro de DIVIDENDOS RECEBIDOS POR UNIDADE — EXCLUSIVO da Hero Holding.
// ============================================================================
// De onde vem o número: da linha "Dividendos Recebidos" do DRE GERENCIAL da
// holding (conta 1.3 no plano da Hero). Essa linha vivia no Fluxo de Caixa e foi
// deslocada para o DRE para compor o resultado — é a MESMA categoria da Omie e o
// MESMO valor; só mudou a tela que a apresenta. No drill-down, a unidade que
// distribuiu o dividendo aparece no campo FORNECEDOR (`supplier_customer`).
//
// Este módulo apenas AGRUPA esse mesmo drill-down por fornecedor, no período de
// referência escolhido pelo usuário na geração do relatório — via a RPC
// `dashboard_dre_drilldown`, a mesma que a tela usa (lida mês a mês, ver
// drilldown-chunked.ts). Nenhum cálculo paralelo, nenhum valor manual: mudou na
// Omie, muda aqui na próxima geração do relatório.
//
// Nome exibido: o fornecedor vem da Omie com a razão social ("VIVA CAMPO GRANDE
// - BB CC 123852-3"). Quando o nome do fornecedor CONTÉM o nome de uma empresa
// cadastrada no mesmo segmento (comparação normalizada — sem acento, minúscula),
// exibimos o nome da empresa cadastrada ("Viva Campo Grande") e somamos as
// grafias diferentes numa linha só. Sem casamento, mantemos o nome cru do
// fornecedor — nunca inventamos nem escondemos valor.
//
// REGRA DE EXIBIÇÃO: só entram unidades com dividendo no período (total ≠ 0).
// Sem nenhuma linha, o builder devolve `undefined` e o quadro não aparece.
// ============================================================================

/** Code padrão da conta DRE "Dividendos Recebidos" no plano da Hero Holding. */
const DEFAULT_ACCOUNT_CODE = "1.3";
/** Fallback por nome, caso o code mude no plano da empresa. */
const DEFAULT_ACCOUNT_NAME = "Dividendos Recebidos";

const LOG_LABEL = "dividendos-unidades";

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

/** Conta DRE já escopada no plano da empresa (custom quando existe, senão global). */
export interface ScopedDreAccount {
  id: string;
  code: string;
  name: string;
}

interface BuildArgs {
  key: string;
  title: string;
  /** Empresa analisada (a holding que RECEBE os dividendos). */
  companyId: string;
  /** Segmento da empresa — usado só para resolver os nomes das unidades. */
  segmentId: string | null;
  /**
   * Plano DRE JÁ ESCOPADO na empresa (o mesmo que o restante do relatório usa).
   * Recebido pronto para não duplicar a regra de escopo custom/global aqui.
   */
  accounts: ScopedDreAccount[];
  dateFrom: string;
  dateTo: string;
  /** Code da conta DRE (default "1.3"). */
  accountCode?: string;
  /** Nome da conta DRE p/ fallback (default "Dividendos Recebidos"). */
  accountName?: string;
}

/** "2026-01-01" → "01/01/2026". Entrada inválida volta como veio. */
export function formatIsoDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/**
 * Resolve a conta "Dividendos Recebidos" dentro do plano DRE JÁ ESCOPADO na
 * empresa. Casa por CODE e, se não achar, por NOME normalizado — assim a linha
 * continua sendo encontrada se o code mudar de posição no plano.
 */
function resolveDividendosAccountId(
  accounts: ScopedDreAccount[],
  accountCode: string,
  accountName: string,
): string | null {
  const byCode = accounts.find((a) => a.code === accountCode);
  if (byCode) return byCode.id;

  const wantedName = normalizeCompanyName(accountName);
  const byName = accounts.find((a) => normalizeCompanyName(a.name) === wantedName);
  return byName?.id ?? null;
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
    accounts,
    dateFrom,
    dateTo,
    accountCode = DEFAULT_ACCOUNT_CODE,
    accountName = DEFAULT_ACCOUNT_NAME,
  } = args;

  // Leitura com admin client (quando disponível), pelo mesmo motivo do
  // comparativo e dos mútuos da holding: tira a RLS do caminho de uma consulta
  // já pesada (a RPC mapeia lançamento a lançamento) e mantém o custo previsível.
  // Estritamente LEITURA, e da PRÓPRIA empresa analisada — o relatório dela já
  // foi autorizado na rota. Sem service key, cai para o client da sessão.
  const db = createAdminClientIfAvailable() ?? supabase;

  const accountId = resolveDividendosAccountId(accounts, accountCode, accountName);
  if (!accountId) {
    console.warn(
      `[${LOG_LABEL}] conta "${accountName}" (code ${accountCode}) nao encontrada no plano DRE da empresa ${companyId}`,
    );
    return undefined;
  }

  const entries = await fetchDrilldownRowsByMonth(db, {
    source: DRE_DRILLDOWN,
    accountId,
    companyId,
    dateFrom,
    dateTo,
    logLabel: LOG_LABEL,
  });
  // null = algum mês nao pôde ser lido. Some o quadro (nunca um total parcial),
  // mas com registro no log — antes esta falha era invisível.
  if (entries === null) {
    console.warn(
      `[${LOG_LABEL}] periodo ${dateFrom}..${dateTo} incompleto para a empresa ${companyId}; quadro omitido`,
    );
    return undefined;
  }
  if (entries.length === 0) return undefined;

  // Nomes das unidades do mesmo segmento, para exibir "Viva Volta Redonda" no
  // lugar da razão social crua da Omie — quem gera o relatório da holding não
  // tem, necessariamente, acesso a cada unidade. Estritamente LEITURA de nome:
  // nenhum dado financeiro vem daqui.
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
