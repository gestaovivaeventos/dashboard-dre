import { redirect } from "next/navigation";

import { BudgetForecastView } from "@/components/app/budget-forecast-view";
import { getCurrentSessionContext } from "@/lib/auth/session";
import { readActiveCompanyIds, readActiveSegmentSlug } from "@/lib/context/active-context";
import { resolveUserSegments } from "@/lib/context/user-segments";

export const dynamic = "force-dynamic";
import {
  buildAccumulatedBucket,
  buildDashboardRows,
  buildDateRange,
  buildFilterState,
  buildVisibleBuckets,
  fetchAllDreAccountRows,
  scopeDreAccounts,
  resolveAllowedCompanyIds,
  type DreAccountBase,
  type DashboardPeriodBucket,
} from "@/lib/dashboard/dre";

type ViewTab = "orcamento" | "realizado" | "projecao" | "comparativo";

interface BudgetForecastPageProps {
  searchParams: Record<string, string | string[] | undefined>;
  params?: { segmentSlug?: string };
}

interface BudgetForecastDisplayRow extends DreAccountBase {
  hasChildren: boolean;
  percentageOverNetRevenue: number;
  valuesByBucket: Record<string, number>;
  accumulatedValue: number;
  budgetValue?: number;
  realizedValue?: number;
  budgetByBucket?: Record<string, number>;
  accumulatedBudget?: number;
  valuesByCompany?: Record<string, number>;
  budgetByCompany?: Record<string, number>;
}

function parseView(value: string | string[] | undefined): ViewTab {
  const v = Array.isArray(value) ? value[0] : value;
  if (v === "realizado" || v === "projecao" || v === "comparativo") return v;
  return "orcamento";
}

function parseSubView(value: string | string[] | undefined): string {
  const v = Array.isArray(value) ? value[0] : value;
  return v ?? "";
}

