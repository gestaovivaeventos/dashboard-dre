import { redirect } from "next/navigation";

import { CashFlowView } from "@/components/app/cash-flow-view";
import { getCurrentSessionContext } from "@/lib/auth/session";
import { readActiveSegmentSlug } from "@/lib/context/active-context";
import type { Segment } from "@/lib/supabase/types";
import {
  DRE_RESULTADO_EXERCICIO_CODE,
  SCOPED_DRE_ACCOUNTS_SELECT,
  aggregateDreRows,
  aggregateDreRowsByCompany,
  fetchAllDreAccountRows,
  findResultadoExercicio,
  scopeDreAccounts,
  type RawDreAccount,
} from "@/lib/dashboard/dre";
import {
  buildCashFlowAccumulatedBucket,
  buildCashFlowBuckets,
  buildCashFlowDateRange,
  buildCashFlowFilterState,
  buildCashFlowRows,
  EMPTY_CASH_FLOW_ACCUMULATED_SECTION,
  previousMonth,
  resolveAllowedCompanyIds,
  type CashFlowAccountBase,
  type CashFlowAccumulatedAccount,
  type CashFlowAccumulatedSection,
  type CashFlowPeriodBucket,
} from "@/lib/dashboard/cash-flow";

export const dynamic = "force-dynamic";

interface CashFlowPageProps {
  searchParams: Record<string, string | string[] | undefined>;
  params?: { segmentSlug?: string };
}

interface CashFlowDisplayRow extends CashFlowAccountBase {
  hasChildren: boolean;
  valuesByBucket: Record<string, number>;
  accumulatedValue: number;
  valuesByCompany?: Record<string, number>;
}

