// ============================================================================
// NÚCLEO "CUSTÓDIA DE ARTISTAS" DA CASE SHOWS (análise independente por empresa)
// ============================================================================
//
// A Case Shows tem, no SEU plano custom de Fluxo de Caixa, um grupo de nível 1
// "6. Custódia de Artistas" com 5 sublinhas que formam um pequeno balanço de
// custódia, calculado mês a mês:
//
//   6.1 Saldo Anterior              = 6.5 Saldo do MÊS ANTERIOR
//   6.2 Entradas                    = mapeamento Omie (INALTERADO)
//   6.3 Saídas                      = mapeamento Omie (INALTERADO)
//   6.4 Comissões Comercial-Externa = mapeamento Omie (INALTERADO)
//   6.5 Saldo                       = 6.1 + 6.2 - 6.3 - 6.4
//
// EFICIÊNCIA (sem recálculo em cascata no front, sem recursão mês-a-mês):
//   O saldo é um saldo corrido. Assumindo saldo anterior = 0 no início da
//   história, desenrolando a recorrência:
//       Saldo[m] = Σ_{k <= m} (Entradas[k] - Saídas[k] - Comissões[k])
//   ou seja, é LINEAR no movimento líquido — exatamente como o "Caixa Final"
//   já é tratado em fluxo-de-caixa/page.tsx. Por isso o "Saldo Anterior" do
//   primeiro mês exibido é semeado com UMA agregação sobre todo o histórico
//   anterior (computeCustodyNetFromAmounts) e, no loop de buckets, encadeado
//   em memória (carrega o saldo do mês anterior). Custo extra: 1 RPC.
//
// ISOLAMENTO (requisito do produto):
//   • Só roda quando a Case Shows é a ÚNICA empresa selecionada (resolvido por
//     NOME, mesmo padrão de Sirena/SGX) — em consolidado/comparativo o escopo
//     cai no plano global, que NÃO tem o grupo 6, então a regra é inerte.
//   • Segunda trava: resolveCustodyAccounts() devolve null se o grupo "6
//     Custódia" ou qualquer uma das 5 sublinhas não existir no plano escopado.
//   • NÃO altera mapeamento, Omie, planilha, fórmulas globais, nem o cálculo
//     de outras empresas. O "Caixa Gerado/Consumido" (90.2 = "1+2+3+4+5") NÃO
//     referencia o code 6, então a custódia não contamina o caixa geral.

import type { CashFlowAccountBase } from "@/lib/dashboard/cash-flow";

export const CASE_SHOWS_COMPANY_NAME = "Case Shows";

// Marca de origem nas display rows derivadas (6.1/6.5) — desabilita o drilldown
// (elas não têm lançamentos Omie próprios) via o `isDrillable` do CashFlowView.
export const CASE_SHOWS_CUSTODY_SOURCE = "case_shows_custody";

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface CustodyAccountIds {
  /** 6 — grupo "Custódia de Artistas" (totalizadora). */
  groupId: string;
  /** 6.1 — Saldo Anterior (derivada: saldo do mês anterior). */
  saldoAnteriorId: string;
  /** 6.2 — Entradas (mapeamento Omie). */
  entradasId: string;
  /** 6.3 — Saídas (mapeamento Omie). */
  saidasId: string;
  /** 6.4 — Comissões Comercial - Externa (mapeamento Omie). */
  comissoesId: string;
  /** 6.5 — Saldo (derivada: 6.1 + 6.2 - 6.3 - 6.4). */
  saldoId: string;
}

/**
 * Devolve o id da Case Shows SOMENTE quando ela é a única empresa selecionada.
 * Em qualquer outra seleção (consolidado, comparativo, outra empresa) devolve
 * null — garantindo que a regra nunca afete outras empresas.
 */
export function resolveCaseShowsCompanyId(
  selectedCompanyIds: string[],
  companies: Array<{ id: string; name: string }>,
): string | null {
  if (selectedCompanyIds.length !== 1) return null;
  const id = selectedCompanyIds[0];
  const company = companies.find((c) => c.id === id);
  if (!company) return null;
  return normalizeName(company.name) === normalizeName(CASE_SHOWS_COMPANY_NAME)
    ? id
    : null;
}

