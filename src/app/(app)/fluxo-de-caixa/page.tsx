import { redirect } from "next/navigation";

import { CashFlowView } from "@/components/app/cash-flow-view";
import { getCurrentSessionContext } from "@/lib/auth/session";
import {
  buildDashboardRows,
  filterCoreDreAccounts,
  type DreAccountBase,
} from "@/lib/dashboard/dre";
import {
  buildCashFlowAccumulatedBucket,
  buildCashFlowBuckets,
  buildCashFlowDateRange,
  buildCashFlowFilterState,
  buildCashFlowRows,
  resolveAllowedCompanyIds,
  type CashFlowAccountBase,
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

  // Resolve segment filter (mesma logica do dashboard DRE).
  let segmentId: string | null = null;
  if (params?.segmentSlug) {
    const { data: seg } = await supabase
      .from("segments")
      .select("id")
      .eq("slug", params.segmentSlug)
      .eq("active", true)
      .maybeSingle<{ id: string }>();
    segmentId = seg?.id ?? null;
  }

  let companiesQuery = supabase.from("companies").select("id,name,active").eq("active", true);
  if (segmentId) {
    companiesQuery = companiesQuery.eq("segment_id", segmentId);
  }

  const [{ data: companiesData }, { data: cashFlowAccountsData }, { data: dreAccountsData }] = await Promise.all([
    companiesQuery.order("name"),
    supabase
      .from("cash_flow_accounts")
      .select("id,code,name,parent_id,level,type,is_summary,formula,source,is_highlight_block,sort_order,active")
      .eq("active", true)
      .order("sort_order"),
    supabase
      .from("dre_accounts")
      .select("id,code,name,parent_id,level,type,is_summary,formula,sort_order,active")
      .eq("active", true)
      .order("code"),
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

  const cashFlowAccounts = (cashFlowAccountsData ?? []) as CashFlowAccountBase[];
  const dreAccounts = filterCoreDreAccounts((dreAccountsData ?? []) as DreAccountBase[]);

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

  // Helper: agrega DRE no periodo e devolve o valor da linha "Resultado do Exercicio" (code 11).
  const computeDreResultado = async (bucket: CashFlowPeriodBucket): Promise<number> => {
    const { data } = await supabase.rpc("dashboard_dre_aggregate", {
      p_company_ids: filter.selectedCompanyIds,
      p_date_from: bucket.dateFrom,
      p_date_to: bucket.dateTo,
    });
    const amounts = new Map<string, number>();
    (data as Array<{ dre_account_id: string; amount: number | string | null }> | null ?? []).forEach((item) => {
      amounts.set(item.dre_account_id, Number(item.amount ?? 0));
    });
    const dreRows = buildDashboardRows(dreAccounts, amounts).rows;
    const resultado = dreRows.find((r) => r.code === "11");
    return resultado?.value ?? 0;
  };

  // Helper: agrega cash flow no periodo e devolve mapa accountId -> amount.
  const computeCashFlowAmounts = async (bucket: CashFlowPeriodBucket): Promise<Map<string, number>> => {
    const { data, error } = await supabase.rpc("cash_flow_aggregate", {
      p_company_ids: filter.selectedCompanyIds,
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

  type PartnerRow = { id: string; name: string; sort_order: number };
  let partners: PartnerRow[] = [];
  if (singleCompanyId) {
    const { data: partnersData } = await supabase
      .from("company_partners")
      .select("id, name, sort_order")
      .eq("company_id", singleCompanyId)
      .order("sort_order")
      .order("id");
    partners = (partnersData ?? []).map((row) => ({
      id: row.id as string,
      name: row.name as string,
      sort_order: row.sort_order as number,
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

  // Helper: busca saldo inicial manual para o primeiro bucket. Se nao existir,
  // retorna 0 conforme regra acordada.
  const fetchOpeningBalanceForFirstBucket = async (firstBucket: CashFlowPeriodBucket): Promise<number> => {
    const { data } = await supabase
      .from("cash_flow_opening_balances")
      .select("amount")
      .in("company_id", filter.selectedCompanyIds)
      .eq("period_year", firstBucket.year)
      .eq("period_month", firstBucket.month);
    const total = (data ?? []).reduce(
      (sum, row) => sum + Number((row as { amount: number | string }).amount ?? 0),
      0,
    );
    return total;
  };

  // Para "Saldo Inicial" precisamos saber o "Caixa Final" do mes anterior.
  // Para o PRIMEIRO bucket, busca-se em cash_flow_opening_balances ou usa 0.
  // Para os SEGUINTES, encadeia-se a partir do bucket anterior calculado.
  const buckets = visibleBuckets;

  // Pre-resolve valor de "Resultado do Exercicio" do mes anterior ao primeiro bucket
  // — necessario apenas se o primeiro bucket nao tiver opening balance manual e
  // for o primeiro mes de dados. Aqui simplificamos: se nao houver opening, 0.

  const findCodeId = (code: string) => cashFlowAccounts.find((a) => a.code === code)?.id;
  const caixaFinalId = findCodeId("90.3");

  let saldoInicialBucket: number;
  if (buckets.length === 0) {
    saldoInicialBucket = 0;
  } else {
    saldoInicialBucket = await fetchOpeningBalanceForFirstBucket(buckets[0]);
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

  for (let i = 0; i < buckets.length; i += 1) {
    const bucket = buckets[i];

    if (isFutureBucket(bucket)) {
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

    const [dreResultado, amounts, partnerBreakdown] = await Promise.all([
      computeDreResultado(bucket),
      computeCashFlowAmounts(bucket),
      computePartnerBreakdown(bucket),
    ]);

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

    // Tambem precisamos do "Resultado do Exercicio" por empresa.
    const { data: dreByCompanyData } = await supabase.rpc("dashboard_dre_aggregate_by_company", {
      p_company_ids: filter.selectedCompanyIds,
      p_date_from: accumulatedBucket.dateFrom,
      p_date_to: accumulatedBucket.dateTo,
    });
    const dreAmountsByCompanyId = new Map<string, Map<string, number>>();
    (dreByCompanyData as Array<{
      company_id: string;
      dre_account_id: string;
      amount: number | string | null;
    }> | null ?? []).forEach((item) => {
      let m = dreAmountsByCompanyId.get(item.company_id);
      if (!m) {
        m = new Map();
        dreAmountsByCompanyId.set(item.company_id, m);
      }
      m.set(item.dre_account_id, Number(item.amount ?? 0));
    });

    // Saldos iniciais por empresa.
    const { data: openingBalances } = await supabase
      .from("cash_flow_opening_balances")
      .select("company_id,amount")
      .in("company_id", filter.selectedCompanyIds)
      .eq("period_year", buckets[0]?.year ?? 0)
      .eq("period_month", buckets[0]?.month ?? 0);
    const openingByCompany = new Map<string, number>();
    (openingBalances ?? []).forEach((row) => {
      const r = row as { company_id: string; amount: number | string };
      openingByCompany.set(r.company_id, Number(r.amount ?? 0));
    });

    for (const companyId of filter.selectedCompanyIds) {
      const companyAmounts = amountsByCompanyId.get(companyId) ?? new Map();
      const companyDreAmounts = dreAmountsByCompanyId.get(companyId) ?? new Map();
      const companyDreRows = buildDashboardRows(dreAccounts, companyDreAmounts).rows;
      const companyResultado = companyDreRows.find((r) => r.code === "11")?.value ?? 0;
      const companyOpening = openingByCompany.get(companyId) ?? 0;

      const companyRows = buildCashFlowRows(cashFlowAccounts, companyAmounts, {
        dreResultadoExercicio: companyResultado,
        saldoInicial: companyOpening,
      }).rows;

      const byId: Record<string, number> = {};
      companyRows.forEach((r) => { byId[r.id] = r.value; });
      companyValuesMap[companyId] = byId;
    }
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
    />
  );
}
