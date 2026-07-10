import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserProfile } from "@/lib/supabase/types";

export type PeriodMode = "especifico" | "mes_atual" | "ano_atual";
type DreType = "receita" | "despesa" | "calculado" | "misto";

// Keep legacy ViewMode export for type compatibility
export type ViewMode = "simples" | "comparativa";

export interface DreAccountBase {
  id: string;
  code: string;
  name: string;
  parent_id: string | null;
  level: number;
  type: DreType;
  is_summary: boolean;
  formula: string | null;
  sort_order: number;
  active: boolean;
}

export interface DashboardFilterState {
  periodMode: PeriodMode;
  monthFrom: number;
  yearFrom: number;
  monthTo: number;
  yearTo: number;
  selectedCompanyIds: string[];
  compareCompanies: boolean;
  budgetMode: boolean;
  // Legacy fields kept for backward compat with URL params
  viewMode: ViewMode;
  periodType: string;
  year: number;
  month: number;
  quarter: number;
  semester: 1 | 2;
  startDate: string;
  endDate: string;
}

export interface DashboardRange {
  dateFrom: string;
  dateTo: string;
  label: string;
}

export interface DashboardPeriodBucket {
  key: string;
  label: string;
  dateFrom: string;
  dateTo: string;
}

export interface DashboardRow extends DreAccountBase {
  value: number;
  percentageOverNetRevenue: number;
  hasChildren: boolean;
}

// "Core DRE" = linhas de resultado (top-level 1..19). O plano global encerra o
// DRE no code 11 (Resultado do Exercício), mas planos customizados por empresa
// estendem o DRE com linhas próprias acima de 11 — ex.: Viva Juiz de Fora (12
// Margens Ensino Médio, 13 Resultado do Exercício Ajustado) e SGX (12-15
// Projetos / Resultados). O bloco do Fluxo de Caixa começa em 20 (Empréstimos,
// Investimentos, Dividendos, Aportes, Fluxo de Caixa) e segue EXCLUÍDO do
// dashboard DRE — por isso o teto é 19, não "qualquer code". Empresas sem
// codes 12-19 não são afetadas.
export function isCoreDreCode(code: string) {
  const topLevel = Number(code.split(".")[0]);
  if (!Number.isInteger(topLevel) || topLevel < 1) return false;
  // 20..24 sao contas de fluxo de caixa no plano global (Emprestimos,
  // Investimentos, Dividendos, Aportes, Fluxo de Caixa) — nao entram na DRE.
  // 1..19 ficam disponiveis para planos custom per-company (ex.: SGX usa
  // 1..15 para Locacao/Operacional/Projetos com 4 subresultados).
  if (topLevel >= 20 && topLevel <= 24) return false;
  return topLevel <= 19;
}

export function filterCoreDreAccounts(accounts: DreAccountBase[]) {
  return accounts.filter((account) => isCoreDreCode(account.code));
}

function startOfMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month - 1, 1));
}

function endOfMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0));
}

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function parseInteger(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

const MONTH_NAMES = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
  "Jul", "Ago", "Set", "Out", "Nov", "Dez",
];

export function buildFilterState(
  searchParams: Record<string, string | string[] | undefined>,
  companyIds: string[],
) {
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1;

  const periodMode = (searchParams.periodMode as PeriodMode) || "ano_atual";

  let yearFrom: number;
  let monthFrom: number;
  let yearTo: number;
  let monthTo: number;

  if (periodMode === "mes_atual") {
    yearFrom = currentYear;
    monthFrom = currentMonth;
    yearTo = currentYear;
    monthTo = currentMonth;
  } else if (periodMode === "ano_atual") {
    yearFrom = currentYear;
    monthFrom = 1;
    yearTo = currentYear;
    monthTo = 12;
  } else {
    // especifico
    yearFrom = parseInteger(searchParams.yearFrom as string | undefined, currentYear);
    monthFrom = Math.min(12, Math.max(1, parseInteger(searchParams.monthFrom as string | undefined, 1)));
    yearTo = parseInteger(searchParams.yearTo as string | undefined, currentYear);
    monthTo = Math.min(12, Math.max(1, parseInteger(searchParams.monthTo as string | undefined, currentMonth)));
  }

  const rawCompanies = (searchParams.companyIds as string | undefined)?.split(",").filter(Boolean) ?? [];
  const hasCompanyParam = Boolean(searchParams.companyIds);
  const selectedCompanyIds = rawCompanies.includes("all")
    ? companyIds
    : hasCompanyParam
      ? rawCompanies.filter((companyId) => companyIds.includes(companyId))
      : []; // No companies selected by default — user must choose

  const compareCompanies = searchParams.compareCompanies === "true";
  const budgetMode = searchParams.budgetMode === "true";

  return {
    periodMode,
    yearFrom,
    monthFrom,
    yearTo,
    monthTo,
    selectedCompanyIds,
    compareCompanies,
    budgetMode,
    // Legacy defaults
    viewMode: "comparativa" as ViewMode,
    periodType: "mensal",
    year: yearFrom,
    month: monthFrom,
    quarter: 1,
    semester: 1 as 1 | 2,
    startDate: toIsoDate(startOfMonth(yearFrom, monthFrom)),
    endDate: toIsoDate(endOfMonth(yearTo, monthTo)),
  } satisfies DashboardFilterState;
}