/**
 * Resolve os ids das contas do núcleo Custódia por code, dentro do plano já
 * escopado. Devolve null (no-op seguro) se o grupo ou qualquer sublinha não
 * existir, ou se o code "6" não for o núcleo de Custódia — assim a regra jamais
 * dispara para um plano que por acaso tenha um code "6" com outro significado.
 */
export function resolveCustodyAccounts(
  accounts: CashFlowAccountBase[],
): CustodyAccountIds | null {
  const byCode = new Map(accounts.map((a) => [a.code, a]));
  const group = byCode.get("6");
  const saldoAnterior = byCode.get("6.1");
  const entradas = byCode.get("6.2");
  const saidas = byCode.get("6.3");
  const comissoes = byCode.get("6.4");
  const saldo = byCode.get("6.5");
  if (!group || !saldoAnterior || !entradas || !saidas || !comissoes || !saldo) {
    return null;
  }
  if (!normalizeName(group.name).includes("custodia")) return null;
  return {
    groupId: group.id,
    saldoAnteriorId: saldoAnterior.id,
    entradasId: entradas.id,
    saidasId: saidas.id,
    comissoesId: comissoes.id,
    saldoId: saldo.id,
  };
}

/**
 * Movimento líquido do mês a partir de valores JÁ calculados por linha
 * (byRowId do bucket): Entradas - Saídas - Comissões. As três são folhas
 * mapeadas, então byRowId traz a magnitude agregada de cada uma.
 */
export function custodyNetFromRowValues(
  byRowId: Record<string, number>,
  custody: CustodyAccountIds,
): number {
  const entradas = byRowId[custody.entradasId] ?? 0;
  const saidas = byRowId[custody.saidasId] ?? 0;
  const comissoes = byRowId[custody.comissoesId] ?? 0;
  return entradas - saidas - comissoes;
}

/**
 * Movimento líquido do mês a partir do mapa de amounts agregados (usado para
 * semear o Saldo Anterior do primeiro mês exibido): Entradas - Saídas -
 * Comissões. 6.2/6.3/6.4 são folhas non-summary, então o amount direto é o
 * valor da linha.
 */
export function custodyNetFromAmounts(
  amounts: Map<string, number>,
  custody: CustodyAccountIds,
): number {
  const entradas = amounts.get(custody.entradasId) ?? 0;
  const saidas = amounts.get(custody.saidasId) ?? 0;
  const comissoes = amounts.get(custody.comissoesId) ?? 0;
  return entradas - saidas - comissoes;
}

// ============================================================================
// SEÇÃO "CUSTÓDIA DE ARTISTAS - ANÁLISE COMPETÊNCIA" (EXCLUSIVA Case Shows)
// ============================================================================
//
// Análise gerencial COMPLEMENTAR e INDEPENDENTE, renderada abaixo da seção
// ACUMULADOS. Mesma lógica de saldo corrido da Custódia, porém alocando os
// lançamentos pela DATA DE REGISTRO da Omie (competência/contrato) — não pela
// data de pagamento. As 3 linhas de movimento reaproveitam o MESMO de/para de
// categorias (por código) que alimenta 6.2/6.3/6.4, via a RPC
// cash_flow_aggregate_by_registration. Não toca nenhuma linha/cálculo oficial.
//
//   Saldo anterior  = Saldo final do mês anterior (dentro desta seção)
//   Entradas        = lançamentos mapeados em 6.2, por mês da data de registro
//   Saídas          = lançamentos mapeados em 6.3, por mês da data de registro
//   Comissão        = lançamentos mapeados em 6.4 (externa + rider), idem
//   Saldo final     = Saldo anterior + Entradas - Saídas - Comissão
//
// Piso: só acumula a partir de Jan/2026 (lançamentos anteriores não entram).

/** Só acumula dados de competência a partir deste ano (regra do produto). */
export const COMPETENCIA_FLOOR_YEAR = 2026;

