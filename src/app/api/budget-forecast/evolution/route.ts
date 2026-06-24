import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";
import {
  FRANQUIAS_VIVA_SLUG,
  resolveFranquiasVivaCustosNegation,
} from "@/lib/dashboard/franquias-viva-custos";
import {
  buildDashboardRows,
  fetchAllDreAccountRows,
  resolveAllowedCompanyIds,
  scopeDreAccounts,
  SCOPED_DRE_ACCOUNTS_SELECT,
  type RawDreAccount,
} from "@/lib/dashboard/dre";

function monthRange(date: Date) {
  const from = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const to = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
  return {
    dateFrom: from.toISOString().slice(0, 10),
    dateTo: to.toISOString().slice(0, 10),
    label: `${String(from.getUTCMonth() + 1).padStart(2, "0")}/${from.getUTCFullYear()}`,
  };
}

export async function GET(request: Request) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }

  const url = new URL(request.url);
  const accountId = url.searchParams.get("accountId");
  const endDateRaw = url.searchParams.get("endDate");
  const startDateRaw = url.searchParams.get("startDate");
  const mode = url.searchParams.get("mode") ?? "compare"; // "compare" | "projecao"
  const requestedCompanyIds = url.searchParams.get("companyIds")?.split(",").filter(Boolean) ?? [];
  if (!accountId || !endDateRaw) {
    return NextResponse.json({ error: "Parametros obrigatorios: accountId e endDate." }, { status: 400 });
  }

  const [{ data: companiesData }, accountsData] = await Promise.all([
    supabase.from("companies").select("id,name,active,segment_id").eq("active", true).order("name"),
    // Paginado: o cap de 1000 do PostgREST truncava os codes "8"/"9" (ver fetchAllDreAccountRows).
    // Carrega company_id (SCOPED_DRE_ACCOUNTS_SELECT) para permitir escopar o
    // plano por empresa, igual ao dashboard e à tabela do Budget.
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
  const scopedCompanyIds =
    requestedCompanyIds.length > 0
      ? requestedCompanyIds.filter((id) => allowedCompanyIds.includes(id))
      : allowedCompanyIds;
  if (scopedCompanyIds.length === 0) {
    return NextResponse.json({ points: [] });
  }

  // Escopa o plano DRE à seleção, EXATAMENTE como o dashboard e a tabela do
  // Budget. Com UMA empresa selecionada, usa o plano custom dela — onde a conta
  // calculada "Resultado do Exercício" (ex.: code "15" da SGX) e sua fórmula
  // realmente existem. Sem isso, `buildDashboardRows` avaliava a fórmula contra
  // a árvore global/misturada (códigos duplicados entre planos), resolvendo para
  // contas erradas e devolvendo 0 — o que deixava o gráfico "vazio" justamente
  // nas linhas calculadas (Resultado do Exercício, Lucro Operacional, etc.).
  const scope = scopeDreAccounts(accountsData, scopedCompanyIds);
  const accounts = scope.coreAccounts;

  // Converte as linhas cruas do RPC (dre_account_id no escopo do mapeamento:
  // global ou custom) em um mapa scoped_id -> amount, somando quando vários ids
  // caem no mesmo code do plano em escopo.
  const buildScopedAmounts = (
    rows: Array<{ dre_account_id: string; amount: number | string | null }> | null | undefined,
  ): Map<string, number> => {
    const amounts = new Map<string, number>();
    (rows ?? []).forEach((row) => {
      const scopedId = scope.translateToScopedId(row.dre_account_id);
      if (!scopedId) return;
      amounts.set(scopedId, (amounts.get(scopedId) ?? 0) + Number(row.amount ?? 0));
    });
    return amounts;
  };

  // Franquias Viva: subtrai "Receitas Ressarciveis - Fundos" (5.8) do total de
  // Custos, igual ao Budget/Dashboard. Só quando TODAS as empresas do gráfico
  // são do segmento. Inerte caso contrário.
  const segmentIdByCompany = new Map(
    (companiesData ?? []).map((c) => [c.id as string, (c as { segment_id: string | null }).segment_id]),
  );
  const { data: franquiasVivaSegment } = await supabase
    .from("segments")
    .select("id")
    .eq("slug", FRANQUIAS_VIVA_SLUG)
    .maybeSingle();
  const franquiasVivaSegmentId = (franquiasVivaSegment as { id: string } | null)?.id ?? null;
  const allFranquiasViva =
    franquiasVivaSegmentId !== null &&
    scopedCompanyIds.every((id) => segmentIdByCompany.get(id) === franquiasVivaSegmentId);
  const custosNegation = resolveFranquiasVivaCustosNegation(
    allFranquiasViva ? FRANQUIAS_VIVA_SLUG : null,
    accounts,
  );

  const endDate = new Date(`${endDateRaw}T00:00:00Z`);
  const startDate = startDateRaw
    ? new Date(`${startDateRaw}T00:00:00Z`)
    : new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth() - 11, 1));

  // Build month ranges from startDate (first of month) to endDate (inclusive of its month).
  const ranges: Array<{ dateFrom: string; dateTo: string; label: string }> = [];
  let cursor = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1));
  const last = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), 1));
  while (cursor.getTime() <= last.getTime()) {
    ranges.push(monthRange(cursor));
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }

  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1;

  const points = await Promise.all(
    ranges.map(async (range) => {
      const rangeYear = Number(range.label.split("/")[1]);
      const rangeMonth = Number(range.label.split("/")[0]);
      const isFuture = rangeYear > currentYear || (rangeYear === currentYear && rangeMonth > currentMonth);

      if (mode === "projecao") {
        // Single combined series: realized for past/current months, budget for future months.
        const rpc = isFuture ? "budget_aggregate" : "dashboard_dre_aggregate";
        const { data, error } = await supabase.rpc(rpc, {
          p_company_ids: scopedCompanyIds,
          p_date_from: range.dateFrom,
          p_date_to: range.dateTo,
        });
        if (error) throw new Error(error.message);
        const amounts = buildScopedAmounts(
          data as Array<{ dre_account_id: string; amount: number | string | null }> | null,
        );
        const builtRows = buildDashboardRows(accounts, amounts, {
          negateChildCodesInSummary: custosNegation,
        }).rows;
        const selected = builtRows.find((r) => r.id === accountId);
        return {
          label: range.label,
          valor: selected?.value ?? 0,
          tipo: isFuture ? "Orcamento" : "Realizado",
        };
      }

      const [{ data: realizedData, error: realizedErr }, { data: budgetData, error: budgetErr }] = await Promise.all([
        supabase.rpc("dashboard_dre_aggregate", {
          p_company_ids: scopedCompanyIds,
          p_date_from: range.dateFrom,
          p_date_to: range.dateTo,
        }),
        supabase.rpc("budget_aggregate", {
          p_company_ids: scopedCompanyIds,
          p_date_from: range.dateFrom,
          p_date_to: range.dateTo,
        }),
      ]);
      if (realizedErr) throw new Error(realizedErr.message);
      if (budgetErr) throw new Error(budgetErr.message);

      const realizedAmounts = buildScopedAmounts(
        realizedData as Array<{ dre_account_id: string; amount: number | string | null }> | null,
      );
      const budgetAmounts = buildScopedAmounts(
        budgetData as Array<{ dre_account_id: string; amount: number | string | null }> | null,
      );

      const realizedRows = buildDashboardRows(accounts, realizedAmounts, {
        negateChildCodesInSummary: custosNegation,
      }).rows;
      const budgetRows = buildDashboardRows(accounts, budgetAmounts, {
        negateChildCodesInSummary: custosNegation,
      }).rows;
      const realizedRow = realizedRows.find((r) => r.id === accountId);
      const budgetRow = budgetRows.find((r) => r.id === accountId);

      return {
        label: range.label,
        realizado: realizedRow?.value ?? 0,
        previsto: budgetRow?.value ?? 0,
      };
    }),
  );

  return NextResponse.json({ points });
}
