// ============================================================================
// CAMADA DE AJUSTE GERENCIAL DO DRE (separada da Omie e do mapeamento)
// ============================================================================
//
// Esta camada injeta valores PONTUAIS e EXCLUSIVAMENTE GERENCIAIS em linhas
// próprias do DRE (linhas que NÃO recebem nenhum mapeamento Omie/DRE), para
// fins de análise. Hoje atende apenas a Viva Juiz de Fora (linha "12. Margens
// Ensino Médio"), mas o formato é genérico (por empresa + code) para futuras
// inserções do mesmo tipo.
//
// GARANTIAS DE ISOLAMENTO (por construção):
//   • NÃO toca em nada vindo da API da Omie nem no regime de caixa: os valores
//     vivem só aqui, no código — não são gravados em financial_entries nem em
//     dre_accounts, e nenhuma sincronização da Omie os altera ou apaga.
//   • NÃO altera a tela de mapeamento da DRE nem as linhas já mapeadas: a
//     linha 12 não tem category_mapping; este ajuste é a ÚNICA origem do seu
//     valor. As linhas oficiais (codes 1..11) não referenciam o code 12, então
//     continuam idênticas.
//   • NÃO afeta outras empresas: `getManagerialAmountsByCode` só devolve algo
//     quando UMA única empresa está selecionada E essa empresa tem config aqui
//     (mesma regra de escopo do plano custom em `scopeDreAccounts`). No
//     consolidado multi-empresa o plano cai no global, que nem tem o code 12.
//   • Persistente e imune a sync: por estar no código-fonte, o ajuste nunca se
//     perde ao recarregar o dashboard nem em novas sincronizações.
//
// COMO É CONSUMIDO:
//   • Dashboard DRE (`dashboard/page.tsx`) soma estes valores no mapa de
//     amounts ANTES de `buildDashboardRows`, por bucket (mês) e no acumulado.
//     Como a linha 12 é `misto`/sem fórmula, ela lê o valor direto do mapa; e
//     a linha "13. Resultado do exercício ajustado" (`calculado`, fórmula
//     `11+12`) passa a somar o efeito do 12 automaticamente — sem nenhuma
//     mudança na engine.
//   • Drilldown (`api/dashboard/drilldown`) usa `getManagerialDrilldownRows`
//     para exibir os lançamentos Omie que ORIGINARAM a realocação, sem alterar
//     data, valor, cliente/fornecedor ou demais dados originais.

const VIVA_JUIZ_DE_FORA_COMPANY_ID = "fc0e3004-d019-4be7-8150-041aa5620d03";

export interface ManagerialDrilldownItem {
  payment_date: string; // ISO YYYY-MM-DD (data ORIGINAL do lançamento Omie)
  description: string;
  supplier_customer: string;
  document_number: string;
  value: number; // valor ORIGINAL do lançamento (não alterado)
}

interface ManagerialEntry {
  year: number;
  month: number; // 1..12
  // Valor GERENCIAL exibido na célula daquele mês na linha do DRE.
  amount: number;
  // Lançamentos Omie que originaram a realocação deste mês (para o drilldown).
  items: ManagerialDrilldownItem[];
}

interface ManagerialAccountAdjustment {
  code: string; // code da linha do DRE no plano custom da empresa
  entries: ManagerialEntry[];
}