export const COMPETENCIA_SECTION_TITLE = "Custódia de Artistas - Análise Competência";
export const COMPETENCIA_SECTION_NOTE =
  "Esta seção apresenta uma análise da Custódia de Artistas conforme a data de registro/contrato dos lançamentos, sem impactar o fluxo de caixa oficial.";

export type CompetenciaLineKey =
  | "saldo_anterior"
  | "entradas"
  | "saidas"
  | "comissoes"
  | "saldo_final";

export interface CompetenciaLine {
  key: CompetenciaLineKey;
  label: string;
  valuesByBucket: Record<string, number>;
  accumulatedValue: number;
  /** Linhas de saldo (anterior/final) recebem leve destaque visual. */
  emphasis: boolean;
  /** Linhas de movimento (entradas/saídas/comissão) aceitam drilldown; as de
   *  saldo são derivadas (saldo corrido) e não têm lançamento próprio. */
  drillable: boolean;
  /** Códigos de categoria Omie que compõem a linha — usados pelo drilldown por
   *  data de registro. Vazio nas linhas de saldo. */
  omieCategoryCodes: string[];
}

/** Códigos de categoria Omie por linha de movimento, para o drilldown. */
export interface CompetenciaCategoryCodes {
  entradas: string[];
  saidas: string[];
  comissoes: string[];
}

export interface CompetenciaSection {
  show: boolean;
  title: string;
  note: string;
  lines: CompetenciaLine[];
}

export const EMPTY_COMPETENCIA_SECTION: CompetenciaSection = {
  show: false,
  title: "",
  note: "",
  lines: [],
};

/** Linha bruta devolvida pela RPC cash_flow_aggregate_by_registration. */
export interface CompetenciaRegistrationRow {
  period_year: number;
  period_month: number;
  cash_flow_account_id: string;
  amount: number;
}

/** Bucket mensal exibido (ano/mês + chave usada nas colunas da tabela). */
export interface CompetenciaBucket {
  key: string;
  year: number;
  month: number;
}

/**
 * Monta a seção a partir das linhas da RPC (por ano/mês/conta) e dos buckets
 * exibidos. Caminha cronologicamente desde Jan/COMPETENCIA_FLOOR_YEAR até o
 * último mês COM dados (mês corrente), encadeando o saldo corrido em memória
 * (sem cascata no front). Buckets anteriores ao piso ficam zerados. Buckets
 * FUTUROS (posteriores ao mês corrente) também ficam zerados — não repetem o
 * saldo do último mês, igual ao "Saldo Inicial de Caixa" oficial.
 */