export default async function CashFlowPage({ searchParams, params }: CashFlowPageProps) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user) {
    redirect("/login");
  }

  // Load all segments the user can access (for the SegmentCompanyPicker).
  // Mesmo carregamento usado em dashboard/page.tsx.
  let segments: Segment[] = [];
  if (profile?.role === "admin") {
    const { data } = await supabase
      .from("segments")
      .select("id,name,slug,display_order,active")
      .eq("active", true)
      .order("display_order");
    segments = (data as Segment[]) ?? [];
  } else if (profile) {
    const { data } = await supabase
      .from("user_segment_access")
      .select("segments(id,name,slug,display_order,active)")
      .eq("user_id", profile.id);
    segments = ((data ?? []) as unknown as Array<{ segments: Segment }>)
      .map((row) => row.segments)
      .filter((s) => s && s.active)
      .sort((a, b) => a.display_order - b.display_order);
  }

  // Resolve segment filter. URL `/s/<slug>/fluxo-de-caixa` traz pelo params;
  // `/fluxo-de-caixa` (sem segmento) recorre ao cookie active_segment_slug
  // ou ao primeiro segmento disponível ao usuário.
  let segmentId: string | null = null;
  let activeSegmentSlug = params?.segmentSlug ?? null;
  if (!activeSegmentSlug) {
    const cookieSlug = await readActiveSegmentSlug();
    if (cookieSlug && segments.some((s) => s.slug === cookieSlug)) {
      activeSegmentSlug = cookieSlug;
    } else {
      activeSegmentSlug = segments[0]?.slug ?? null;
    }
  }
  if (activeSegmentSlug) {
    const found = segments.find((s) => s.slug === activeSegmentSlug);
    segmentId = found?.id ?? null;
  }

  let companiesQuery = supabase.from("companies").select("id,name,active").eq("active", true);
  if (segmentId) {
    companiesQuery = companiesQuery.eq("segment_id", segmentId);
  }

  const [{ data: companiesData }, { data: cashFlowAccountsData }, dreAccountsData] = await Promise.all([
    companiesQuery.order("name"),
    supabase
      .from("cash_flow_accounts")
      .select("id,code,name,parent_id,level,type,is_summary,formula,source,is_highlight_block,sort_order,active,company_id")
      .eq("active", true)
      .order("sort_order"),
    // Paginado: evita o truncamento em 1000 linhas do PostgREST que sumia
    // com os codes "8"/"9" do DRE (ver fetchAllDreAccountRows).
    fetchAllDreAccountRows<RawDreAccount>((from, to) =>
      supabase
        .from("dre_accounts")
        .select(SCOPED_DRE_ACCOUNTS_SELECT)
        .eq("active", true)
        .order("code")
        .range(from, to),
    ),
  ]);

  const companies = (companiesData ?? []).map((company) => ({
    id: company.id as string,
    name: company.name as string,
  }));
  const allowedCompanyIds = await resolveAllowedCompanyIds(
    supabase,
    profile,
    companies.map((company) => company.id),
  );

  const visibleCompanies = profile?.role === "admin"
    ? companies
    : companies.filter((c) => allowedCompanyIds.includes(c.id));

  const filter = buildCashFlowFilterState(searchParams, allowedCompanyIds);
  if (profile?.role !== "admin") {
    filter.selectedCompanyIds = allowedCompanyIds.length > 0
      ? filter.selectedCompanyIds.filter((id) => allowedCompanyIds.includes(id))
      : allowedCompanyIds;
    if (filter.selectedCompanyIds.length === 0) {
      filter.selectedCompanyIds = allowedCompanyIds;
    }
  }

  // Escopo do plano de Fluxo de Caixa para exibicao:
  // - Empresa unica selecionada com plano customizado (qualquer linha com
  //   company_id = empresa): mostramos o plano dela e ignoramos o global,
  //   senao a tela duplica todas as linhas (global + custom com mesmos codes).
  // - Caso contrario (consolidado multi-empresa OU empresa sem custom plan):
  //   usamos o plano global.
  const allRawCashFlowAccounts = (cashFlowAccountsData ?? []) as Array<
    CashFlowAccountBase & { company_id: string | null }
  >;
  const scopedCompanyId =
    filter.selectedCompanyIds.length === 1 ? filter.selectedCompanyIds[0] : null;
  const companyHasCustomPlan = scopedCompanyId
    ? allRawCashFlowAccounts.some((a) => a.company_id === scopedCompanyId)
    : false;
  const cashFlowAccounts: CashFlowAccountBase[] = allRawCashFlowAccounts
    .filter((a) =>
      companyHasCustomPlan ? a.company_id === scopedCompanyId : a.company_id === null,
    )
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

  // Escopo + tradutor de ids do plano DRE: USA o mesmo helper centralizado
  // do Dashboard DRE (src/lib/dashboard/dre.ts). É deliberado que esta tela
  // NÃO tenha lógica própria de cálculo do DRE — a linha "Resultado do
  // Exercício" do Fluxo de Caixa precisa bater bit-a-bit com o valor exibido
  // no Dashboard DRE, e a única forma de garantir isso através do tempo é
  // compartilhando o mesmo caminho de código.
  const dreScope = scopeDreAccounts(
    dreAccountsData,
    filter.selectedCompanyIds,
  );

  // === Override EXCLUSIVO da SGX ============================================
  // Por padrão a linha "Resultado do Exercício" do Fluxo de Caixa puxa o code
  // "11" do DRE (DRE_RESULTADO_EXERCICIO_CODE). SOMENTE para a SGX o produto
  // quer que essa linha reflita o "Resultado 4 - Locação + Operacional +
  // Projetos" (code "15" no plano custom da SGX), em vez do "Resultado 2 -
  // Locação + Operacional" (code "11").
  //
  // Aplica-se apenas quando a SGX é a ÚNICA empresa selecionada — que é
  // exatamente quando o escopo do DRE (`dreScope`) é o plano custom da SGX,
  // onde o code "15" existe (isCoreDreCode permite top-level 1..19). Em
  // consolidado/comparativo multiempresa o escopo cai no plano global (sem
  // code 15), então mantemos o code "11" padrão — sem afetar nenhuma outra
  // empresa nem o cálculo geral. Como o "Resultado" alimenta Caixa Gerado →
  // Caixa Final → Saldo Inicial, usar o code 15 em `computeDreResultado`
  // mantém toda a matemática do caixa da SGX internamente consistente.
  const SGX_RESULTADO_EXERCICIO_CODE = "15";
  const sgxCompanyId =
    companies.find((c) => c.name.trim().toUpperCase() === "SGX")?.id ?? null;
  const isSgxOnly =
    sgxCompanyId !== null &&
    filter.selectedCompanyIds.length === 1 &&
    filter.selectedCompanyIds[0] === sgxCompanyId;
  const resultadoExercicioCode = isSgxOnly
    ? SGX_RESULTADO_EXERCICIO_CODE
    : DRE_RESULTADO_EXERCICIO_CODE;

  if (filter.selectedCompanyIds.length === 0) {
    return (
      <CashFlowView
        filter={filter}
        range={{ dateFrom: "", dateTo: "", label: "" }}
        rows={[]}
        accounts={cashFlowAccounts}
        companies={visibleCompanies}
        role={profile?.role ?? "gestor_hero"}
        visibleBuckets={[]}
        accumulatedBucket={{ key: "", label: "", dateFrom: "", dateTo: "", year: 0, month: 0 }}
        selectedCompanyIds={[]}
        lastSyncAt={null}
        accumulatedSection={EMPTY_CASH_FLOW_ACCUMULATED_SECTION}
        segments={segments}
        activeSegmentSlug={activeSegmentSlug}
      />
    );
  }

  const { data: lastSyncAtRaw } = await supabase.rpc(
    "dashboard_last_successful_sync",
    { p_company_ids: filter.selectedCompanyIds },
  );
  const lastSyncAt = typeof lastSyncAtRaw === "string" ? lastSyncAtRaw : null;

  const range = buildCashFlowDateRange(filter);
  const visibleBuckets = buildCashFlowBuckets(filter);
  const accumulatedBucket = buildCashFlowAccumulatedBucket(visibleBuckets);

  // "Resultado do Exercicio" para um bucket — delega 100% para o helper
  // compartilhado em src/lib/dashboard/dre.ts. NÃO duplicar o pipeline de
  // cálculo aqui: a tela do Dashboard DRE usa o MESMO `aggregateDreRows`
  // + `findResultadoExercicio`, então qualquer mudança futura na regra do
  // DRE se propaga automaticamente para o Fluxo de Caixa. O code de resultado
  // (`resultadoExercicioCode`) é "11" por padrão e "15" só no escopo da SGX.
  const computeDreResultado = async (
    bucket: CashFlowPeriodBucket,
    companies: string[] = filter.selectedCompanyIds,
  ): Promise<number> => {
    const rows = await aggregateDreRows({
      supabase,
      scope: dreScope,
      companyIds: companies,
      dateFrom: bucket.dateFrom,
      dateTo: bucket.dateTo,
    });
    return findResultadoExercicio(rows, resultadoExercicioCode);
  };

  // Helper: agrega cash flow no periodo e devolve mapa accountId -> amount.
  const computeCashFlowAmounts = async (
    bucket: CashFlowPeriodBucket,
    companies: string[] = filter.selectedCompanyIds,
  ): Promise<Map<string, number>> => {
    const { data, error } = await supabase.rpc("cash_flow_aggregate", {
      p_company_ids: companies,
      p_date_from: bucket.dateFrom,
      p_date_to: bucket.dateTo,
    });
    if (error) {
      throw new Error(`Falha ao carregar agregados de Fluxo de Caixa: ${error.message}`);
    }
    const map = new Map<string, number>();
    (data as Array<{ cash_flow_account_id: string; amount: number | string | null }> | null ?? []).forEach((item) => {
      map.set(item.cash_flow_account_id, Number(item.amount ?? 0));
    });
    return map;
  };

  // Subniveis por socio so aparecem quando exatamente UMA empresa esta
  // selecionada — quadros societarios sao por empresa e misturar dois
  // quadros distintos confunde a leitura. Tambem nao aparecem no modo
  // comparativo entre empresas (que ja exige >1 empresa).
  const singleCompanyId =
    filter.selectedCompanyIds.length === 1 && !filter.compareCompanies
      ? filter.selectedCompanyIds[0]
      : null;

  type PartnerRow = {
    id: string;
    name: string;
    sort_order: number;
    historical_dividends_value: number;
    historical_aportes_value: number;
  };
  let partners: PartnerRow[] = [];
  if (singleCompanyId) {
    const { data: partnersData } = await supabase
      .from("company_partners")
      .select("id, name, sort_order, historical_dividends_value, historical_aportes_value")
      .eq("company_id", singleCompanyId)
      .order("sort_order")
      .order("id");
    partners = (partnersData ?? []).map((row) => ({
      id: row.id as string,
      name: row.name as string,
      sort_order: row.sort_order as number,
      historical_dividends_value: Number(
        (row as { historical_dividends_value?: number | string | null })
          .historical_dividends_value ?? 0,
      ),
      historical_aportes_value: Number(
        (row as { historical_aportes_value?: number | string | null })
          .historical_aportes_value ?? 0,
      ),
    }));
  }

  // Map: partnerId -> { [cash_flow_account_id]: amount } por bucket.
  const computePartnerBreakdown = async (
    bucket: CashFlowPeriodBucket,
  ): Promise<Map<string, Map<string, number>>> => {
    if (!singleCompanyId || partners.length === 0) {
      return new Map();
    }
    const { data, error } = await supabase.rpc("cash_flow_partner_breakdown", {
      p_company_id: singleCompanyId,
      p_date_from: bucket.dateFrom,
      p_date_to: bucket.dateTo,
    });
    if (error) {
      throw new Error(`Falha ao carregar detalhamento por socio: ${error.message}`);
    }
    const map = new Map<string, Map<string, number>>();
    ((data as Array<{
      partner_id: string;
      cash_flow_account_id: string;
      amount: number | string | null;
    }> | null) ?? []).forEach((item) => {
      const inner = map.get(item.partner_id) ?? new Map<string, number>();
      inner.set(item.cash_flow_account_id, Number(item.amount ?? 0));
      map.set(item.partner_id, inner);
    });
    return map;
  };

  // === Excecao pontual: VVR Nov/2022 (split de dividendos Renan/Juliana) ====
  // Em Nov/2022 a Omie registrou dois pagamentos de dividendos da Viva Volta
  // Redonda (R$ 3.790,18 cada) no fornecedor generico "Lancamento Debito".
  // A categoria mapeia para a conta 4.2 (Dividendos Pagos), entao o TOTAL
  // continua correto via cash_flow_aggregate (R$ 7.580,36). Mas a quebra
  // por socio fica zerada — "Lancamento Debito" nao esta vinculado a nenhum
  // socio em configuracoes > socios, e NAO deve ser, pois o sistema
  // atribuiria os R$ 7.580,36 a um unico socio.
  //
  // Esta excecao injeta o split correto (Renan R$ 3.790,18 / Juliana
  // R$ 3.790,18) apenas no partner_breakdown da conta 4.2, somente quando:
  //   - empresa unica selecionada e a VVR (match por nome "volta redonda")
  //   - bucket / faixa inclui o mes 2022-11
  // Nao altera mapeamento, vinculos socio-fornecedor, total da linha 4.2,
  // saldos, demais empresas, meses ou categorias. Aplica-se tambem ao
  // baseline (historico anterior ao primeiro bucket) para refletir
  // corretamente na secao "Dividendos Acumulados" de meses posteriores.
  const vvrException = (() => {
    if (!singleCompanyId) return null;
    const company = companies.find((c) => c.id === singleCompanyId);
    if (!company || !company.name.toLowerCase().includes("volta redonda")) {
      return null;
    }
    const dividendsAccount = cashFlowAccounts.find((a) => a.code === "4.2");
    if (!dividendsAccount) return null;
    const renan = partners.find((p) => p.name.toLowerCase().includes("renan"));
    const juliana = partners.find((p) => p.name.toLowerCase().includes("juliana"));
    if (!renan || !juliana) return null;
    return {
      year: 2022,
      month: 11,
      dividendsAccountId: dividendsAccount.id,
      partnerAmounts: [
        { partnerId: renan.id, amount: 3790.18 },
        { partnerId: juliana.id, amount: 3790.18 },
      ],
    };
  })();

  const applyVvrExceptionToPartnerBreakdown = (
    breakdown: Map<string, Map<string, number>>,
  ) => {
    if (!vvrException) return;
    vvrException.partnerAmounts.forEach(({ partnerId, amount }) => {
      const inner = breakdown.get(partnerId) ?? new Map<string, number>();
      inner.set(
        vvrException.dividendsAccountId,
        (inner.get(vvrException.dividendsAccountId) ?? 0) + amount,
      );
      breakdown.set(partnerId, inner);
    });
  };

  const isVvrExceptionMonth = (year: number, month: number) =>
    vvrException !== null
    && year === vvrException.year
    && month === vvrException.month;

  const rangeIncludesVvrExceptionMonth = (
    fromYear: number, fromMonth: number,
    toYear: number, toMonth: number,
  ) => {
    if (!vvrException) return false;
    const target = vvrException.year * 100 + vvrException.month;
    const fromKey = fromYear * 100 + fromMonth;
    const toKey = toYear * 100 + toMonth;
    return fromKey <= target && target <= toKey;
  };

  // Para "Saldo Inicial" precisamos saber o "Caixa Final" do mes anterior.
  // Para o PRIMEIRO bucket: usa cash_flow_opening_balances se cadastrado;
  // caso contrario, computa recursivamente o "Caixa Final" do mes anterior
  // (garante que ao virar o ano — ex.: Dez/2025 → Jan/2026 — o saldo inicial
  // de Janeiro = caixa final de Dezembro, em vez de zerar).
  // Para os SEGUINTES, encadeia-se a partir do bucket anterior calculado.
  const buckets = visibleBuckets;

  const findCodeId = (code: string) => cashFlowAccounts.find((a) => a.code === code)?.id;
  const caixaFinalId = findCodeId("90.3");

  // Pre-busca TODOS os opening balances cadastrados para as empresas
  // selecionadas (uma unica query). Indexa por mes consolidado e por
  // (empresa, mes) para suportar tanto a visao consolidada quanto o
  // modo comparativo entre empresas.
  const { data: openingBalancesData } = await supabase
    .from("cash_flow_opening_balances")
    .select("company_id, period_year, period_month, amount")
    .in("company_id", filter.selectedCompanyIds);

  const openingByMonth = new Map<string, number>();
  const openingByCompanyMonth = new Map<string, Map<string, number>>();
  ((openingBalancesData ?? []) as Array<{
    company_id: string;
    period_year: number;
    period_month: number;
    amount: number | string;
  }>).forEach((row) => {
    const monthKey = `${row.period_year}-${row.period_month}`;
    const value = Number(row.amount ?? 0);
    openingByMonth.set(monthKey, (openingByMonth.get(monthKey) ?? 0) + value);
    let perCompany = openingByCompanyMonth.get(row.company_id);
    if (!perCompany) {
      perCompany = new Map();
      openingByCompanyMonth.set(row.company_id, perCompany);
    }
    perCompany.set(monthKey, (perCompany.get(monthKey) ?? 0) + value);
  });

  // Data-base "infinita" para a agregacao de saldo inicial (mesma ideia do
  // baseline de dividendos mais abaixo). Cobre todo o historico.
  const SALDO_BASELINE_FAR_PAST = "1900-01-01";

  const monthBucketFor = (year: number, month: number): CashFlowPeriodBucket => ({
    key: `m-${year}-${month}`,
    label: "",
    dateFrom: new Date(Date.UTC(year, month - 1, 1)).toISOString().slice(0, 10),
    dateTo: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10),
    year,
    month,
  });

  // Resolve o "Saldo Inicial de Caixa" do primeiro mes exibido para um conjunto
  // de empresas SEM recursao mes-a-mes. A versao antiga recuava ate ~120 meses,
  // disparando 2-3 RPCs por mes (ate ~240 RPCs simultaneos) — o que estourava a
  // funcao serverless / pool de conexoes em segmentos com muitas empresas
  // (franquias-viva) e gerava os 500 intermitentes.
  //
  // Otimizacao (matematicamente identica): "Caixa Final" = "Saldo Inicial" +
  // "Caixa Gerado", e "Caixa Gerado" e LINEAR nos lancamentos/resultado do mes
  // (somas com sinal em buildCashFlowRows). Logo, o caixa final acumulado de um
  // intervalo contiguo (sem reset por saldo manual) = saldo manual da ancora +
  // "Caixa Gerado" de UMA agregacao sobre o intervalo inteiro. Isso troca a
  // recursao por no maximo 2 RPCs.
  const buildSaldoInicialResolver = (
    companies: string[],
    openingsForScope: Map<string, number>,
  ) => {
    return async (firstYear: number, firstMonth: number): Promise<number> => {
      // Saldo manual cadastrado para o proprio primeiro mes vence tudo.
      const manualFirst = openingsForScope.get(`${firstYear}-${firstMonth}`);
      if (manualFirst !== undefined) return manualFirst;

      // Ultimo mes a incluir no acumulado = mes anterior ao primeiro exibido.
      const prev = previousMonth(firstYear, firstMonth);
      const prevKey = prev.year * 100 + prev.month;

      // Ancora = saldo manual MAIS RECENTE com mes <= prev (reinicia a cadeia).
      let anchorYM = -1;
      let anchorValue = 0;
      openingsForScope.forEach((value, key) => {
        const [yStr, mStr] = key.split("-");
        const keyNum = Number(yStr) * 100 + Number(mStr);
        if (keyNum <= prevKey && keyNum > anchorYM) {
          anchorYM = keyNum;
          anchorValue = value;
        }
      });
      const hasAnchor = anchorYM >= 0;

      const rangeFrom = hasAnchor
        ? monthBucketFor(Math.floor(anchorYM / 100), anchorYM % 100).dateFrom
        : SALDO_BASELINE_FAR_PAST;
      const rangeTo = monthBucketFor(prev.year, prev.month).dateTo;
      const openingValue = hasAnchor ? anchorValue : 0;

      const rangeBucket: CashFlowPeriodBucket = {
        key: "saldo-baseline",
        label: "",
        dateFrom: rangeFrom,
        dateTo: rangeTo,
        year: prev.year,
        month: prev.month,
      };

      const [dreResultado, amounts] = await Promise.all([
        computeDreResultado(rangeBucket, companies),
        computeCashFlowAmounts(rangeBucket, companies),
      ]);
      // saldoInicial: 0 -> "Caixa Final" calculado = exatamente o "Caixa Gerado"
      // acumulado do intervalo.
      const { rows } = buildCashFlowRows(cashFlowAccounts, amounts, {
        dreResultadoExercicio: dreResultado,
        saldoInicial: 0,
      });
      const caixaGerado = caixaFinalId
        ? rows.find((r) => r.id === caixaFinalId)?.value ?? 0
        : 0;
      return openingValue + caixaGerado;
    };
  };

  const resolveSaldoInicialConsolidated = buildSaldoInicialResolver(
    filter.selectedCompanyIds,
    openingByMonth,
  );

  let saldoInicialBucket: number;
  if (buckets.length === 0) {
    saldoInicialBucket = 0;
  } else {
    saldoInicialBucket = await resolveSaldoInicialConsolidated(
      buckets[0].year,
      buckets[0].month,
    );
  }

  // Buckets futuros (posteriores ao mes corrente) ficam zerados para nao
  // arrastar Saldo Inicial / Caixa Final indefinidamente — o usuario nao tem
  // dados ainda nesses meses, entao mostrar o ultimo saldo cascateando
  // confunde a leitura do fluxo.
  const today = new Date();
  const todayYear = today.getUTCFullYear();
  const todayMonth = today.getUTCMonth() + 1;
  const isFutureBucket = (b: typeof buckets[number]) =>
    b.year > todayYear || (b.year === todayYear && b.month > todayMonth);

  const valuesPerBucket = new Map<string, Record<string, number>>();
  // Para cada bucket, guarda partnerId -> (cashFlowAccountId -> amount).
  const partnerValuesPerBucket = new Map<string, Map<string, Map<string, number>>>();
  let previousCaixaFinal = 0;

  // Pre-busca as agregacoes de TODOS os meses em paralelo. Elas nao dependem do
  // saldo inicial (que e encadeado em memoria logo abaixo), entao disparar tudo
  // de uma vez troca N esperas sequenciais por um unico round-trip. Buckets
  // futuros nao consultam o banco (ficam zerados).
  const bucketAggregates = await Promise.all(
    buckets.map(async (bucket) => {
      if (isFutureBucket(bucket)) return null;
      const [dreResultado, amounts, partnerBreakdown] = await Promise.all([
        computeDreResultado(bucket),
        computeCashFlowAmounts(bucket),
        computePartnerBreakdown(bucket),
      ]);
      return { dreResultado, amounts, partnerBreakdown };
    }),
  );

  for (let i = 0; i < buckets.length; i += 1) {
    const bucket = buckets[i];
    const agg = bucketAggregates[i];

    if (agg === null) {
      const byRowId: Record<string, number> = {};
      cashFlowAccounts.forEach((a) => {
        byRowId[a.id] = 0;
      });
      valuesPerBucket.set(bucket.key, byRowId);
      partnerValuesPerBucket.set(bucket.key, new Map());
      previousCaixaFinal = 0;
      continue;
    }

    const saldoInicial = i === 0 ? saldoInicialBucket : previousCaixaFinal;
    const { dreResultado, amounts, partnerBreakdown } = agg;

    if (isVvrExceptionMonth(bucket.year, bucket.month)) {
      applyVvrExceptionToPartnerBreakdown(partnerBreakdown);
    }

    const { rows } = buildCashFlowRows(cashFlowAccounts, amounts, {
      dreResultadoExercicio: dreResultado,
      saldoInicial,
    });

    const byRowId: Record<string, number> = {};
    rows.forEach((r) => {
      byRowId[r.id] = r.value;
    });
    valuesPerBucket.set(bucket.key, byRowId);
    partnerValuesPerBucket.set(bucket.key, partnerBreakdown);

    if (caixaFinalId) {
      previousCaixaFinal = byRowId[caixaFinalId] ?? 0;
    }
  }

  // Acumulado: agrega todo o range de uma vez. "Resultado" puxa do DRE acumulado;
  // "Saldo Inicial" usa o do primeiro bucket; "Caixa Final" e calculado pela formula.
  const [accDreResultado, accAmounts, accPartnerBreakdown] = await Promise.all([
    computeDreResultado(accumulatedBucket),
    computeCashFlowAmounts(accumulatedBucket),
    computePartnerBreakdown(accumulatedBucket),
  ]);

  if (
    buckets.length > 0
    && rangeIncludesVvrExceptionMonth(
      buckets[0].year,
      buckets[0].month,
      buckets[buckets.length - 1].year,
      buckets[buckets.length - 1].month,
    )
  ) {
    applyVvrExceptionToPartnerBreakdown(accPartnerBreakdown);
  }

  const { rows: accRows } = buildCashFlowRows(cashFlowAccounts, accAmounts, {
    dreResultadoExercicio: accDreResultado,
    saldoInicial: saldoInicialBucket,
  });

  const accumulatedMap: Record<string, number> = {};
  accRows.forEach((r) => {
    accumulatedMap[r.id] = r.value;
  });

  // Comparativo entre empresas (modo comparativa). Para simplicidade, usa o
  // periodo acumulado e nao recursa saldo inicial entre meses por empresa —
  // o usuario tem visao agregada por empresa apenas no range completo.
  const companyValuesMap: Record<string, Record<string, number>> = {};
  if (filter.compareCompanies && filter.selectedCompanyIds.length > 1) {
    const { data: byCompanyData } = await supabase.rpc("cash_flow_aggregate_by_company", {
      p_company_ids: filter.selectedCompanyIds,
      p_date_from: accumulatedBucket.dateFrom,
      p_date_to: accumulatedBucket.dateTo,
    });

    const rawByCompany = (byCompanyData as Array<{
      company_id: string;
      cash_flow_account_id: string;
      amount: number | string | null;
    }> | null) ?? [];

    const amountsByCompanyId = new Map<string, Map<string, number>>();
    rawByCompany.forEach((item) => {
      let m = amountsByCompanyId.get(item.company_id);
      if (!m) {
        m = new Map();
        amountsByCompanyId.set(item.company_id, m);
      }
      m.set(item.cash_flow_account_id, Number(item.amount ?? 0));
    });

    // "Resultado do Exercicio" por empresa: delega para o helper compartilhado
    // (`aggregateDreRowsByCompany`) — mesmo caminho de código que o Dashboard
    // DRE usa, garantindo que cada coluna por empresa exiba o MESMO valor de
    // Resultado do Exercício que apareceria no Dashboard com filtro daquela
    // empresa.
    const dreRowsByCompany = await aggregateDreRowsByCompany({
      supabase,
      scope: dreScope,
      companyIds: filter.selectedCompanyIds,
      dateFrom: accumulatedBucket.dateFrom,
      dateTo: accumulatedBucket.dateTo,
    });

    // Saldo inicial por empresa: usa entrada manual em
    // cash_flow_opening_balances se cadastrada; caso contrario, computa
    // recursivamente o caixa final do mes anterior (mesma regra do modo
    // consolidado, mas restrita a UMA empresa por vez).
    const firstBucket = buckets[0];

    await Promise.all(
      filter.selectedCompanyIds.map(async (companyId) => {
        const companyAmounts = amountsByCompanyId.get(companyId) ?? new Map();
        const companyResultado = findResultadoExercicio(
          dreRowsByCompany.get(companyId) ?? [],
        );

        const companyOpenings = openingByCompanyMonth.get(companyId) ?? new Map<string, number>();
        const resolveForCompany = buildSaldoInicialResolver([companyId], companyOpenings);
        const companyOpening = firstBucket
          ? await resolveForCompany(firstBucket.year, firstBucket.month)
          : 0;

        const companyRows = buildCashFlowRows(cashFlowAccounts, companyAmounts, {
          dreResultadoExercicio: companyResultado,
          saldoInicial: companyOpening,
        }).rows;

        const byId: Record<string, number> = {};
        companyRows.forEach((r) => { byId[r.id] = r.value; });
        companyValuesMap[companyId] = byId;
      }),
    );
  }

  // Conta 4.2 (Dividendos Pagos) e 5.1 (Aumento de Capital). Quando ha 1
  // empresa selecionada e existem socios cadastrados, injetamos linhas
  // filhas (level=3) por socio sob cada uma dessas contas. As linhas
  // virtuais nao existem em cash_flow_accounts — sao montadas aqui apenas
  // para render.
  const dividendsPaidAccount = cashFlowAccounts.find((a) => a.code === "4.2") ?? null;
  const capitalIncreaseAccount = cashFlowAccounts.find((a) => a.code === "5.1") ?? null;
  const showPartners = partners.length > 0 && singleCompanyId !== null;

  const buildPartnerRow = (
    parent: CashFlowAccountBase,
    partner: PartnerRow,
    index: number,
  ): CashFlowDisplayRow => {
    const valuesByBucket: Record<string, number> = {};
    visibleBuckets.forEach((bucket) => {
      const amount = partnerValuesPerBucket.get(bucket.key)?.get(partner.id)?.get(parent.id) ?? 0;
      valuesByBucket[bucket.key] = amount;
    });
    const accumulatedValue = accPartnerBreakdown.get(partner.id)?.get(parent.id) ?? 0;
    return {
      id: `partner:${parent.code}:${partner.id}`,
      code: `${parent.code}.${index + 1}`,
      name: partner.name,
      parent_id: parent.id,
      level: parent.level + 1,
      type: parent.type,
      is_summary: false,
      formula: null,
      // source nao-nulo desabilita drilldown via `isDrillable` no
      // CashFlowView — necessario porque o id "partner:..." nao e UUID
      // valido para o RPC de drilldown.
      source: "partner_breakdown",
      is_highlight_block: false,
      sort_order: index + 1,
      active: true,
      hasChildren: false,
      valuesByBucket,
      accumulatedValue,
      // Comparativo entre empresas exige >1 empresa, portanto partners
      // nao aparecem nesse modo (singleCompanyId == null). Mas mantemos o
      // shape compativel.
      valuesByCompany: undefined,
    };
  };

  const partnerRows: CashFlowDisplayRow[] = [];
  if (showPartners) {
    if (dividendsPaidAccount) {
      partners.forEach((partner, idx) => {
        partnerRows.push(buildPartnerRow(dividendsPaidAccount, partner, idx));
      });
    }
    if (capitalIncreaseAccount) {
      partners.forEach((partner, idx) => {
        partnerRows.push(buildPartnerRow(capitalIncreaseAccount, partner, idx));
      });
    }
  }

  const accountIdsWithPartnerChildren = new Set<string>();
  if (showPartners) {
    if (dividendsPaidAccount) accountIdsWithPartnerChildren.add(dividendsPaidAccount.id);
    if (capitalIncreaseAccount) accountIdsWithPartnerChildren.add(capitalIncreaseAccount.id);
  }

  const baseRows: CashFlowDisplayRow[] = cashFlowAccounts.map((account) => {
    const valuesByBucket: Record<string, number> = {};
    visibleBuckets.forEach((bucket) => {
      valuesByBucket[bucket.key] = valuesPerBucket.get(bucket.key)?.[account.id] ?? 0;
    });

    const valuesByCompany: Record<string, number> = {};
    if (filter.compareCompanies) {
      for (const companyId of filter.selectedCompanyIds) {
        valuesByCompany[companyId] = companyValuesMap[companyId]?.[account.id] ?? 0;
      }
    }

    const hasChildren =
      cashFlowAccounts.some((a) => a.parent_id === account.id) ||
      accountIdsWithPartnerChildren.has(account.id);

    return {
      ...account,
      hasChildren,
      valuesByBucket,
      accumulatedValue: accumulatedMap[account.id] ?? 0,
      valuesByCompany: filter.compareCompanies ? valuesByCompany : undefined,
    };
  });

  const displayRows: CashFlowDisplayRow[] = [...baseRows, ...partnerRows];

  // === Nova secao: Aportes / Dividendos Acumulados ============================
  // Para cada bucket exibido, calcula o total acumulado de Dividendos Pagos
  // (4.2) e Aumento de Capital (5.1) DESDE O INICIO DA HISTORIA ate o final
  // daquele bucket — inclui periodos anteriores ao range exibido. Quando
  // existem socios cadastrados (single-company), tambem detalha por socio.
  //
  // Regras:
  // - Buckets futuros (alem do mes corrente) ficam zerados — nao projetam
  //   acumulado para frente (regra explicita do produto).
  // - Total da totalizadora: se ha socios exibidos, soma dos acumulados por
  //   socio (regra explicita); senao, acumulado da propria conta agregada.
  // - Subniveis por socio so aparecem em single-company (mesmo padrao das
  //   linhas 4.2 / 5.1 ja existentes).
  // - Acumulado segue por sobre virada de ano: jan acumula em cima de dez do
  //   ano anterior porque o baseline e gerado por consulta sem corte de ano.
  const BASELINE_FAR_PAST = "1900-01-01";

  let baselineAmounts = new Map<string, number>();
  let baselinePartnerBreakdown = new Map<string, Map<string, number>>();
  const firstBucket = buckets[0] ?? null;
  if (firstBucket) {
    const baselineEnd = new Date(Date.UTC(firstBucket.year, firstBucket.month - 1, 0));
    const baselineDateTo = baselineEnd.toISOString().slice(0, 10);
    if (baselineDateTo >= BASELINE_FAR_PAST) {
      const baselineBucket: CashFlowPeriodBucket = {
        key: "acc-baseline",
        label: "",
        dateFrom: BASELINE_FAR_PAST,
        dateTo: baselineDateTo,
        year: firstBucket.year,
        month: firstBucket.month,
      };
      [baselineAmounts, baselinePartnerBreakdown] = await Promise.all([
        computeCashFlowAmounts(baselineBucket),
        computePartnerBreakdown(baselineBucket),
      ]);

      // Se o primeiro bucket exibido e POSTERIOR a Nov/2022, o baseline
      // (historico anterior) inclui esse mes — entao o split Renan/Juliana
      // precisa entrar nos running accumulators iniciais para refletir no
      // acumulado dos meses seguintes.
      if (
        vvrException
        && (firstBucket.year > vvrException.year
            || (firstBucket.year === vvrException.year
                && firstBucket.month > vvrException.month))
      ) {
        applyVvrExceptionToPartnerBreakdown(baselinePartnerBreakdown);
      }
    }
  }

  const dividendsAccountId = dividendsPaidAccount?.id ?? null;
  const aportesAccountId = capitalIncreaseAccount?.id ?? null;

  // === Saldos historicos pre-Omie por socio ===================================
  // Cada socio pode ter saldo historico (dividendos / aportes) pago ANTES da
  // migracao para a Omie. Esses valores entram APENAS na secao "Acumulados"
  // — nunca nas linhas 4.2 / 5.1 normais, nem no calculo de saldo de caixa.
  //
  // Regra de competencia (do produto): o valor historico aparece no mes
  // ANTERIOR ao primeiro mes Omie com lancamento partner-linked daquela
  // empresa para a respectiva conta. A partir desse mes o running
  // accumulator carrega o saldo, somando normalmente com os meses
  // subsequentes da Omie. Quando o mes de injecao cai antes do primeiro
  // bucket exibido, o historico entra na inicializacao do running (sai do
  // "baseline" do usuario, ja partindo do valor maior).
  //
  // Se NAO ha primeiro mes Omie (empresa sem dado nessa conta ainda), o
  // historico vai para o primeiro bucket exibido — assim o admin consegue
  // verificar visualmente que o valor digitado foi persistido.
  const firstOmieMonthByAccount = new Map<string, { year: number; month: number }>();
  if (
    singleCompanyId
    && partners.length > 0
    && (dividendsAccountId || aportesAccountId)
    && partners.some(
      (p) =>
        p.historical_dividends_value > 0 || p.historical_aportes_value > 0,
    )
  ) {
    const { data: firstMonthData } = await supabase.rpc(
      "cash_flow_partner_first_omie_month",
      { p_company_id: singleCompanyId },
    );
    ((firstMonthData as Array<{
      cash_flow_account_id: string;
      first_year: number;
      first_month: number;
    }> | null) ?? []).forEach((row) => {
      firstOmieMonthByAccount.set(row.cash_flow_account_id, {
        year: row.first_year,
        month: row.first_month,
      });
    });

    // VVR Nov/2022: a excecao injeta partner breakdown em Nov/2022 mesmo
    // sem entrada partner-linked real. O primeiro mes com valor visivel
    // passa a ser Nov/2022 — historico deve cair em Out/2022, nao no mes
    // anterior ao primeiro lancamento partner-linked "real" (que pode ser
    // posterior).
    if (vvrException) {
      const accId = vvrException.dividendsAccountId;
      const existing = firstOmieMonthByAccount.get(accId);
      const exceptionKey = vvrException.year * 100 + vvrException.month;
      if (!existing || existing.year * 100 + existing.month > exceptionKey) {
        firstOmieMonthByAccount.set(accId, {
          year: vvrException.year,
          month: vvrException.month,
        });
      }
    }
  }

  const computeHistoricalMonth = (
    accountId: string | null,
  ): { year: number; month: number } | null => {
    if (!accountId) return null;
    const firstOmie = firstOmieMonthByAccount.get(accountId);
    if (firstOmie) {
      return previousMonth(firstOmie.year, firstOmie.month);
    }
    // Sem dado Omie: ancora no primeiro bucket exibido (fallback amigavel).
    return firstBucket ? { year: firstBucket.year, month: firstBucket.month } : null;
  };

  // Distribui injecoes em duas categorias: as que ocorrem ANTES do primeiro
  // bucket exibido (entram no init do running) e as que caem dentro do
  // range visivel (injetadas no momento do bucket correspondente).
  type HistoricalInjection = {
    partnerId: string;
    accountId: string;
    amount: number;
  };
  const historicalBeforeFirstVisible: HistoricalInjection[] = [];
  const historicalWithinVisibleByBucket = new Map<string, HistoricalInjection[]>();

  if (firstBucket) {
    const firstKey = firstBucket.year * 100 + firstBucket.month;
    const todayKey = todayYear * 100 + todayMonth;

    const enqueue = (
      partnerId: string,
      accountId: string | null,
      amount: number,
    ) => {
      if (!accountId || amount <= 0) return;
      const month = computeHistoricalMonth(accountId);
      if (!month) return;
      const injKey = month.year * 100 + month.month;
      // Nao projeta no futuro — regra do produto. Cai em silencio.
      if (injKey > todayKey) return;
      if (injKey < firstKey) {
        historicalBeforeFirstVisible.push({ partnerId, accountId, amount });
        return;
      }
      const targetBucket = visibleBuckets.find(
        (b) => b.year === month.year && b.month === month.month,
      );
      if (!targetBucket) return;
      const list = historicalWithinVisibleByBucket.get(targetBucket.key) ?? [];
      list.push({ partnerId, accountId, amount });
      historicalWithinVisibleByBucket.set(targetBucket.key, list);
    };

    partners.forEach((p) => {
      enqueue(p.id, dividendsAccountId, p.historical_dividends_value);
      enqueue(p.id, aportesAccountId, p.historical_aportes_value);
    });
  }

  // Running accumulators — guardam o acumulado ate o fim do bucket corrente.
  // Saldos historicos pre-Omie agendados para meses ANTERIORES ao primeiro
  // bucket exibido somam-se aqui no init (acumulado ja "carrega" desde o
  // historico). Quando NAO ha socios (showPartners=false), nenhum historico
  // se aplica (partners.length=0).
  let runningDividendsAccount = dividendsAccountId
    ? baselineAmounts.get(dividendsAccountId) ?? 0
    : 0;
  let runningAportesAccount = aportesAccountId
    ? baselineAmounts.get(aportesAccountId) ?? 0
    : 0;
  const runningDividendsByPartner = new Map<string, number>();
  const runningAportesByPartner = new Map<string, number>();
  partners.forEach((p) => {
    if (dividendsAccountId) {
      runningDividendsByPartner.set(
        p.id,
        baselinePartnerBreakdown.get(p.id)?.get(dividendsAccountId) ?? 0,
      );
    }
    if (aportesAccountId) {
      runningAportesByPartner.set(
        p.id,
        baselinePartnerBreakdown.get(p.id)?.get(aportesAccountId) ?? 0,
      );
    }
  });

  // Aplica historicos cujo mes de competencia e anterior ao primeiro bucket.
  historicalBeforeFirstVisible.forEach((inj) => {
    if (inj.accountId === dividendsAccountId) {
      runningDividendsByPartner.set(
        inj.partnerId,
        (runningDividendsByPartner.get(inj.partnerId) ?? 0) + inj.amount,
      );
      // Tambem soma ao running account-level para manter consistencia, mas
      // a totalizadora visivel quando showPartners=true vem da soma dos
      // partners, entao isso so importa para o fallback showPartners=false
      // (que so ocorre quando partners.length=0 — caso em que nenhum
      // historico foi enfileirado).
      runningDividendsAccount += inj.amount;
    } else if (inj.accountId === aportesAccountId) {
      runningAportesByPartner.set(
        inj.partnerId,
        (runningAportesByPartner.get(inj.partnerId) ?? 0) + inj.amount,
      );
      runningAportesAccount += inj.amount;
    }
  });

  const accDividendsByBucket: Record<string, number> = {};
  const accAportesByBucket: Record<string, number> = {};
  const accDividendsByPartnerByBucket = new Map<string, Record<string, number>>();
  const accAportesByPartnerByBucket = new Map<string, Record<string, number>>();
  partners.forEach((p) => {
    accDividendsByPartnerByBucket.set(p.id, {});
    accAportesByPartnerByBucket.set(p.id, {});
  });

  visibleBuckets.forEach((bucket) => {
    if (isFutureBucket(bucket)) {
      accDividendsByBucket[bucket.key] = 0;
      accAportesByBucket[bucket.key] = 0;
      partners.forEach((p) => {
        accDividendsByPartnerByBucket.get(p.id)![bucket.key] = 0;
        accAportesByPartnerByBucket.get(p.id)![bucket.key] = 0;
      });
      return;
    }

    // Saldos historicos pre-Omie agendados PARA ESTE bucket. Sao injetados
    // por socio (nao alteram valuesPerBucket — regra do produto: nao tocar
    // as linhas normais 4.2 / 5.1 do grid, somente acumulados).
    const bucketHistorical = historicalWithinVisibleByBucket.get(bucket.key) ?? [];
    const histDividendsByPartner = new Map<string, number>();
    const histAportesByPartner = new Map<string, number>();
    bucketHistorical.forEach((inj) => {
      if (inj.accountId === dividendsAccountId) {
        histDividendsByPartner.set(
          inj.partnerId,
          (histDividendsByPartner.get(inj.partnerId) ?? 0) + inj.amount,
        );
      } else if (inj.accountId === aportesAccountId) {
        histAportesByPartner.set(
          inj.partnerId,
          (histAportesByPartner.get(inj.partnerId) ?? 0) + inj.amount,
        );
      }
    });

    if (dividendsAccountId) {
      runningDividendsAccount +=
        valuesPerBucket.get(bucket.key)?.[dividendsAccountId] ?? 0;
      // Acumula o historico tambem no fallback account-level (so usado
      // quando showPartners=false, situacao em que nenhum historico
      // foi enfileirado, mas mantemos a soma consistente).
      histDividendsByPartner.forEach((v) => {
        runningDividendsAccount += v;
      });
    }
    if (aportesAccountId) {
      runningAportesAccount +=
        valuesPerBucket.get(bucket.key)?.[aportesAccountId] ?? 0;
      histAportesByPartner.forEach((v) => {
        runningAportesAccount += v;
      });
    }

    partners.forEach((p) => {
      if (dividendsAccountId) {
        const monthVal =
          (partnerValuesPerBucket.get(bucket.key)?.get(p.id)?.get(dividendsAccountId) ?? 0)
          + (histDividendsByPartner.get(p.id) ?? 0);
        const newRunning = (runningDividendsByPartner.get(p.id) ?? 0) + monthVal;
        runningDividendsByPartner.set(p.id, newRunning);
        accDividendsByPartnerByBucket.get(p.id)![bucket.key] = newRunning;
      }
      if (aportesAccountId) {
        const monthVal =
          (partnerValuesPerBucket.get(bucket.key)?.get(p.id)?.get(aportesAccountId) ?? 0)
          + (histAportesByPartner.get(p.id) ?? 0);
        const newRunning = (runningAportesByPartner.get(p.id) ?? 0) + monthVal;
        runningAportesByPartner.set(p.id, newRunning);
        accAportesByPartnerByBucket.get(p.id)![bucket.key] = newRunning;
      }
    });

    // Regra explicita: quando socios sao exibidos, a totalizadora e a soma
    // dos acumulados dos socios. Caso contrario, e o acumulado agregado.
    if (showPartners) {
      accDividendsByBucket[bucket.key] = Array.from(
        runningDividendsByPartner.values(),
      ).reduce((a, b) => a + b, 0);
      accAportesByBucket[bucket.key] = Array.from(
        runningAportesByPartner.values(),
      ).reduce((a, b) => a + b, 0);
    } else {
      accDividendsByBucket[bucket.key] = runningDividendsAccount;
      accAportesByBucket[bucket.key] = runningAportesAccount;
    }
  });

  const finalDividendsTotal = showPartners
    ? Array.from(runningDividendsByPartner.values()).reduce((a, b) => a + b, 0)
    : runningDividendsAccount;
  const finalAportesTotal = showPartners
    ? Array.from(runningAportesByPartner.values()).reduce((a, b) => a + b, 0)
    : runningAportesAccount;

  const buildAccountSection = (
    valuesByPartnerBucket: Map<string, Record<string, number>>,
    runningByPartner: Map<string, number>,
    totalsByBucket: Record<string, number>,
    accumulatedTotal: number,
  ): CashFlowAccumulatedAccount => ({
    totalsByBucket,
    accumulatedTotal,
    partners: showPartners
      ? partners.map((p, idx) => ({
          id: `acc-partner:${p.id}:${idx}`,
          name: p.name,
          valuesByBucket: valuesByPartnerBucket.get(p.id) ?? {},
          accumulatedTotal: runningByPartner.get(p.id) ?? 0,
        }))
      : [],
  });

  // Em modo comparativo entre empresas a tabela renderiza colunas por empresa
  // ao inves de colunas mensais — a leitura "acumulado por mes" perde sentido
  // nessa visao, entao escondemos a nova secao ali.
  const accumulatedSection: CashFlowAccumulatedSection = filter.compareCompanies
    ? EMPTY_CASH_FLOW_ACCUMULATED_SECTION
    : {
        showDividends: dividendsAccountId !== null,
        showAportes: aportesAccountId !== null,
        showPartners,
        dividends: buildAccountSection(
          accDividendsByPartnerByBucket,
          runningDividendsByPartner,
          accDividendsByBucket,
          finalDividendsTotal,
        ),
        aportes: buildAccountSection(
          accAportesByPartnerByBucket,
          runningAportesByPartner,
          accAportesByBucket,
          finalAportesTotal,
        ),
      };

  return (
    <CashFlowView
      filter={filter}
      range={range}
      rows={displayRows}
      accounts={cashFlowAccounts}
      companies={visibleCompanies}
      role={profile?.role ?? "gestor_hero"}
      visibleBuckets={visibleBuckets}
      accumulatedBucket={accumulatedBucket}
      selectedCompanyIds={filter.selectedCompanyIds}
      lastSyncAt={lastSyncAt}
      accumulatedSection={accumulatedSection}
      segments={segments}
      activeSegmentSlug={activeSegmentSlug}
    />
  );
}
