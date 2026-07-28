import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================================
// Leitura de DRILL-DOWN em blocos MENSAIS.
// ============================================================================
// As RPCs de drill-down (`dashboard_dre_drilldown` e `cash_flow_drilldown`)
// resolvem o mapeamento lançamento a lançamento, então o custo cresce com a
// LARGURA do intervalo. Medido nesta base: 6 meses ~200ms com cache quente, mas
// um intervalo de 5 anos ESTOUROU o statement_timeout do Postgres (8s) — e uma
// chamada de 6 meses com cache frio também estourou. As TELAS não sofrem com
// isso porque consultam uma célula (um mês) de cada vez; código de RELATÓRIO,
// que recebe o período inteiro escolhido pelo usuário, sofre.
//
// Por isso todo consumo de drill-down em relatório passa por aqui: o período é
// quebrado em MESES, cada mês é lido (e paginado) separadamente, com uma
// retentativa. Falha definitiva devolve `null` — o chamador PRECISA distinguir
// "sem lançamento" de "não consegui ler", para nunca exibir um total parcial
// como se fosse o total do período.
// ============================================================================

/** Página do drill-down. O cap do PostgREST é 1000 — pagina até esgotar. */
const PAGE_SIZE = 1000;
const MAX_PAGES = 20;
/** Meses lidos em paralelo por lote. */
const CHUNK_CONCURRENCY = 6;
/** Teto de meses (10 anos) — evita varredura absurda por período inválido. */
const MAX_CHUNKS = 120;

export interface DrilldownRow {
  supplier_customer: string | null;
  value: number | string | null;
  total_count: number | string | null;
}

/** RPC de drill-down + o nome do parâmetro que recebe o id da conta. */
export type DrilldownSource =
  | { rpc: "dashboard_dre_drilldown"; accountParam: "p_dre_account_id" }
  | { rpc: "cash_flow_drilldown"; accountParam: "p_cash_flow_account_id" };

export const DRE_DRILLDOWN: DrilldownSource = {
  rpc: "dashboard_dre_drilldown",
  accountParam: "p_dre_account_id",
};
export const CASH_FLOW_DRILLDOWN: DrilldownSource = {
  rpc: "cash_flow_drilldown",
  accountParam: "p_cash_flow_account_id",
};

/** Último dia do mês (1-based) em "YYYY-MM-DD". */
function lastDayOfMonth(year: number, month: number): string {
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Quebra [dateFrom..dateTo] em intervalos MENSAIS, recortados nas pontas. */
export function monthChunks(dateFrom: string, dateTo: string): Array<[string, string]> {
  const chunks: Array<[string, string]> = [];
  let year = Number(dateFrom.slice(0, 4));
  let month = Number(dateFrom.slice(5, 7));
  const endYear = Number(dateTo.slice(0, 4));
  const endMonth = Number(dateTo.slice(5, 7));
  if (!year || !month || !endYear || !endMonth) return [[dateFrom, dateTo]];

  while (
    (year < endYear || (year === endYear && month <= endMonth)) &&
    chunks.length < MAX_CHUNKS
  ) {
    const first = `${year}-${String(month).padStart(2, "0")}-01`;
    const last = lastDayOfMonth(year, month);
    chunks.push([first < dateFrom ? dateFrom : first, last > dateTo ? dateTo : last]);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return chunks;
}

/** Lê UM mês, paginando até esgotar o `total_count`. null = a RPC falhou. */
async function fetchChunkRows(
  supabase: SupabaseClient,
  source: DrilldownSource,
  accountId: string,
  companyId: string,
  dateFrom: string,
  dateTo: string,
  logLabel: string,
): Promise<DrilldownRow[] | null> {
  const rows: DrilldownRow[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data, error } = await supabase.rpc(source.rpc, {
      [source.accountParam]: accountId,
      p_company_ids: [companyId],
      p_date_from: dateFrom,
      p_date_to: dateTo,
      p_search: "",
      p_limit: PAGE_SIZE,
      p_offset: page * PAGE_SIZE,
    });
    if (error) {
      console.warn(
        `[${logLabel}] ${source.rpc} falhou em ${dateFrom}..${dateTo}: ${error.message}`,
      );
      return null;
    }
    const batch = (data ?? []) as DrilldownRow[];
    rows.push(...batch);
    const total = Number(batch[0]?.total_count ?? 0);
    if (batch.length < PAGE_SIZE || rows.length >= total) break;
  }
  return rows;
}

/**
 * Lê TODOS os lançamentos da conta no período, mês a mês, com uma retentativa
 * por mês. Devolve `null` se algum mês não puder ser lido nem na retentativa —
 * melhor omitir o quadro do que exibir um total incompleto.
 */
export async function fetchDrilldownRowsByMonth(
  supabase: SupabaseClient,
  args: {
    source: DrilldownSource;
    accountId: string;
    companyId: string;
    dateFrom: string;
    dateTo: string;
    /** Prefixo das mensagens de log (ex.: "dividendos-unidades"). */
    logLabel: string;
  },
): Promise<DrilldownRow[] | null> {
  const { source, accountId, companyId, dateFrom, dateTo, logLabel } = args;
  const chunks = monthChunks(dateFrom, dateTo);
  const rows: DrilldownRow[] = [];

  for (let i = 0; i < chunks.length; i += CHUNK_CONCURRENCY) {
    const batch = chunks.slice(i, i + CHUNK_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async ([from, to]) => {
        const first = await fetchChunkRows(
          supabase,
          source,
          accountId,
          companyId,
          from,
          to,
          logLabel,
        );
        if (first !== null) return first;
        // Retentativa única: o timeout observado foi transitório (cache frio).
        return fetchChunkRows(supabase, source, accountId, companyId, from, to, logLabel);
      }),
    );
    if (results.some((r) => r === null)) return null;
    results.forEach((r) => rows.push(...(r as DrilldownRow[])));
  }
  return rows;
}