export function buildDateRange(filter: DashboardFilterState): DashboardRange {
  const { yearFrom, monthFrom, yearTo, monthTo, periodMode } = filter;
  const dateFrom = toIsoDate(startOfMonth(yearFrom, monthFrom));
  const dateTo = toIsoDate(endOfMonth(yearTo, monthTo));

  let label: string;
  if (periodMode === "mes_atual") {
    label = `${MONTH_NAMES[monthFrom - 1]}/${yearFrom}`;
  } else if (periodMode === "ano_atual") {
    label = `Jan a Dez/${yearFrom}`;
  } else {
    if (yearFrom === yearTo && monthFrom === monthTo) {
      label = `${MONTH_NAMES[monthFrom - 1]}/${yearFrom}`;
    } else {
      label = `${MONTH_NAMES[monthFrom - 1]}/${yearFrom} a ${MONTH_NAMES[monthTo - 1]}/${yearTo}`;
    }
  }

  return { dateFrom, dateTo, label };
}

export function buildVisibleBuckets(filter: DashboardFilterState) {
  const { yearFrom, monthFrom, yearTo, monthTo } = filter;

  const buckets: DashboardPeriodBucket[] = [];
  let year = yearFrom;
  let month = monthFrom;

  while (year < yearTo || (year === yearTo && month <= monthTo)) {
    const from = startOfMonth(year, month);
    const to = endOfMonth(year, month);
    buckets.push({
      key: `m-${year}-${month}`,
      label: `${MONTH_NAMES[month - 1]}/${String(year).slice(2)}`,
      dateFrom: toIsoDate(from),
      dateTo: toIsoDate(to),
    });
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }

  return buckets;
}

export function buildAccumulatedBucket(buckets: DashboardPeriodBucket[]) {
  // Guarda contra lista vazia (ex.: periodo customizado invertido onde
  // mes/ano inicial > final). Sem isso, `first.dateFrom` derefenciaria
  // undefined e derrubava a pagina inteira com um 500 (server exception).
  const first = buckets[0];
  const last = buckets[buckets.length - 1];
  return {
    key: "total",
    label: "Total",
    dateFrom: first?.dateFrom ?? "",
    dateTo: last?.dateTo ?? "",
  } satisfies DashboardPeriodBucket;
}

function evaluateFormula(formula: string, getByCode: (code: string) => number) {
  const normalized = formula.replace(/\s+/g, "");
  const parts = normalized.match(/[+-]?[^+-]+/g) ?? [];
  return parts.reduce((sum, token) => {
    if (!token) return sum;
    const operator = token[0] === "-" ? -1 : 1;
    const code = token[0] === "+" || token[0] === "-" ? token.slice(1) : token;
    const value = getByCode(code);
    return sum + operator * value;
  }, 0);
}

