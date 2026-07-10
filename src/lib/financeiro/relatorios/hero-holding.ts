import type { SupabaseClient } from "@supabase/supabase-js";

import {
  buildDashboardRows,
  fetchAllDreAccountRows,
  scopeDreAccounts,
  type RawDreAccount,
} from "@/lib/dashboard/dre";
import { resolveFranquiasVivaCustosNegation } from "@/lib/dashboard/franquias-viva-custos";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";

import { normalizeCompanyName } from "./templates/hero-holding-template";

// ============================================================================
// Comparativo da HERO HOLDING — indicadores das 7 unidades Viva do grupo.
// ============================================================================
// Objetivo: montar, para o relatório da Hero Holding, uma linha por empresa
// vinculada com os MESMOS indicadores já validados no relatório INDIVIDUAL de
// cada unidade Viva. NÃO cria cálculo paralelo: reutiliza exatamente as mesmas
// fontes de dados e fórmulas do `one-page-payload.ts`:
//
//   - VVR acumulado / VVR do mês de referência → tabela `company_fee_vvr`
//     (mesma leitura do card VVR e do resumo YTD do relatório individual).
//   - FEE disponível / margem média dos eventos / inadimplência atual →
//     colunas de balanço da própria empresa em `companies` (mesmo dado do
//     painel FEE/VVR e dos cards individuais).
//   - Sobrevivência de caixa → FEE disponível ÷ média das despesas operacionais
//     (code "7") dos meses JÁ FECHADOS do ano corrente, via a RPC
//     `dashboard_dre_aggregate` + plano DRE escopado por empresa. Réplica exata
//     da regra do card individual (ver seção 8b do one-page-payload.ts).
//
// Isolamento: este módulo só é chamado quando o template da empresa analisada é
// o `hero-holding`. Nenhuma outra empresa passa por aqui — as regras validadas
// das demais Franquias Viva permanecem intocadas.
// ============================================================================

export interface HoldingCompanyIndicators {
  empresa: string;
  /**
   * % de atingimento ACUMULADO da meta de VVR (Jan → mês de referência do ano de
   * `dateTo`): soma do VVR realizado ÷ soma da meta de VVR no mesmo intervalo,
   * em pontos percentuais (ex.: 85.15). Null quando não há meta cadastrada no
   * período (evita divisão por zero).
   */
  pctMetaAnualVvrAcumulada: number | null;
  /**
   * % de atingimento da meta de VVR do MÊS de referência: VVR realizado ÷ meta
   * de VVR do ÚLTIMO mês selecionado (`toYear`/`toMonth`), em pontos percentuais
   * (ex.: 62.45). Quando o período abrange um único mês, é o próprio mês; quando
   * abrange vários (ex.: Jan→Jun), é sempre o mês FINAL (ex.: 06/2026) — nunca a
   * soma do intervalo, que coincidiria com o acumulado. Null quando a meta do
   * mês é zero/ausente (evita divisão por zero).
   */
  pctMetaVvrMes: number | null;
  /**
   * % de FEE disponível = FEE disponível ÷ FEE a receber (× 100). Mostra quanto
   * do FEE a receber já está disponível para saque — comparação mais justa entre
   * franquias de tamanhos diferentes que o valor absoluto. Null quando FEE a
   * receber é zero/ausente (evita divisão por zero).
   */
  pctFeeDisponivel: number | null;
  /** Sobrevivência de caixa em MESES (FEE ÷ média de despesas operacionais). */
  sobrevivenciaCaixaMeses: number | null;
  /** Margem média dos eventos (%). */
  margemMediaEventos: number | null;
  /** Inadimplência atual (R$). */
  inadimplenciaAtual: number | null;
}

export interface HoldingComparativoResult {
  /** Título do quadro (vem da configuração do template). */
  title: string;
  /** Rótulo do período de referência (ex.: "Junho/2026"). */
  referencia: string;
  empresas: HoldingCompanyIndicators[];
}

interface CompanyRow {
  id: string;
  name: string;
  fee_disponivel: number | string | null;
  fee_a_receber: number | string | null;
  margem_media_eventos: number | string | null;
  inadimplencia_atual: number | string | null;
}

interface FeeVvrRow {
  company_id: string;
  year: number;
  month: number;
  vvr: number | string | null;
  vvr_meta: number | string | null;
}

interface AggregateRow {
  dre_account_id: string;
  amount: number | string;
}

const num = (v: number | string | null | undefined): number | null =>
  v === null || v === undefined ? null : Number(v);

interface BuildHoldingComparativoArgs {
  /** Título do quadro (configuração do template). */
  title: string;
  companyNames: string[];
  dateFrom: string;
  dateTo: string;
  /** Rótulo do período de referência (ex.: "Junho/2026"). */
  referenciaLabel: string;
}