// Lançamentos Omie de "Margem de Contribuição de Eventos" (Ensino Médio) que,
// no regime de caixa, caem ao longo de 2026. Gerencialmente a RECEITA é
// concentrada em Dez/2025 e as realocações (saídas) distribuídas nos meses de
// 2026. Os lançamentos abaixo são reproduzidos com data e valor ORIGINAIS.
const VJF_MARGENS_ENSINO_MEDIO_ITEMS = {
  jan2026: [
    {
      payment_date: "2026-01-22",
      description: "FORMATURA CMJF 2025 (PAC)#8569#JDF",
      supplier_customer: "FORMATURA CMJF 2025 (PAC)#8569#JDF",
      document_number: "8569",
      value: 5635.19,
    },
  ],
  fev2026: [
    {
      payment_date: "2026-02-12",
      description: "ALFREDO-PORTUGAL-FORMATURA APOGEU 2025 (PAC)#8954#JDF",
      supplier_customer: "ALFREDO-PORTUGAL-FORMATURA APOGEU 2025 (PAC)#8954#JDF",
      document_number: "8954",
      value: 12500.0,
    },
    {
      payment_date: "2026-02-10",
      description: "FORMATURA ACADEMIA 2025 (ASS) (TRANSF)#9027#JDF",
      supplier_customer: "FORMATURA ACADEMIA 2025 (ASS) (TRANSF)#9027#JDF",
      document_number: "9027",
      value: 25887.38,
    },
  ],
  mar2026: [
    {
      payment_date: "2026-03-06",
      description: "FORMATURA SANTA CATARINA 2025 (PAC)#8398#JDF",
      supplier_customer: "FORMATURA SANTA CATARINA 2025 (PAC)#8398#JDF",
      document_number: "8398",
      value: 10000.0,
    },
    {
      payment_date: "2026-03-12",
      description: "ALFREDO-PORTUGAL-FORMATURA APOGEU 2025 (PAC)#8954#JDF",
      supplier_customer: "ALFREDO-PORTUGAL-FORMATURA APOGEU 2025 (PAC)#8954#JDF",
      document_number: "8954",
      value: 3344.58,
    },
    {
      payment_date: "2026-03-12",
      description: "FORMATURA SANTA CATARINA 2025 (PAC)#8398#JDF",
      supplier_customer: "FORMATURA SANTA CATARINA 2025 (PAC)#8398#JDF",
      document_number: "8398",
      value: 11655.42,
    },
    {
      payment_date: "2026-03-17",
      description: "ALFREDO-PORTUGAL-FORMATURA APOGEU 2025 (PAC)#8954#JDF",
      supplier_customer: "ALFREDO-PORTUGAL-FORMATURA APOGEU 2025 (PAC)#8954#JDF",
      document_number: "8954",
      value: 30000.0,
    },
  ],
  abr2026: [
    {
      payment_date: "2026-04-29",
      description: "ALFREDO-PORTUGAL-FORMATURA APOGEU 2025 (PAC)#8954#JDF",
      supplier_customer: "ALFREDO-PORTUGAL-FORMATURA APOGEU 2025 (PAC)#8954#JDF",
      document_number: "8954",
      value: 26141.67,
    },
  ],
} satisfies Record<string, ManagerialDrilldownItem[]>;

// Todos os lançamentos consolidados (origem da receita concentrada em Dez/2025).
const VJF_MARGENS_ENSINO_MEDIO_ALL_ITEMS: ManagerialDrilldownItem[] = [
  ...VJF_MARGENS_ENSINO_MEDIO_ITEMS.jan2026,
  ...VJF_MARGENS_ENSINO_MEDIO_ITEMS.fev2026,
  ...VJF_MARGENS_ENSINO_MEDIO_ITEMS.mar2026,
  ...VJF_MARGENS_ENSINO_MEDIO_ITEMS.abr2026,
];

const MANAGERIAL_ADJUSTMENTS: Record<string, ManagerialAccountAdjustment[]> = {
  [VIVA_JUIZ_DE_FORA_COMPANY_ID]: [
    {
      code: "12", // Margens Ensino Médio
      entries: [
        // Receita concentrada gerencialmente em Dez/2025 (soma de todos os
        // lançamentos originais: 125.164,24).
        {
          year: 2025,
          month: 12,
          amount: 125164,
          items: VJF_MARGENS_ENSINO_MEDIO_ALL_ITEMS,
        },
        // Realocações (saídas) distribuídas em 2026, por mês de pagamento.
        { year: 2026, month: 1, amount: -5635, items: VJF_MARGENS_ENSINO_MEDIO_ITEMS.jan2026 },
        { year: 2026, month: 2, amount: -38387, items: VJF_MARGENS_ENSINO_MEDIO_ITEMS.fev2026 },
        { year: 2026, month: 3, amount: -55000, items: VJF_MARGENS_ENSINO_MEDIO_ITEMS.mar2026 },
        { year: 2026, month: 4, amount: -26142, items: VJF_MARGENS_ENSINO_MEDIO_ITEMS.abr2026 },
      ],
    },
  ],
};

/** Empresa selecionada de forma única que possui ajuste gerencial, ou null. */
function resolveAdjustedCompanyId(companyIds: string[]): string | null {
  if (companyIds.length !== 1) return null;
  const companyId = companyIds[0];
  return MANAGERIAL_ADJUSTMENTS[companyId] ? companyId : null;
}