export default async function BudgetForecastPage({ searchParams, params }: BudgetForecastPageProps) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user) {
    redirect("/login");
  }

  const view = parseView(searchParams.view);
  const subViewRaw = parseSubView(searchParams.subView);
  // Apply per-view defaults: realizado defaults to "consolidado", comparativo
  // defaults to "orcamento", others ignore the field.
  const subView = subViewRaw
    || (view === "realizado"
      ? "consolidado"
      : view === "comparativo"
        ? "orcamento"
        : "");

  // Load all segments the user can access (for the SegmentCompanyPicker).
  // Mesmo carregamento usado em dashboard/page.tsx (com fallback por empresa).
  const segments = await resolveUserSegments(supabase, {
    isAdmin: profile?.role === "admin",
    userId: profile?.id ?? null,
    companyIds: profile?.company_ids ?? [],
  });

  // URL `/s/<slug>/budget-forecast` traz pelo params; `/budget-forecast` (sem
  // segmento) recorre ao cookie `active_segment_slug` ou ao primeiro segmento
  // disponível ao usuário.
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
  // vez de carregar TODAS as contas de TODAS as empresas do sistema. O scope
  // abaixo so usa o plano global e, no maximo, o da unica empresa selecionada
  // — que sempre pertence a este segmento —, entao o resultado e identico,
  // porem a consulta fica muito menor (ganho relevante em segmentos com muitas
  // empresas, como franquias-viva). Paginado por causa do cap de 1000 do
  // PostgREST (ver fetchAllDreAccountRows).
  const scopeCompanyIds = companies.map((c) => c.id);
  const accountsData = await fetchAllDreAccountRows<
    DreAccountBase & { company_id: string | null }
  >((from, to) => {
    let query = supabase
      .from("dre_accounts")
      .select("id,code,name,parent_id,level,type,is_summary,formula,sort_order,active,company_id")
      .eq("active", true);
    if (segmentId) {
      query =
        scopeCompanyIds.length > 0
          ? query.or(`company_id.is.null,company_id.in.(${scopeCompanyIds.join(",")})`)
          : query.is("company_id", null);
    }
    return query.order("code").range(from, to);
  });
  const allowedCompanyIds = await resolveAllowedCompanyIds(
    supabase,
    profile,
    companies.map((company) => company.id),
  );

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

  if (filter.selectedCompanyIds.length === 0) {
    return (
      <BudgetForecastView
        view={view}
        subView={subView}
        filter={filter}
        range={{ dateFrom: "", dateTo: "", label: "" }}
        rows={[]}
        companies={visibleCompanies}
        role={profile?.role ?? "gestor_hero"}
        visibleBuckets={[]}
        accumulatedBucket={{ key: "", label: "", dateFrom: "", dateTo: "" }}
        selectedCompanyIds={[]}
        currentMonthIndex={-1}
        segments={segments}
        activeSegmentSlug={activeSegmentSlug}
      />
    );
  }

  const range = buildDateRange(filter);

  // Escopo + tradutor de ids do plano DRE: USA o MESMO helper do Dashboard DRE
  // (scopeDreAccounts). Alem de escolher o plano custom da empresa (ou o global),
  // ele expoe `translateToScopedId`, que converte o id cru devolvido pelos RPCs
  // (que pode ser do plano global) para o id de mesmo CODIGO no plano custom.
  // Sem essa traducao, contas cujo mapeamento aponta para um id global eram
  // ZERADAS no Budget (Realizado divergia do DRE) — exatamente o bug relatado
  // na Village (ex.: "Clientes - Servicos Prestados").
  const scope = scopeDreAccounts(accountsData, filter.selectedCompanyIds);
  const accounts = scope.coreAccounts;
  const visibleBuckets = buildVisibleBuckets(filter);

  // Periodo invalido (ex.: customizado com inicio > fim) gera zero buckets.
  // Sem este guard, as agregacoes rodariam com datas vazias e a pagina
  // quebraria. Renderiza o estado vazio em vez de 500.
  if (visibleBuckets.length === 0) {
    return (
      <BudgetForecastView
        view={view}
        subView={subView}
        filter={filter}
        range={range}
        rows={[]}
        companies={visibleCompanies}
        role={profile?.role ?? "gestor_hero"}
        visibleBuckets={[]}
        accumulatedBucket={{ key: "", label: "", dateFrom: "", dateTo: "" }}
        selectedCompanyIds={filter.selectedCompanyIds}
        currentMonthIndex={-1}
        segments={segments}
        activeSegmentSlug={activeSegmentSlug}
      />
    );
  }

  const accumulatedBucket = buildAccumulatedBucket(visibleBuckets);

  const aggregateRealizedBucket = async (bucket: DashboardPeriodBucket) => {
    const { data, error } = await supabase.rpc("dashboard_dre_aggregate", {
      p_company_ids: filter.selectedCompanyIds,
      p_date_from: bucket.dateFrom,
      p_date_to: bucket.dateTo,
    });
    if (error) {
      throw new Error(`Falha ao carregar agregados DRE: ${error.message}`);
    }
    const amounts = new Map<string, number>();
    ((data as Array<{ dre_account_id: string; amount: number | string | null }> | null) ?? []).forEach((item) => {
      const scopedId = scope.translateToScopedId(item.dre_account_id);
      if (!scopedId) return;
      amounts.set(scopedId, (amounts.get(scopedId) ?? 0) + Number(item.amount ?? 0));
    });
    return buildDashboardRows(accounts, amounts).rows;
  };

  const aggregateBudgetBucket = async (bucket: DashboardPeriodBucket) => {
    const { data, error } = await supabase.rpc("budget_aggregate", {
      p_company_ids: filter.selectedCompanyIds,
      p_date_from: bucket.dateFrom,
      p_date_to: bucket.dateTo,
    });
    if (error) {
      throw new Error(`Falha ao carregar agregados de orcamento: ${error.message}`);
    }
    const amounts = new Map<string, number>();
    ((data as Array<{ dre_account_id: string; amount: number | string | null }> | null) ?? []).forEach((item) => {
      const scopedId = scope.translateToScopedId(item.dre_account_id);
      if (!scopedId) return;
      amounts.set(scopedId, (amounts.get(scopedId) ?? 0) + Number(item.amount ?? 0));
    });
    return buildDashboardRows(accounts, amounts).rows;
  };

  const zeroRows = buildDashboardRows(accounts, new Map()).rows;

  const now = new Date();
  const currentMonth = now.getUTCMonth() + 1;
  const currentYear = now.getUTCFullYear();

  // Compute the FIRST bucket that should be rendered as "Orcamento" in the
  // Projecao view. O mes atual ja conta como Realizado (o filtro de
  // realizedBuckets/budgetBuckets usa `<= currentMonth` / `> currentMonth`),
  // entao o split visual (e o highlight em laranja com sufixo "(Orc)") deve
  // comecar a partir de `currentMonth + 1`. -1 quando nenhum bucket cai no
  // orcamento (ex.: estamos olhando um ano inteiro no passado).
  const currentMonthIndex = visibleBuckets.findIndex((b) => {
    const [yStr, mStr] = b.key.replace("m-", "").split("-");
    const y = Number(yStr);
    const m = Number(mStr);
    return y > currentYear || (y === currentYear && m > currentMonth);
  });

  let displayRows: BudgetForecastDisplayRow[] = [];

  if (view === "orcamento") {
    // Annual budget: monthly columns + total
    const [bucketRows, accumulatedRows] = await Promise.all([
      Promise.all(visibleBuckets.map((bucket) => aggregateBudgetBucket(bucket))),
      aggregateBudgetBucket(accumulatedBucket),
    ]);

    const valuesPerBucket = new Map<string, Record<string, number>>();
    visibleBuckets.forEach((bucket, index) => {
      const byRowId: Record<string, number> = {};
      bucketRows[index].forEach((row) => {
        byRowId[row.id] = row.value;
      });
      valuesPerBucket.set(bucket.key, byRowId);
    });

    const accumulatedMap: Record<string, number> = {};
    accumulatedRows.forEach((row) => {
      accumulatedMap[row.id] = row.value;
    });

    displayRows = zeroRows.map((row) => {
      const valuesByBucket: Record<string, number> = {};
      visibleBuckets.forEach((bucket) => {
        valuesByBucket[bucket.key] = valuesPerBucket.get(bucket.key)?.[row.id] ?? 0;
      });
      return {
        ...row,
        valuesByBucket,
        accumulatedValue: accumulatedMap[row.id] ?? 0,
      } satisfies BudgetForecastDisplayRow;
    });
  } else if (view === "realizado") {
    if (subView === "mensal") {
      // Per-month Previsto x Realizado x Var%
      // When periodMode=ano_atual, cap to current month (Jan to current).
      const monthlyBuckets =
        filter.periodMode === "ano_atual"
          ? visibleBuckets.filter((b) => {
              const [yStr, mStr] = b.key.replace("m-", "").split("-");
              const y = Number(yStr);
              const m = Number(mStr);
              return y < currentYear || (y === currentYear && m <= currentMonth);
            })
          : visibleBuckets;

      const [realizedRowsByBucket, budgetRowsByBucket] = await Promise.all([
        Promise.all(monthlyBuckets.map((b) => aggregateRealizedBucket(b))),
        Promise.all(monthlyBuckets.map((b) => aggregateBudgetBucket(b))),
      ]);

      const realizedPerBucket = new Map<string, Record<string, number>>();
      const budgetPerBucket = new Map<string, Record<string, number>>();
      monthlyBuckets.forEach((bucket, index) => {
        const realMap: Record<string, number> = {};
        realizedRowsByBucket[index].forEach((row) => { realMap[row.id] = row.value; });
        realizedPerBucket.set(bucket.key, realMap);
        const budMap: Record<string, number> = {};
        budgetRowsByBucket[index].forEach((row) => { budMap[row.id] = row.value; });
        budgetPerBucket.set(bucket.key, budMap);
      });

      displayRows = zeroRows.map((row) => {
        const valuesByBucket: Record<string, number> = {};
        const budgetByBucket: Record<string, number> = {};
        let accReal = 0;
        let accBudget = 0;
        monthlyBuckets.forEach((bucket) => {
          const r = realizedPerBucket.get(bucket.key)?.[row.id] ?? 0;
          const b = budgetPerBucket.get(bucket.key)?.[row.id] ?? 0;
          valuesByBucket[bucket.key] = r;
          budgetByBucket[bucket.key] = b;
          accReal += r;
          accBudget += b;
        });
        return {
          ...row,
          valuesByBucket,
          budgetByBucket,
          accumulatedValue: accReal,
          accumulatedBudget: accBudget,
          realizedValue: accReal,
          budgetValue: accBudget,
        } satisfies BudgetForecastDisplayRow;
      });

      // Override visibleBuckets/accumulatedBucket so the view renders monthly columns.
      const effectiveAccumulated = monthlyBuckets.length > 0
        ? buildAccumulatedBucket(monthlyBuckets)
        : accumulatedBucket;

      return (
        <BudgetForecastView
          view={view}
          subView={subView}
          filter={filter}
          range={range}
          rows={displayRows}
          companies={visibleCompanies}
          role={profile?.role ?? "gestor_hero"}
          visibleBuckets={monthlyBuckets}
          accumulatedBucket={effectiveAccumulated}
          selectedCompanyIds={filter.selectedCompanyIds}
          currentMonthIndex={currentMonthIndex}
          segments={segments}
          activeSegmentSlug={activeSegmentSlug}
        />
      );
    }

    // Consolidado: aggregated period
    let budgetDateTo = accumulatedBucket.dateTo;
    if (filter.periodMode === "ano_atual") {
      const lastDay = new Date(Date.UTC(currentYear, currentMonth, 0));
      budgetDateTo = lastDay.toISOString().slice(0, 10);
    }
    const cappedBudgetBucket: DashboardPeriodBucket = {
      ...accumulatedBucket,
      dateTo: budgetDateTo,
    };

    const [realizedRows, budgetRows] = await Promise.all([
      aggregateRealizedBucket(accumulatedBucket),
      aggregateBudgetBucket(cappedBudgetBucket),
    ]);

    const realizedMap: Record<string, number> = {};
    realizedRows.forEach((row) => { realizedMap[row.id] = row.value; });
    const budgetMap: Record<string, number> = {};
    budgetRows.forEach((row) => { budgetMap[row.id] = row.value; });

    displayRows = zeroRows.map((row) => ({
      ...row,
      valuesByBucket: {},
      accumulatedValue: realizedMap[row.id] ?? 0,
      realizedValue: realizedMap[row.id] ?? 0,
      budgetValue: budgetMap[row.id] ?? 0,
    } satisfies BudgetForecastDisplayRow));
  } else if (view === "comparativo") {
    // Comparativo: always consolidated (no monthly drill); columns per company.
    // sub-view: "realizado" -> Previsto x Realizado per company; default -> Orcamento Anual per company
    const compareSub = subView === "realizado" ? "realizado" : "orcamento";

    // Cap budget at current month for ano_atual to mirror the per-company realizado window
    let cmpBudgetDateTo = accumulatedBucket.dateTo;
    if (filter.periodMode === "ano_atual" && compareSub === "realizado") {
      const lastDay = new Date(Date.UTC(currentYear, currentMonth, 0));
      cmpBudgetDateTo = lastDay.toISOString().slice(0, 10);
    }

    // Per-company budget aggregation: loop one RPC call per company.
    const budgetByCompanyAggregates = await Promise.all(
      filter.selectedCompanyIds.map(async (companyId) => {
        const { data, error } = await supabase.rpc("budget_aggregate", {
          p_company_ids: [companyId],
          p_date_from: accumulatedBucket.dateFrom,
          p_date_to: cmpBudgetDateTo,
        });
        if (error) throw new Error(`Falha ao carregar orcamento por empresa: ${error.message}`);
        const amounts = new Map<string, number>();
        ((data as Array<{ dre_account_id: string; amount: number | string | null }> | null) ?? []).forEach((item) => {
          const scopedId = scope.translateToScopedId(item.dre_account_id);
          if (!scopedId) return;
          amounts.set(scopedId, (amounts.get(scopedId) ?? 0) + Number(item.amount ?? 0));
        });
        return { companyId, rows: buildDashboardRows(accounts, amounts).rows };
      }),
    );

    const budgetByCompany: Record<string, Record<string, number>> = {};
    budgetByCompanyAggregates.forEach(({ companyId, rows }) => {
      const byId: Record<string, number> = {};
      rows.forEach((r) => { byId[r.id] = r.value; });
      budgetByCompany[companyId] = byId;
    });

    // For "realizado" sub-view, also fetch per-company realized totals.
    const realizedByCompany: Record<string, Record<string, number>> = {};
    if (compareSub === "realizado") {
      const { data: byCompanyData, error: byCompanyErr } = await supabase.rpc(
        "dashboard_dre_aggregate_by_company",
        {
          p_company_ids: filter.selectedCompanyIds,
          p_date_from: accumulatedBucket.dateFrom,
          p_date_to: accumulatedBucket.dateTo,
        },
      );
      if (byCompanyErr) {
        throw new Error(`Falha ao carregar realizado por empresa: ${byCompanyErr.message}`);
      }

      const amountsByCompanyId = new Map<string, Map<string, number>>();
      ((byCompanyData as Array<{
        company_id: string;
        dre_account_id: string;
        amount: number | string | null;
      }> | null) ?? []).forEach((item) => {
        const scopedId = scope.translateToScopedId(item.dre_account_id);
        if (!scopedId) return;
        let map = amountsByCompanyId.get(item.company_id);
        if (!map) {
          map = new Map();
          amountsByCompanyId.set(item.company_id, map);
        }
        map.set(scopedId, (map.get(scopedId) ?? 0) + Number(item.amount ?? 0));
      });

      for (const companyId of filter.selectedCompanyIds) {
        const companyAmounts = amountsByCompanyId.get(companyId) ?? new Map();
        const companyRows = buildDashboardRows(accounts, companyAmounts).rows;
        const byId: Record<string, number> = {};
        companyRows.forEach((r) => { byId[r.id] = r.value; });
        realizedByCompany[companyId] = byId;
      }
    }

    displayRows = zeroRows.map((row) => {
      const valuesByCompany: Record<string, number> = {};
      const budgetMap: Record<string, number> = {};
      filter.selectedCompanyIds.forEach((companyId) => {
        budgetMap[companyId] = budgetByCompany[companyId]?.[row.id] ?? 0;
        if (compareSub === "realizado") {
          valuesByCompany[companyId] = realizedByCompany[companyId]?.[row.id] ?? 0;
        }
      });
      return {
        ...row,
        valuesByBucket: {},
        accumulatedValue: 0,
        valuesByCompany: compareSub === "realizado" ? valuesByCompany : undefined,
        budgetByCompany: budgetMap,
      } satisfies BudgetForecastDisplayRow;
    });
  } else {
    // Projecao: months <= current = realized, months > current = budget
    const realizedBuckets = visibleBuckets.filter((b) => {
      const [yStr, mStr] = b.key.replace("m-", "").split("-");
      const y = Number(yStr);
      const m = Number(mStr);
      return y < currentYear || (y === currentYear && m <= currentMonth);
    });
    const budgetBuckets = visibleBuckets.filter((b) => {
      const [yStr, mStr] = b.key.replace("m-", "").split("-");
      const y = Number(yStr);
      const m = Number(mStr);
      return y > currentYear || (y === currentYear && m > currentMonth);
    });

    const [realizedRowsByBucket, budgetRowsByBucket] = await Promise.all([
      Promise.all(realizedBuckets.map((b) => aggregateRealizedBucket(b))),
      Promise.all(budgetBuckets.map((b) => aggregateBudgetBucket(b))),
    ]);

    const valuesPerBucket = new Map<string, Record<string, number>>();
    realizedBuckets.forEach((bucket, index) => {
      const byRowId: Record<string, number> = {};
      realizedRowsByBucket[index].forEach((row) => { byRowId[row.id] = row.value; });
      valuesPerBucket.set(bucket.key, byRowId);
    });
    budgetBuckets.forEach((bucket, index) => {
      const byRowId: Record<string, number> = {};
      budgetRowsByBucket[index].forEach((row) => { byRowId[row.id] = row.value; });
      valuesPerBucket.set(bucket.key, byRowId);
    });

    displayRows = zeroRows.map((row) => {
      const valuesByBucket: Record<string, number> = {};
      let accumulated = 0;
      visibleBuckets.forEach((bucket) => {
        const v = valuesPerBucket.get(bucket.key)?.[row.id] ?? 0;
        valuesByBucket[bucket.key] = v;
        accumulated += v;
      });
      return {
        ...row,
        valuesByBucket,
        accumulatedValue: accumulated,
      } satisfies BudgetForecastDisplayRow;
    });
  }

  return (
    <BudgetForecastView
      view={view}
      subView={subView}
      filter={filter}
      range={range}
      rows={displayRows}
      companies={visibleCompanies}
      role={profile?.role ?? "gestor_hero"}
      visibleBuckets={visibleBuckets}
      accumulatedBucket={accumulatedBucket}
      selectedCompanyIds={filter.selectedCompanyIds}
      currentMonthIndex={currentMonthIndex}
      segments={segments}
      activeSegmentSlug={activeSegmentSlug}
    />
  );
}