export function buildDashboardRows(
  accounts: DreAccountBase[],
  amountsByAccountId: Map<string, number>,
  options?: {
    // Codes cujo valor deve ser SUBTRAÍDO (sinal invertido) ao compor o total
    // do grupo-pai `is_summary`, em vez de somado. Existe para tratar contas de
    // RECEITA que vivem dentro de um grupo de DESPESA — caso real: "Receitas
    // Ressarciveis - Fundos" (5.8) dentro de "Custos com os Serviços Prestados"
    // (5) nas franquias Viva. A conta está cadastrada como `despesa` na
    // estrutura DRE (que não pode ser alterada), então o somatório do grupo a
    // trataria como custo e inflaria o total. Subtraindo-a aqui o totalizador
    // respeita o sinal correto, e como o valor é descontado apenas na soma do
    // PAI, a própria linha continua exibindo seu valor positivo no drilldown.
    // Inerte (default vazio) para todos os demais chamadores/segmentos. Ver
    // src/lib/dashboard/franquias-viva-custos.ts.
    negateChildCodesInSummary?: ReadonlySet<string>;
  },
) {
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const byCode = new Map(accounts.map((account) => [account.code, account]));
  const childrenByParent = new Map<string | null, DreAccountBase[]>();

  accounts.forEach((account) => {
    const siblings = childrenByParent.get(account.parent_id) ?? [];
    siblings.push(account);
    childrenByParent.set(account.parent_id, siblings);
  });

  childrenByParent.forEach((items) => {
    items.sort((a, b) => a.sort_order - b.sort_order || a.code.localeCompare(b.code));
  });

  const cacheById = new Map<string, number>();
  const calculateValueById = (accountId: string): number => {
    if (cacheById.has(accountId)) {
      return cacheById.get(accountId)!;
    }
    const account = byId.get(accountId);
    if (!account) return 0;

    let value = 0;
    const children = childrenByParent.get(account.id) ?? [];
    // `negateChildCodesInSummary` inverte o sinal de codes específicos quando
    // eles são agregados no total de um PAI — seja pela soma de filhos de um
    // grupo `is_summary`, seja por uma conta `calculado` que os referencia na
    // fórmula. Caso real: "Receitas Ressarciveis - Fundos" (5.8) é receita
    // dentro de "Custos com os Serviços Prestados" (5). No plano global o code 5
    // é `calculado` (`5.1+...+5.8+...-2.4`), então a inversão precisa valer
    // também no ramo da fórmula — senão a correção não tem efeito. O valor da
    // PRÓPRIA linha 5.8 (folha) não é afetado; só o sinal com que entra no total
    // do pai. Inerte (default) para os demais chamadores. Ver
    // src/lib/dashboard/franquias-viva-custos.ts.
    const negate = options?.negateChildCodesInSummary;
    if (account.type === "calculado" && account.formula) {
      value = evaluateFormula(account.formula, (code) => {
        const ref = byCode.get(code);
        const refValue = ref ? calculateValueById(ref.id) : 0;
        return negate?.has(code) ? -refValue : refValue;
      });
    } else if (account.is_summary) {
      // Soma filhos + qualquer valor mapeado diretamente nesta conta.
      // Sem o "+ direto", contas summary sem filhos (ex.: 9 Receitas Não
      // Operacionais, 10 Despesas Não Operacionais) sempre rendem 0 mesmo
      // quando há entries com category_mapping apontando direto para elas.
      const childrenSum = children.reduce((sum, child) => {
        const childValue = calculateValueById(child.id);
        return sum + (negate?.has(child.code) ? -childValue : childValue);
      }, 0);
      const directAmount = amountsByAccountId.get(account.id) ?? 0;
      value = childrenSum + directAmount;
    } else {
      value = amountsByAccountId.get(account.id) ?? 0;
    }

    cacheById.set(accountId, value);
    return value;
  };

  const netRevenueAccount = accounts.find((account) => account.code === "4");
  const netRevenueValue = netRevenueAccount ? calculateValueById(netRevenueAccount.id) : 0;

  const rows = accounts
    .map((account) => {
      const value = calculateValueById(account.id);
      const percentage =
        netRevenueValue !== 0 ? (value / netRevenueValue) * 100 : 0;
      return {
        ...account,
        value,
        percentageOverNetRevenue: percentage,
        hasChildren: (childrenByParent.get(account.id) ?? []).length > 0,
      } satisfies DashboardRow;
    })
    .sort((a, b) => {
      if (a.level !== b.level && a.parent_id === b.parent_id) {
        return a.sort_order - b.sort_order;
      }
      return a.code.localeCompare(b.code, undefined, { numeric: true });
    });

  return {
    rows,
    netRevenueCode: netRevenueAccount?.code ?? "4",
  };
}