/** A entrada do mês (year-month) cai dentro de [dateFrom, dateTo]? */
function entryWithinRange(entry: ManagerialEntry, dateFrom: string, dateTo: string): boolean {
  // Primeiro dia do mês da entrada. Os buckets do dashboard usam dateFrom no
  // dia 01 e dateTo no último dia do mês final, então testar o dia 01 já casa
  // tanto buckets de mês único quanto o bucket acumulado.
  const monthStart = `${entry.year}-${String(entry.month).padStart(2, "0")}-01`;
  return monthStart >= dateFrom && monthStart <= dateTo;
}

/**
 * Soma dos ajustes gerenciais por `code` do DRE no período [dateFrom, dateTo].
 *
 * Devolve um mapa vazio (sem efeito) a menos que EXATAMENTE uma empresa esteja
 * selecionada e ela tenha config — mesma regra de escopo do plano custom. O
 * dashboard soma este mapa ao `amounts` antes de `buildDashboardRows`.
 */
export function getManagerialAmountsByCode(
  companyIds: string[],
  dateFrom: string,
  dateTo: string,
): Map<string, number> {
  const result = new Map<string, number>();
  const companyId = resolveAdjustedCompanyId(companyIds);
  if (!companyId) return result;

  for (const adjustment of MANAGERIAL_ADJUSTMENTS[companyId]) {
    let sum = 0;
    let touched = false;
    for (const entry of adjustment.entries) {
      if (entryWithinRange(entry, dateFrom, dateTo)) {
        sum += entry.amount;
        touched = true;
      }
    }
    if (touched) result.set(adjustment.code, sum);
  }
  return result;
}

export interface ManagerialDrilldownResult {
  rows: Array<ManagerialDrilldownItem & { id: string; company_name: string }>;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  totalValue: number;
  aggregateTotal: number;
}

/**
 * Drilldown gerencial: lista os lançamentos Omie que ORIGINARAM a realocação
 * de uma linha gerencial no período pedido. Retorna null quando a conta/empresa
 * não tem ajuste gerencial (aí o chamador segue com o drilldown normal via RPC).
 *
 * `aggregateTotal` é o próprio valor gerencial do período, de modo que o
 * dashboard NÃO dispare o alerta de "valores divergentes" (o total da célula
 * coincide com o agregado). `totalValue` reflete a soma dos valores ORIGINAIS
 * dos lançamentos exibidos (informativo).
 */
export function getManagerialDrilldownRows(params: {
  companyIds: string[];
  code: string | null;
  companyName: string;
  dateFrom: string;
  dateTo: string;
  search: string;
  page: number;
  pageSize: number;
}): ManagerialDrilldownResult | null {
  const companyId = resolveAdjustedCompanyId(params.companyIds);
  if (!companyId || !params.code) return null;

  const adjustment = MANAGERIAL_ADJUSTMENTS[companyId].find((a) => a.code === params.code);
  if (!adjustment) return null;

  const entriesInRange = adjustment.entries.filter((entry) =>
    entryWithinRange(entry, params.dateFrom, params.dateTo),
  );
  const aggregateTotal = entriesInRange.reduce((sum, entry) => sum + entry.amount, 0);

  // Lançamentos de origem; deduplica por (data+documento+valor) porque o
  // mesmo lançamento pode constar tanto no bucket acumulado quanto no mês.
  const seen = new Set<string>();
  let allItems: ManagerialDrilldownItem[] = [];
  for (const entry of entriesInRange) {
    for (const item of entry.items) {
      const key = `${item.payment_date}|${item.document_number}|${item.value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      allItems.push(item);
    }
  }

  const search = params.search.trim().toLowerCase();
  if (search) {
    allItems = allItems.filter((item) =>
      [item.description, item.supplier_customer, item.document_number]
        .some((field) => field.toLowerCase().includes(search)),
    );
  }
  allItems.sort((a, b) => a.payment_date.localeCompare(b.payment_date));

  const total = allItems.length;
  const pageSize = params.pageSize;
  const page = params.page;
  const start = (page - 1) * pageSize;
  const pageItems = allItems.slice(start, start + pageSize);

  return {
    rows: pageItems.map((item, index) => ({
      ...item,
      id: `managerial-${params.code}-${start + index}`,
      company_name: params.companyName,
    })),
    page,
    pageSize,
    total,
    totalPages: total > 0 ? Math.ceil(total / pageSize) : 0,
    totalValue: pageItems.reduce((sum, item) => sum + item.value, 0),
    aggregateTotal,
  };
}
