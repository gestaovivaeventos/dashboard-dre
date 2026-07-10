import { redirect } from "next/navigation";

import { DashboardDreView } from "@/components/app/dashboard-dre-view";
import { getCurrentSessionContext } from "@/lib/auth/session";
import { getManagerialAmountsByCode } from "@/lib/dashboard/managerial-adjustments";
import { resolveFranquiasVivaCustosNegation } from "@/lib/dashboard/franquias-viva-custos";
import { SIRENA_COMPANY_NAME, applySirenaCalculatedTaxes } from "@/lib/dashboard/sirena-taxes";
import {
  applyPeriodFloor,
  resolveCompanyPeriodFloor,
} from "@/lib/dashboard/company-period-limits";
import { readActiveCompanyIds, readActiveSegmentSlug } from "@/lib/context/active-context";
import { resolveUserSegments } from "@/lib/context/user-segments";

export const dynamic = "force-dynamic";
import {
  SCOPED_DRE_ACCOUNTS_SELECT,
  aggregateDreMonthlyScopedAmounts,
  aggregateDreRowsByCompany,
  buildAccumulatedBucket,
  buildDashboardRows,
  buildDateRange,
  buildFilterState,
  buildVisibleBuckets,
  fetchAllDreAccountRows,
  scopeDreAccounts,
  resolveAllowedCompanyIds,
  type DreAccountBase,
  type RawDreAccount,
} from "@/lib/dashboard/dre";

interface DashboardPageProps {
  searchParams: Record<string, string | string[] | undefined>;
  params?: { segmentSlug?: string };
}

interface DashboardDisplayRow extends DreAccountBase {
  hasChildren: boolean;
  percentageOverNetRevenue: number;
  valuesByBucket: Record<string, number>;
  accumulatedValue: number;
  valuesByCompany?: Record<string, number>;
}