// ============================================================================
// FONTE DE VERDADE: "Resultado do Exercício" e demais valores agregados do DRE
// ============================================================================
//
// As funções abaixo são o ponto ÚNICO de cálculo dos valores do DRE usados
// pelo Dashboard DRE e por qualquer outra tela que precise dos mesmos números
// (em especial a linha "Resultado do Exercício" no Fluxo de Caixa).
//
// Antes existia uma cópia paralela dessa lógica em cada página — toda vez
// que alguém ajustava um lado (ex.: para suportar planos DRE custom por
// empresa, com tradução raw_id → scoped_id pelo `code`), a outra página
// ficava para trás e os valores divergiam. Centralizar aqui elimina essa
// classe de bug: o Fluxo de Caixa REUSA literalmente o mesmo cálculo do
// Dashboard.
//
// Use sempre estes helpers para qualquer valor do DRE — não recrie o pipeline
// (carregar dre_accounts → escopar plano custom → traduzir id → buildDashboardRows)
// inline em uma nova tela.
export const DRE_RESULTADO_EXERCICIO_CODE = "11" as const;

export interface ScopedDreAccounts {
  // Lista completa do plano escopado (custom da empresa OU global), sem
  // filtro de "core codes" — útil quando a tela precisa ver contas auxiliares.
  scopedAccounts: DreAccountBase[];
  // Lista filtrada apenas para os codes principais do DRE (1..11). Esta é a
  // lista que entra no `buildDashboardRows` para o cálculo de Resultado do
  // Exercício e demais totalizadoras.
  coreAccounts: DreAccountBase[];
  // Mapeia o dre_account_id retornado pelos RPCs (sempre vinculado ao plano
  // GLOBAL, via category_mapping) para o id correspondente NO escopo exibido
  // (que pode ser o clone forkado da empresa). Mapeamento é feito por `code`,
  // estável entre planos. Retorna null quando o code não pertence ao escopo
  // ativo (ex.: linhas auxiliares fora dos codes 1..11 ou contas inativas).
  translateToScopedId: (rawId: string) => string | null;
}

/**
 * Colunas que `loadScopedDreAccounts` e `scopeDreAccounts` precisam ler de
 * `dre_accounts`. Exportado para que páginas que carregam o plano dentro de
 * um Promise.all próprio passem a mesma SELECT sem risco de drift.
 */
export const SCOPED_DRE_ACCOUNTS_SELECT =
  "id,code,name,parent_id,level,type,is_summary,formula,sort_order,active,company_id" as const;

export type RawDreAccount = DreAccountBase & { company_id: string | null };

/**
 * Carrega TODAS as linhas de uma query de `dre_accounts` paginando em blocos.
 *
 * POR QUÊ: o PostgREST do projeto tem `db-max-rows = 1000` (limite HARD do
 * servidor — `.limit()`/`.range()` com janela maior NÃO o ultrapassam). Como
 * `dre_accounts` soma o plano global + os planos custom de TODAS as empresas,
 * o total já passou de 1000 linhas. Uma query única `.eq("active",true)
 * .order("code")` era truncada silenciosamente nas primeiras 1000 linhas — e,
 * por ordenar `code` como STRING, os primeiros cortados eram exatamente "8",
 * "9" e "9.x" (vêm depois de "1".."7.x" na ordem lexicográfica). Isso sumia
 * com "Receitas Não Operacionais" (9) e "Lucro Operacional" (8) do dashboard
 * e zerava o "Resultado do Exercício" (fórmula `8+9-10`).
 *
 * A paginação por `range` DESLOCA a janela, então cada página respeita o cap
 * de 1000 mas no conjunto trazemos todas as linhas. NÃO altera nenhuma lógica
 * de cálculo: apenas devolve o conjunto completo que o código já esperava.
 *
 * `makeQuery(from, to)` deve montar a query JÁ com `.range(from, to)` aplicado.
 *
 * IMPORTANTE — a ordenação DEVE incluir uma chave ÚNICA (ex.: `.order("id")`, ou
 * `.order("code").order("id")`). Ordenar SÓ por `code` — que se repete entre
 * empresas (planos custom reusam os mesmos codes) — torna a paginação por range
 * INSTÁVEL: as linhas de mesmo `code` na fronteira de página são reordenadas de
 * forma inconsistente entre as chamadas, e algumas somem do conjunto (enquanto
 * outras duplicam). Bug real corrigido: a conta 7.2.13 da Terrazzo sumia do
 * relatório one-page (que carrega TODAS as empresas, ~2000 contas, cruzando a
 * fronteira), subtraindo ~R$ 21 mil das Despesas Operacionais e divergindo do
 * Dashboard DRE (que só carrega global + empresas do segmento, sem cruzar 1000).
 */