/**
 * Monta o comparativo das empresas da holding. Resolve as empresas por nome
 * NORMALIZADO dentro do segmento `franquias-viva` (garante que só entram
 * unidades Viva) e devolve uma linha por empresa na ORDEM de `companyNames`.
 *
 * Usa o admin client para leitura (quando disponível) porque os dados de
 * FEE/VVR já são geridos no painel admin — assim o comparativo funciona mesmo
 * quando o gerador do relatório não tem acesso individual a cada unidade.
 * É estritamente LEITURA/agregação; não escreve nada.
 */
export async function buildHeroHoldingComparativo(
  supabase: SupabaseClient,
  args: BuildHoldingComparativoArgs,
): Promise<HoldingComparativoResult> {
  const { title, companyNames, dateFrom, dateTo, referenciaLabel } = args;
  const db = createAdminClientIfAvailable() ?? supabase;

  const fromYear = parseInt(dateFrom.slice(0, 4), 10);
  const toYear = parseInt(dateTo.slice(0, 4), 10);
  const toMonth = parseInt(dateTo.slice(5, 7), 10);

  // ── 1. Resolve o segmento franquias-viva e as empresas por nome normalizado ──
  const { data: seg } = await db
    .from("segments")
    .select("id")
    .eq("slug", "franquias-viva")
    .maybeSingle<{ id: string }>();

  const wanted = new Map<string, number>(); // nome normalizado → índice de ordem
  companyNames.forEach((n, i) => wanted.set(normalizeCompanyName(n), i));

  let companyQuery = db
    .from("companies")
    .select("id,name,fee_disponivel,fee_a_receber,margem_media_eventos,inadimplencia_atual");
  if (seg?.id) companyQuery = companyQuery.eq("segment_id", seg.id);
  const { data: companyRows } = await companyQuery;

  // Só as empresas cujo nome normalizado casa com a lista da holding, na ordem.
  const matched: Array<{ order: number; company: CompanyRow }> = [];
  ((companyRows ?? []) as CompanyRow[]).forEach((c) => {
    const order = wanted.get(normalizeCompanyName(c.name));
    if (order !== undefined) matched.push({ order, company: c });
  });
  matched.sort((a, b) => a.order - b.order);

  if (matched.length === 0) {
    return { title, referencia: referenciaLabel, empresas: [] };
  }

  const companyIds = matched.map((m) => m.company.id);

  // ── 2. VVR realizado + Meta VVR (acumulado do ano + período selecionado) ─────
  // O comparativo exibe % de ATINGIMENTO DA META (realizado ÷ meta), não o VVR
  // absoluto — metas diferentes por franquia tornam o absoluto uma comparação
  // injusta. Uma única query traz realizado e meta; somamos os dois em cada
  // recorte. Mesmas fontes/colunas já validadas (company_fee_vvr.vvr /
  // vvr_meta). Range que cruza anos (raro) é tratado por (year, month).
  const minYear = Math.min(fromYear, toYear);
  const { data: vvrRows } = await db
    .from("company_fee_vvr")
    .select("company_id, year, month, vvr, vvr_meta")
    .in("company_id", companyIds)
    .gte("year", minYear)
    .lte("year", toYear);

  // Somatórios de realizado e meta, por empresa, em cada recorte.
  const vvrAcumByCompany = new Map<string, number>();
  const metaAcumByCompany = new Map<string, number>();
  const vvrMesByCompany = new Map<string, number>();
  const metaMesByCompany = new Map<string, number>();
  const add = (map: Map<string, number>, key: string, value: number) =>
    map.set(key, (map.get(key) ?? 0) + value);

  ((vvrRows ?? []) as FeeVvrRow[]).forEach((row) => {
    const vvr = num(row.vvr);
    const meta = num(row.vvr_meta);
    // Acumulado: Jan → mês de referência do ano de `dateTo`.
    if (row.year === toYear && row.month <= toMonth) {
      if (vvr !== null) add(vvrAcumByCompany, row.company_id, vvr);
      if (meta !== null) add(metaAcumByCompany, row.company_id, meta);
    }
    // Mês de referência: SEMPRE o ÚLTIMO mês selecionado (toYear/toMonth). Com um
    // único mês selecionado é o próprio mês; com um período de vários meses (ex.:
    // Jan→Jun) mostramos o mês FINAL (ex.: 06/2026), e NÃO a soma do intervalo —
    // que coincidiria com o acumulado e igualaria os dois indicadores.
    const isReferenceMonth = row.year === toYear && row.month === toMonth;
    if (isReferenceMonth) {
      if (vvr !== null) add(vvrMesByCompany, row.company_id, vvr);
      if (meta !== null) add(metaMesByCompany, row.company_id, meta);
    }
  });

  // % de atingimento = realizado ÷ meta * 100. Meta zero/ausente → null
  // (evita divisão por zero; o componente exibe o padrão "—").
  const pctAtingimento = (
    realizadoMap: Map<string, number>,
    metaMap: Map<string, number>,
    companyId: string,
  ): number | null => {
    const meta = metaMap.get(companyId);
    if (meta === undefined || meta <= 0) return null;
    const realizado = realizadoMap.get(companyId) ?? 0;
    return Number(((realizado / meta) * 100).toFixed(2));
  };

  // ── 3. Sobrevivência de caixa: FEE ÷ média das despesas operacionais dos ─────
  //      meses JÁ FECHADOS do ano corrente (mesma regra do card individual).
  const today = new Date();
  const currentYear = today.getUTCFullYear();
  const currentMonth = today.getUTCMonth() + 1;
  const closedMonthsCount = currentMonth - 1;

  // Plano DRE (global + custom) carregado UMA vez; escopado por empresa abaixo.
  const allAccounts = await fetchAllDreAccountRows<RawDreAccount>((from, to) =>
    db
      .from("dre_accounts")
      .select(
        "id,code,name,parent_id,level,type,is_summary,formula,sort_order,active,company_id",
      )
      .eq("active", true)
      .order("code")
      .range(from, to),
  );

  const sobrevivenciaByCompany = new Map<string, number>();
  if (closedMonthsCount >= 1) {
    const lastDay = new Date(
      Date.UTC(currentYear, closedMonthsCount, 0),
    ).getUTCDate();
    const closedFrom = `${currentYear}-01-01`;
    const closedTo = `${currentYear}-${String(closedMonthsCount).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

    for (const { company } of matched) {
      const feeDisponivel = num(company.fee_disponivel);
      if (feeDisponivel === null) continue;

      const { coreAccounts: accounts, translateToScopedId } = scopeDreAccounts(
        allAccounts,
        [company.id],
      );
      const custosNegation = resolveFranquiasVivaCustosNegation(
        "franquias-viva",
        accounts,
      );

      const { data: closedAgg, error: closedErr } = await db.rpc(
        "dashboard_dre_aggregate",
        {
          p_company_ids: [company.id],
          p_date_from: closedFrom,
          p_date_to: closedTo,
        },
      );
      if (closedErr) continue;

      const closedMap = new Map<string, number>();
      ((closedAgg ?? []) as AggregateRow[]).forEach((r) => {
        const scopedId = translateToScopedId(r.dre_account_id);
        if (!scopedId) return;
        closedMap.set(scopedId, (closedMap.get(scopedId) ?? 0) + Number(r.amount));
      });
      const { rows: closedRows } = buildDashboardRows(accounts, closedMap, {
        negateChildCodesInSummary: custosNegation,
      });
      const despesasOpTotal = Math.abs(
        closedRows.find((r) => r.code === "7")?.value ?? 0,
      );
      if (despesasOpTotal > 0) {
        const mediaDespesasOp = despesasOpTotal / closedMonthsCount;
        if (mediaDespesasOp > 0) {
          sobrevivenciaByCompany.set(
            company.id,
            Math.round(feeDisponivel / mediaDespesasOp),
          );
        }
      }
    }
  }

  // ── 4. Monta as linhas na ordem da holding ──────────────────────────────────
  const empresas: HoldingCompanyIndicators[] = matched.map(({ company }) => {
    // % de FEE disponível = FEE disponível ÷ FEE a receber. FEE a receber
    // zero/ausente → null ("—"); FEE disponível ausente → tratado como 0.
    const feeDisponivel = num(company.fee_disponivel);
    const feeAReceber = num(company.fee_a_receber);
    const pctFeeDisponivel =
      feeAReceber !== null && feeAReceber > 0
        ? Number((((feeDisponivel ?? 0) / feeAReceber) * 100).toFixed(2))
        : null;
    return {
      empresa: company.name,
      pctMetaAnualVvrAcumulada: pctAtingimento(
        vvrAcumByCompany,
        metaAcumByCompany,
        company.id,
      ),
      pctMetaVvrMes: pctAtingimento(vvrMesByCompany, metaMesByCompany, company.id),
      pctFeeDisponivel,
      sobrevivenciaCaixaMeses: sobrevivenciaByCompany.has(company.id)
        ? (sobrevivenciaByCompany.get(company.id) as number)
        : null,
      margemMediaEventos: num(company.margem_media_eventos),
      inadimplenciaAtual: num(company.inadimplencia_atual),
    };
  });

  return { title, referencia: referenciaLabel, empresas };
}