export function buildCompetenciaSection(params: {
  custody: CustodyAccountIds;
  rows: CompetenciaRegistrationRow[];
  visibleBuckets: CompetenciaBucket[];
  currentYear: number;
  currentMonth: number;
  /** Códigos de categoria por linha de movimento, para habilitar o drilldown. */
  categoryCodes?: CompetenciaCategoryCodes;
}): CompetenciaSection {
  const { custody, rows, visibleBuckets, currentYear, currentMonth, categoryCodes } = params;
  if (visibleBuckets.length === 0) return EMPTY_COMPETENCIA_SECTION;

  // Indexa os movimentos por "ano-mês" e por linha (entradas/saídas/comissão).
  const byMonth = new Map<string, { ent: number; sai: number; com: number }>();
  for (const row of rows) {
    const key = `${row.period_year}-${row.period_month}`;
    const slot = byMonth.get(key) ?? { ent: 0, sai: 0, com: 0 };
    const amount = Number(row.amount ?? 0);
    if (row.cash_flow_account_id === custody.entradasId) slot.ent += amount;
    else if (row.cash_flow_account_id === custody.saidasId) slot.sai += amount;
    else if (row.cash_flow_account_id === custody.comissoesId) slot.com += amount;
    byMonth.set(key, slot);
  }

  const bucketByMonth = new Map<string, CompetenciaBucket>();
  visibleBuckets.forEach((b) => bucketByMonth.set(`${b.year}-${b.month}`, b));
  const lastBucket = visibleBuckets[visibleBuckets.length - 1];

  // Para de acumular no mês corrente: o saldo corrido não avança para meses
  // futuros (que ficariam repetindo o último saldo). Buckets exibidos além do
  // mês corrente simplesmente não são preenchidos → renderizam 0.
  const lastKey = lastBucket.year * 100 + lastBucket.month;
  const currentKey = currentYear * 100 + currentMonth;
  const endKey = Math.min(lastKey, currentKey);
  const endYear = Math.floor(endKey / 100);
  const endMonth = endKey % 100;

  const saldoAnteriorByBucket: Record<string, number> = {};
  const entradasByBucket: Record<string, number> = {};
  const saidasByBucket: Record<string, number> = {};
  const comissoesByBucket: Record<string, number> = {};
  const saldoFinalByBucket: Record<string, number> = {};

  let running = 0;
  let firstVisibleSaldoAnterior = 0;
  let lastVisibleSaldoFinal = 0;
  let sawVisible = false;
  let totalEntradas = 0;
  let totalSaidas = 0;
  let totalComissoes = 0;

  // Caminha mês a mês a partir do piso até o mês corrente (ou o último bucket,
  // o que vier antes), mesmo nos meses sem dados (carrega o saldo). Anterior ao
  // piso → nada acumula. Não passa do mês corrente → futuro fica zerado.
  let y = COMPETENCIA_FLOOR_YEAR;
  let m = 1;
  while (y < endYear || (y === endYear && m <= endMonth)) {
    const monthKey = `${y}-${m}`;
    const slot = byMonth.get(monthKey) ?? { ent: 0, sai: 0, com: 0 };
    const saldoAnterior = running;
    const saldoFinal = saldoAnterior + slot.ent - slot.sai - slot.com;

    const bucket = bucketByMonth.get(monthKey);
    if (bucket) {
      saldoAnteriorByBucket[bucket.key] = saldoAnterior;
      entradasByBucket[bucket.key] = slot.ent;
      saidasByBucket[bucket.key] = slot.sai;
      comissoesByBucket[bucket.key] = slot.com;
      saldoFinalByBucket[bucket.key] = saldoFinal;
      if (!sawVisible) {
        firstVisibleSaldoAnterior = saldoAnterior;
        sawVisible = true;
      }
      lastVisibleSaldoFinal = saldoFinal;
      totalEntradas += slot.ent;
      totalSaidas += slot.sai;
      totalComissoes += slot.com;
    }

    running = saldoFinal;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }

  const entradasCodes = categoryCodes?.entradas ?? [];
  const saidasCodes = categoryCodes?.saidas ?? [];
  const comissoesCodes = categoryCodes?.comissoes ?? [];

  const lines: CompetenciaLine[] = [
    {
      key: "saldo_anterior",
      label: "Saldo anterior",
      valuesByBucket: saldoAnteriorByBucket,
      accumulatedValue: firstVisibleSaldoAnterior,
      emphasis: true,
      drillable: false,
      omieCategoryCodes: [],
    },
    {
      key: "entradas",
      label: "Entradas",
      valuesByBucket: entradasByBucket,
      accumulatedValue: totalEntradas,
      emphasis: false,
      drillable: entradasCodes.length > 0,
      omieCategoryCodes: entradasCodes,
    },
    {
      key: "saidas",
      label: "Saídas",
      valuesByBucket: saidasByBucket,
      accumulatedValue: totalSaidas,
      emphasis: false,
      drillable: saidasCodes.length > 0,
      omieCategoryCodes: saidasCodes,
    },
    {
      key: "comissoes",
      label: "Comissão comercial - externa",
      valuesByBucket: comissoesByBucket,
      accumulatedValue: totalComissoes,
      emphasis: false,
      drillable: comissoesCodes.length > 0,
      omieCategoryCodes: comissoesCodes,
    },
    {
      key: "saldo_final",
      label: "Saldo final",
      valuesByBucket: saldoFinalByBucket,
      accumulatedValue: lastVisibleSaldoFinal,
      emphasis: true,
      drillable: false,
      omieCategoryCodes: [],
    },
  ];

  return {
    show: true,
    title: COMPETENCIA_SECTION_TITLE,
    note: COMPETENCIA_SECTION_NOTE,
    lines,
  };
}