export default async function DashboardPage({ searchParams, params }: DashboardPageProps) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user) {
    redirect("/login");
  }

  // Load all segments the user can access (for the picker). Inclui o fallback
  // por empresa — sem ele, usuário com acesso só por empresa carrega TODAS as
  // empresas e a agregação estoura o statement_timeout (ver resolveUserSegments).
  const segments = await resolveUserSegments(supabase, {
    isAdmin: profile?.role === "admin",
    userId: profile?.id ?? null,
    companyIds: profile?.company_ids ?? [],
  });

  // Resolve segment filter. Quando a URL é `/s/<slug>/dashboard`, vem por
  // `params`; quando é `/dashboard` (default landing pós-login), caímos no
  // cookie `active_segment_slug` mantido pelo SegmentCompanyPicker. Sem esse
  // fallback, o picker mostra um segmento ativo mas a query não filtra
  // companies por segment_id e empresas de outros segmentos aparecem.
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

  const { data: companiesData } = await companiesQuery.order("name");

  const companies = (companiesData ?? []).map((company) => ({
    id: company.id as string,
    name: company.name as string,
  }));

  // Escopa a busca do plano DRE ao segmento (global + empresas do segmento) em
  // vez de carregar TODAS as contas de TODAS as empresas. scopeDreAccounts so
  // usa o plano global e, no maximo, o da unica empresa selecionada (sempre
  // deste segmento) — resultado identico, consulta bem menor. Paginado por
  // causa do cap de 1000 do PostgREST (ver fetchAllDreAccountRows).
  const scopeCompanyIds = companies.map((c) => c.id);
  const accountsData = await fetchAllDreAccountRows<RawDreAccount>((from, to) => {
    let query = supabase
      .from("dre_accounts")
      .select(SCOPED_DRE_ACCOUNTS_SELECT)
      .eq("active", true);
    if (segmentId) {
      query =
        scopeCompanyIds.length > 0
          ? query.or(`company_id.is.null,company_id.in.(${scopeCompanyIds.join(",")})`)
          : query.is("company_id", null);
    }
    // .order("id"): desempate único → paginação por range estável (ver fetchAllDreAccountRows)
    return query.order("code").order("id").range(from, to);
  });
  const allowedCompanyIds = await resolveAllowedCompanyIds(
    supabase,
    profile,
    companies.map((company) => company.id),
  );

  // Filter the companies list to only show allowed ones
  const visibleCompanies = profile?.role === "admin"
    ? companies
    : companies.filter((c) => allowedCompanyIds.includes(c.id));

  const filter = buildFilterState(searchParams, allowedCompanyIds);
  // Filtro de empresa compartilhado entre Dashboard/Fluxo/Budget: quando a URL
  // nao traz companyIds, herda a ultima selecao do cookie (fonte de verdade no
  // servidor). Validado contra allowedCompanyIds — ja escopado por segmento e
  // por acesso do usuario, entao nao vaza empresa entre segmentos nem usuarios.
  if (!searchParams.companyIds) {
    const cookieCompanyIds = (await readActiveCompanyIds()).filter((id) =>
      allowedCompanyIds.includes(id),
    );
    if (cookieCompanyIds.length > 0) {
      filter.selectedCompanyIds = cookieCompanyIds;
    }
  }
  if (profile?.role !== "admin") {
    filter.selectedCompanyIds = allowedCompanyIds.length > 0
      ? filter.selectedCompanyIds.filter((id) => allowedCompanyIds.includes(id))
      : allowedCompanyIds;
    if (filter.selectedCompanyIds.length === 0) {
      filter.selectedCompanyIds = allowedCompanyIds;
    }
  }

  // Limite de período por empresa (ex.: Sirena exibe apenas 2026+). Aplica-se
  // SÓ quando a empresa-piso é a ÚNICA selecionada — não afeta a Feat Produções
  // (que alimenta a Sirena via departamento), o consolidado nem outra empresa.
  // É um corte de visualização: eleva o início do período ao ano-piso e, quando
  // todo o intervalo pedido está abaixo do piso, sinaliza estado vazio. Não
  // apaga nem altera dados. Ver src/lib/dashboard/company-period-limits.ts.
  const periodFloor = resolveCompanyPeriodFloor(filter.selectedCompanyIds, companies);
  const { isEmpty: periodOutsideFloor } = applyPeriodFloor(filter, periodFloor);

  // If no companies selected, render empty state
  if (filter.selectedCompanyIds.length === 0 || periodOutsideFloor) {
    return (
      <DashboardDreView
        filter={filter}
        range={{ dateFrom: "", dateTo: "", label: "" }}
        rows={[]}
        companies={visibleCompanies}
        role={profile?.role ?? "gestor_hero"}
        visibleBuckets={[]}
        accumulatedBucket={{ key: "", label: "", dateFrom: "", dateTo: "" }}
        selectedCompanyIds={[]}
        lastSyncAt={null}
        segments={segments}
        activeSegmentSlug={activeSegmentSlug}
      />
    );
  }

  const { data: lastSyncAtRaw } = await supabase.rpc(
    "dashboard_last_successful_sync",
    { p_company_ids: filter.selectedCompanyIds },
  );
  const lastSyncAt =
    typeof lastSyncAtRaw === "string" ? lastSyncAtRaw : null;

  const range = buildDateRange(filter);

  // Escopo + tradutor de ids do plano DRE — centralizados em
  // src/lib/dashboard/dre.ts para que Fluxo de Caixa e demais consumidores
  // reusem EXATAMENTE a mesma lógica e o valor de "Resultado do Exercício"
  // não divirja entre telas (ver comentário do bloco em dre.ts).
  const scope = scopeDreAccounts(
    accountsData,
    filter.selectedCompanyIds,
  );
  const accounts = scope.coreAccounts;
  // Franquias Viva: "Receitas Ressarciveis - Fundos" (5.8) é uma RECEITA dentro
  // do grupo de custos (5). Subtrai do total do grupo em vez de somar, sem
  // alterar a estrutura DRE nem o valor exibido na própria linha. Inerte para
  // outros segmentos. Ver src/lib/dashboard/franquias-viva-custos.ts.
  const custosNegation = resolveFranquiasVivaCustosNegation(activeSegmentSlug, accounts);
  const visibleBuckets = buildVisibleBuckets(filter);
  const accumulatedBucket = buildAccumulatedBucket(visibleBuckets);

  // Impostos calculados da Sirena: só quando a ÚNICA empresa selecionada é a
  // Sirena (mesma regra de escopo do plano custom). Nesse caso o `scope` é o
  // plano custom da Sirena e o hook calcula ISS/PIS/COFINS/IRPJ/Contrib. Social
  // a partir de "Receita de Estacionamento" (Omie) + "Locação de Espaço"
  // (planilha) de cada período. Demais empresas/consolidado: hook não é passado
  // (comportamento idêntico ao anterior). Ver src/lib/dashboard/sirena-taxes.ts.
  const isSingleSirena =
    filter.selectedCompanyIds.length === 1 &&
    companies.some(
      (c) =>
        c.id === filter.selectedCompanyIds[0] &&
        c.name.trim().toLowerCase() === SIRENA_COMPANY_NAME.toLowerCase(),
    );

  // UMA chamada traz os agregados de TODOS os meses do intervalo (antes era uma
  // chamada de dashboard_dre_aggregate por mês + acumulado = até 13 round-trips
  // concorrentes por load, que pressionavam o pooler de conexões e derrubavam a
  // página sob carga). Os buckets mensais e o acumulado são montados a partir
  // deste resultado.
  const monthlyScoped = await aggregateDreMonthlyScopedAmounts({
    supabase,
    scope,
    companyIds: filter.selectedCompanyIds,
    dateFrom: accumulatedBucket.dateFrom,
    dateTo: accumulatedBucket.dateTo,
  });

  const scopedIdByCode = new Map(
    scope.scopedAccounts.map((account) => [account.code, account.id]),
  );

  // Monta as linhas do DRE de um bucket a partir do mapa base (scopedId ->
  // amount) reproduzindo EXATAMENTE o pipeline de aggregateDreRows: soma os
  // ajustes gerenciais do período, aplica o postProcess (impostos Sirena) e
  // chama buildDashboardRows com a negação de custos (franquias-viva). Só muda a
  // ORIGEM do mapa base — mês pré-carregado em vez de um RPC por mês.
  const buildBucketRows = (
    baseAmounts: Map<string, number>,
    dateFrom: string,
    dateTo: string,
  ) => {
    const amounts = new Map(baseAmounts);
    const extra = getManagerialAmountsByCode(
      filter.selectedCompanyIds,
      dateFrom,
      dateTo,
    );
    extra.forEach((amount, code) => {
      const scopedId = scopedIdByCode.get(code);
      if (!scopedId) return;
      amounts.set(scopedId, (amounts.get(scopedId) ?? 0) + amount);
    });
    if (isSingleSirena) {
      applySirenaCalculatedTaxes(scope.scopedAccounts, amounts);
    }
    return buildDashboardRows(accounts, amounts, {
      negateChildCodesInSummary: custosNegation,
    }).rows;
  };

  const valuesPerBucket = new Map<string, Record<string, number>>();
  visibleBuckets.forEach((bucket) => {
    // year-month derivado do dateFrom (YYYY-MM-01) para casar a chave do RPC
    // ("${year}-${month}", month 1-based sem zero à esquerda).
    const [y, m] = bucket.dateFrom.split("-");
    const monthMap =
      monthlyScoped.get(`${Number(y)}-${Number(m)}`) ?? new Map<string, number>();
    const byRowId: Record<string, number> = {};
    buildBucketRows(monthMap, bucket.dateFrom, bucket.dateTo).forEach((row) => {
      byRowId[row.id] = row.value;
    });
    valuesPerBucket.set(bucket.key, byRowId);
  });

  // Acumulado = soma de todos os meses do intervalo (fórmulas lineares ⇒
  // idêntico a agregar o range inteiro; o postProcess roda UMA vez sobre a soma,
  // exatamente como o aggregateBucket(accumulatedBucket) anterior).
  const accumulatedBaseAmounts = new Map<string, number>();
  monthlyScoped.forEach((monthMap) => {
    monthMap.forEach((value, scopedId) => {
      accumulatedBaseAmounts.set(
        scopedId,
        (accumulatedBaseAmounts.get(scopedId) ?? 0) + value,
      );
    });
  });
  const accumulatedMap: Record<string, number> = {};
  buildBucketRows(
    accumulatedBaseAmounts,
    accumulatedBucket.dateFrom,
    accumulatedBucket.dateTo,
  ).forEach((row) => {
    accumulatedMap[row.id] = row.value;
  });

  const zeroRows = buildDashboardRows(accounts, new Map(), {
    negateChildCodesInSummary: custosNegation,
  }).rows;

  // Fetch per-company data for comparative mode. Reaproveita o helper
  // centralizado para garantir que as linhas (incluindo Resultado do
  // Exercício) sigam a mesma regra de cálculo do consolidado.
  const companyValuesMap: Record<string, Record<string, number>> = {};
  if (filter.compareCompanies && filter.selectedCompanyIds.length > 1) {
    const rowsByCompany = await aggregateDreRowsByCompany({
      supabase,
      scope,
      companyIds: filter.selectedCompanyIds,
      dateFrom: accumulatedBucket.dateFrom,
      dateTo: accumulatedBucket.dateTo,
      negateChildCodesInSummary: custosNegation,
    });
    rowsByCompany.forEach((companyRows, companyId) => {
      const byId: Record<string, number> = {};
      companyRows.forEach((r) => { byId[r.id] = r.value; });
      companyValuesMap[companyId] = byId;
    });
  }

  const displayRows = zeroRows.map((row) => {
    const valuesByBucket: Record<string, number> = {};
    visibleBuckets.forEach((bucket) => {
      valuesByBucket[bucket.key] = valuesPerBucket.get(bucket.key)?.[row.id] ?? 0;
    });

    const valuesByCompany: Record<string, number> = {};
    if (filter.compareCompanies) {
      for (const companyId of filter.selectedCompanyIds) {
        valuesByCompany[companyId] = companyValuesMap[companyId]?.[row.id] ?? 0;
      }
    }

    return {
      ...row,
      valuesByBucket,
      accumulatedValue: accumulatedMap[row.id] ?? 0,
      valuesByCompany: filter.compareCompanies ? valuesByCompany : undefined,
    } satisfies DashboardDisplayRow;
  });

  return (
    <DashboardDreView
      filter={filter}
      range={range}
      rows={displayRows}
      companies={visibleCompanies}
      role={profile?.role ?? "gestor_hero"}
      visibleBuckets={visibleBuckets}
      accumulatedBucket={accumulatedBucket}
      selectedCompanyIds={filter.selectedCompanyIds}
      lastSyncAt={lastSyncAt}
      segments={segments}
      activeSegmentSlug={activeSegmentSlug}
    />
  );
}