export async function fetchAllDreAccountRows<T>(
  makeQuery: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const PAGE_SIZE = 1000;
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await makeQuery(from, from + PAGE_SIZE - 1);
    if (error) {
      throw new Error(`Falha ao carregar dre_accounts: ${error.message}`);
    }
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

/**
 * Versão pura de `loadScopedDreAccounts`: recebe a linha crua de `dre_accounts`
 * (já buscada pelo chamador, possivelmente em paralelo com outras queries)
 * e produz o plano escopado + tradutor de ids.
 *
 * Regra de escopo:
 *  - UMA única empresa COM plano custom → usa só o plano dela.
 *  - UMA empresa sem custom (ou nenhuma) → plano global (company_id IS NULL).
 *  - MULTI-empresa (consolidado) → UNIÃO dos planos custom das empresas
 *    selecionadas ("empilha os planos"): para cada código, prefere a conta
 *    custom de uma empresa selecionada; o global só preenche códigos que
 *    NENHUMA selecionada possui. Antes o multi-empresa caía no plano global,
 *    o que DESCARTAVA códigos custom-only (ex.: Spot/Express codes 12-15 e as
 *    receitas 1.4-1.7) e aplicava a fórmula global onde o code colide com o
 *    custom (ex.: Salvaterra code 9 = IRPJ vs global = Receitas Não Op) — somas
 *    e Resultado saíam errados. A união casa por código (`translateToScopedId`),
 *    então cada empresa contribui para a conta de MESMO código e nada é
 *    descartado. `parent_id` é REMAPEADO por código para a hierarquia mesclada,
 *    senão os grupos `is_summary` (que somam filhos por parent_id) não fechariam.
 *    Ressalva: quando empresas reaproveitam o MESMO número de código para
 *    sub-contas diferentes (folhas), a linha mesclada herda o rótulo de uma e
 *    SOMA as duas — os totais ficam corretos; só o rótulo da folha fica de uma
 *    empresa. Dedup por código também evita duplicidade de linhas.
 *
 * Garante que o "Resultado do Exercício" seja idêntico no Dashboard DRE, no
 * Fluxo de Caixa e no Budget — single e multi-empresa.
 */
export function scopeDreAccounts(
  rawAccounts: RawDreAccount[],
  selectedCompanyIds: string[],
): ScopedDreAccounts {
  const codeByRawId = new Map<string, string>();
  rawAccounts.forEach((account) => {
    codeByRawId.set(account.id, account.code);
  });

  const toBase = (a: RawDreAccount): DreAccountBase => ({
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
  });

  let scopedAccounts: DreAccountBase[];

  if (selectedCompanyIds.length <= 1) {
    // Single (ou nenhuma): plano custom da empresa se existir, senão global.
    // Comportamento INALTERADO.
    const scopedCompanyId =
      selectedCompanyIds.length === 1 ? selectedCompanyIds[0] : null;
    const companyHasCustomPlan = scopedCompanyId
      ? rawAccounts.some((a) => a.company_id === scopedCompanyId)
      : false;
    scopedAccounts = rawAccounts
      .filter((a) =>
        companyHasCustomPlan ? a.company_id === scopedCompanyId : a.company_id === null,
      )
      .map(toBase);
  } else {
    // Multi-empresa: UNIÃO dos planos custom selecionados (1 conta por código),
    // preferindo custom (na ordem de seleção) sobre global; global preenche só
    // códigos que nenhuma selecionada tem.
    const pickByCode = new Map<string, RawDreAccount>();
    for (const cid of selectedCompanyIds) {
      for (const a of rawAccounts) {
        if (a.company_id === cid && !pickByCode.has(a.code)) pickByCode.set(a.code, a);
      }
    }
    for (const a of rawAccounts) {
      if (a.company_id === null && !pickByCode.has(a.code)) pickByCode.set(a.code, a);
    }
    // id da conta mesclada por código (alvo do remapeamento de parent_id).
    const mergedIdByCode = new Map<string, string>();
    pickByCode.forEach((a, code) => mergedIdByCode.set(code, a.id));
    scopedAccounts = Array.from(pickByCode.values()).map((a) => {
      const base = toBase(a);
      // Remapeia o pai para a conta mesclada de MESMO código do pai original —
      // garante hierarquia consistente no plano unificado.
      const parentCode = a.parent_id ? codeByRawId.get(a.parent_id) ?? null : null;
      base.parent_id = parentCode ? mergedIdByCode.get(parentCode) ?? null : null;
      return base;
    });
  }

  const scopedIdByCode = new Map<string, string>();
  scopedAccounts.forEach((account) => {
    scopedIdByCode.set(account.code, account.id);
  });
  const translateToScopedId = (rawId: string): string | null => {
    const code = codeByRawId.get(rawId);
    if (!code) return null;
    return scopedIdByCode.get(code) ?? null;
  };

  return {
    scopedAccounts,
    coreAccounts: filterCoreDreAccounts(scopedAccounts),
    translateToScopedId,
  };
}

/**
 * Conveniência: carrega `dre_accounts` e já escopa para a seleção atual.
 * Use quando não houver vantagem em paralelizar a query do plano com outras.
 */
export async function loadScopedDreAccounts(
  supabase: SupabaseClient,
  selectedCompanyIds: string[],
): Promise<ScopedDreAccounts> {
  // Pagina para não esbarrar no cap de 1000 linhas do PostgREST (ver
  // fetchAllDreAccountRows) — senão os codes "8"/"9"/"9.x" são truncados.
  const dreAccountsData = await fetchAllDreAccountRows<RawDreAccount>((from, to) =>
    supabase
      .from("dre_accounts")
      .select(SCOPED_DRE_ACCOUNTS_SELECT)
      .eq("active", true)
      .order("code")
      .order("id") // desempate único → paginação por range estável (ver fetchAllDreAccountRows)
      .range(from, to),
  );

  return scopeDreAccounts(dreAccountsData, selectedCompanyIds);
}

/**
 * Converte a resposta crua do RPC `dashboard_dre_aggregate` em um mapa
 * (scoped_id -> amount) somando todas as entradas que caem no mesmo scoped
 * id (necessário quando vários raw ids do plano global apontam para o
 * mesmo code no plano custom).
 */
function aggregateRawAmounts(
  rawData: Array<{ dre_account_id: string; amount: number | string | null }> | null | undefined,
  translateToScopedId: (rawId: string) => string | null,
): Map<string, number> {
  const amounts = new Map<string, number>();
  (rawData ?? []).forEach((item) => {
    const scopedId = translateToScopedId(item.dre_account_id);
    if (!scopedId) return;
    const current = amounts.get(scopedId) ?? 0;
    amounts.set(scopedId, current + Number(item.amount ?? 0));
  });
  return amounts;
}

/**
 * Calcula as linhas do DRE (com formulas e totalizadoras) para um período /
 * conjunto de empresas. Use SEMPRE esta função para obter valores do DRE;
 * é o ponto único de cálculo compartilhado por Dashboard DRE e Fluxo de
 * Caixa.
 */
export async function aggregateDreRows(params: {
  supabase: SupabaseClient;
  scope: ScopedDreAccounts;
  companyIds: string[];
  dateFrom: string;
  dateTo: string;
  // Ajustes gerenciais PONTUAIS por `code` (ex.: linha "12. Margens Ensino
  // Médio" da Viva Juiz de Fora). Somados ao mapa de amounts ANTES de
  // `buildDashboardRows`, de modo que linhas `calculado` que referenciem o
  // code (ex.: "13" = `11+12`) já incorporem o efeito. Opcional: chamadores
  // que não passam nada (Fluxo de Caixa etc.) ficam idênticos.
  extraAmountsByCode?: Map<string, number>;
  // Hook GENÉRICO e OPCIONAL para derivar/sobrescrever amounts a partir do
  // mapa já montado (Omie + planilha + extraAmountsByCode), ANTES de
  // `buildDashboardRows` — então linhas calculadas/totalizadoras já incorporam
  // o efeito. Usado pelos impostos calculados da Sirena
  // (src/lib/dashboard/sirena-taxes.ts), que dependem dos valores agregados de
  // "Receita de Estacionamento" + "Locação de Espaço" do próprio período.
  // Chamadores que não passam nada ficam idênticos (inerte por padrão).
  postProcessAmounts?: (
    scopedAccounts: DreAccountBase[],
    amountsByScopedId: Map<string, number>,
  ) => void;
  // Codes a subtrair no total do grupo-pai (ver buildDashboardRows). Usado pelo
  // segmento franquias-viva para "Receitas Ressarciveis - Fundos" dentro de
  // Custos. Inerte por padrão. Ver src/lib/dashboard/franquias-viva-custos.ts.
  negateChildCodesInSummary?: ReadonlySet<string>;
}): Promise<DashboardRow[]> {
  const { data, error } = await params.supabase.rpc("dashboard_dre_aggregate", {
    p_company_ids: params.companyIds,
    p_date_from: params.dateFrom,
    p_date_to: params.dateTo,
  });
  if (error) {
    throw new Error(`Falha ao carregar agregados DRE: ${error.message}`);
  }
  const amounts = aggregateRawAmounts(
    data as Array<{ dre_account_id: string; amount: number | string | null }> | null,
    params.scope.translateToScopedId,
  );
  if (params.extraAmountsByCode && params.extraAmountsByCode.size > 0) {
    const scopedIdByCode = new Map(
      params.scope.scopedAccounts.map((account) => [account.code, account.id]),
    );
    params.extraAmountsByCode.forEach((amount, code) => {
      const scopedId = scopedIdByCode.get(code);
      if (!scopedId) return;
      amounts.set(scopedId, (amounts.get(scopedId) ?? 0) + amount);
    });
  }
  if (params.postProcessAmounts) {
    params.postProcessAmounts(params.scope.scopedAccounts, amounts);
  }
  return buildDashboardRows(params.scope.coreAccounts, amounts, {
    negateChildCodesInSummary: params.negateChildCodesInSummary,
  }).rows;
}

/**
 * Busca os agregados DRE de TODOS os meses do intervalo em UMA chamada
 * (`dashboard_dre_aggregate_monthly`) e devolve, por mês (`"${year}-${month}"`,
 * month 1-based sem zero à esquerda), o mapa `scopedId -> amount` — os raw ids
 * do RPC já traduzidos para o escopo ativo via `scope.translateToScopedId`.
 *
 * Substitui o antigo fan-out de uma chamada de `dashboard_dre_aggregate` por
 * mês visível (+ acumulado): 13 round-trips concorrentes por load no "ano
 * atual" pressionavam o pooler de conexões. Com isto o Dashboard faz UMA
 * chamada e monta os buckets mensais e o acumulado a partir do resultado
 * (somar meses == intervalo inteiro, pois as fórmulas do DRE são lineares —
 * verificado: mesmos valores de `dashboard_dre_aggregate` no range completo).
 * O postProcess (impostos Sirena) e a negação de custos continuam aplicados
 * por bucket no chamador, exatamente como antes.
 */
export async function aggregateDreMonthlyScopedAmounts(params: {
  supabase: SupabaseClient;
  scope: ScopedDreAccounts;
  companyIds: string[];
  dateFrom: string;
  dateTo: string;
}): Promise<Map<string, Map<string, number>>> {
  const { data, error } = await params.supabase.rpc("dashboard_dre_aggregate_monthly", {
    p_company_ids: params.companyIds,
    p_date_from: params.dateFrom,
    p_date_to: params.dateTo,
  });
  if (error) {
    throw new Error(`Falha ao carregar agregados DRE mensais: ${error.message}`);
  }
  const byMonth = new Map<string, Map<string, number>>();
  (
    data as Array<{
      year: number;
      month: number;
      dre_account_id: string;
      amount: number | string | null;
    }> | null ?? []
  ).forEach((item) => {
    const scopedId = params.scope.translateToScopedId(item.dre_account_id);
    if (!scopedId) return;
    const key = `${item.year}-${item.month}`;
    let map = byMonth.get(key);
    if (!map) {
      map = new Map();
      byMonth.set(key, map);
    }
    map.set(scopedId, (map.get(scopedId) ?? 0) + Number(item.amount ?? 0));
  });
  return byMonth;
}

/**
 * Versão por empresa: roda `dashboard_dre_aggregate_by_company` UMA VEZ e
 * devolve um mapa companyId -> rows. Garante uma entrada (mesmo que zerada)
 * para cada companyId solicitado, de modo que o consumidor pode chamar
 * `findResultadoExercicio` sem precisar tratar empresas sem lançamentos.
 */
export async function aggregateDreRowsByCompany(params: {
  supabase: SupabaseClient;
  scope: ScopedDreAccounts;
  companyIds: string[];
  dateFrom: string;
  dateTo: string;
  // Codes a subtrair no total do grupo-pai (ver buildDashboardRows). Inerte por
  // padrão. Ver src/lib/dashboard/franquias-viva-custos.ts.
  negateChildCodesInSummary?: ReadonlySet<string>;
}): Promise<Map<string, DashboardRow[]>> {
  const { data, error } = await params.supabase.rpc("dashboard_dre_aggregate_by_company", {
    p_company_ids: params.companyIds,
    p_date_from: params.dateFrom,
    p_date_to: params.dateTo,
  });
  if (error) {
    throw new Error(`Falha ao carregar agregados DRE por empresa: ${error.message}`);
  }

  const amountsByCompanyId = new Map<string, Map<string, number>>();
  (
    data as Array<{
      company_id: string;
      dre_account_id: string;
      amount: number | string | null;
    }> | null ?? []
  ).forEach((item) => {
    const scopedId = params.scope.translateToScopedId(item.dre_account_id);
    if (!scopedId) return;
    let map = amountsByCompanyId.get(item.company_id);
    if (!map) {
      map = new Map();
      amountsByCompanyId.set(item.company_id, map);
    }
    const current = map.get(scopedId) ?? 0;
    map.set(scopedId, current + Number(item.amount ?? 0));
  });

  const result = new Map<string, DashboardRow[]>();
  params.companyIds.forEach((companyId) => {
    const amounts = amountsByCompanyId.get(companyId) ?? new Map<string, number>();
    result.set(
      companyId,
      buildDashboardRows(params.scope.coreAccounts, amounts, {
        negateChildCodesInSummary: params.negateChildCodesInSummary,
      }).rows,
    );
  });
  return result;
}

/**
 * Extrai o valor de "Resultado do Exercício" de uma lista de rows do DRE.
 * Use junto com `aggregateDreRows` ou `aggregateDreRowsByCompany`.
 *
 * Esta é a fonte de verdade para o número que aparece na linha "Resultado
 * do Exercício" tanto no Dashboard DRE quanto no Fluxo de Caixa.
 *
 * Por padrão usa o code "11" (DRE_RESULTADO_EXERCICIO_CODE), válido para o
 * plano global e para os planos custom alinhados a ele. O parâmetro `code`
 * permite sobrepor pontualmente o code de resultado para uma empresa com plano
 * custom que feche o exercício em outra linha (ex.: SGX usa o code "15" —
 * "Resultado 4 - Locação + Operacional + Projetos" — no Fluxo de Caixa).
 */
export function findResultadoExercicio(
  rows: DashboardRow[],
  code: string = DRE_RESULTADO_EXERCICIO_CODE,
): number {
  return rows.find((r) => r.code === code)?.value ?? 0;
}

/**
 * Resolve which companies the user is allowed to see.
 * - admin: all companies
 * - gestor_hero / gestor_unidade: only companies in user_company_access
 *   (falls back to profile.company_id for gestor_unidade if no access rows exist)
 */
export async function resolveAllowedCompanyIds(
  supabase: SupabaseClient,
  profile: UserProfile | null,
  allCompanyIds: string[],
): Promise<string[]> {
  if (!profile) return allCompanyIds;
  if (profile.role === "admin") return allCompanyIds;

  // Query the user_company_access table for explicit permissions
  const { data } = await supabase
    .from("user_company_access")
    .select("company_id")
    .eq("user_id", profile.id);

  const accessIds = (data ?? []).map((row) => row.company_id as string);

  if (accessIds.length > 0) {
    // Only keep companies that exist in the loaded list
    return allCompanyIds.filter((id) => accessIds.includes(id));
  }

  // Fallback for gestor_unidade with legacy company_id field
  if (profile.role === "gestor_unidade" && profile.company_id) {
    return allCompanyIds.filter((id) => id === profile.company_id);
  }

  // No explicit access configured — show nothing for non-admins
  return [];
}
