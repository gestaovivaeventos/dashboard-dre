import type { SupabaseClient } from "@supabase/supabase-js";

// Refresh da pre-agregacao do DRE (tabela dre_monthly_aggregates), consumida
// pelas RPCs dashboard_dre_aggregate / _by_company. Mantida fresca disparando
// o recalculo quando os lancamentos (sync) ou o mapeamento mudam.
//
// IMPORTANTE: e best-effort. Uma falha aqui NAO deve derrubar o fluxo chamador
// (sync / salvar mapeamento) — no pior caso o agregado fica defasado ate o
// proximo refresh. Por isso nunca lanca; devolve { ok, error }.

interface RefreshResult {
  ok: boolean;
  error?: string;
}

/**
 * Recalcula os agregados das empresas EFETIVAS afetadas por mudancas numa
 * empresa de ORIGEM: a propria empresa + os destinos para onde ela roteia
 * departamentos (cujos agregados dependem dos lancamentos dela).
 */
export async function refreshDreAggregatesForSource(
  db: SupabaseClient,
  sourceCompanyId: string,
): Promise<RefreshResult> {
  try {
    const targets = new Set<string>([sourceCompanyId]);

    const { data: routes } = await db
      .from("company_departments")
      .select("routed_to_company_id")
      .eq("company_id", sourceCompanyId)
      .not("routed_to_company_id", "is", null);
    (routes ?? []).forEach((row) => {
      const dest = (row as { routed_to_company_id: string | null }).routed_to_company_id;
      if (dest) targets.add(dest);
    });

    const { error } = await db.rpc("refresh_dre_monthly_aggregates", {
      p_company_ids: Array.from(targets),
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Igual a refreshDreAggregatesForSource, mas para a pre-agregacao do FLUXO DE
 * CAIXA (cash_flow_monthly_aggregates), consumida por cash_flow_aggregate /
 * _by_company.
 */
export async function refreshCashFlowAggregatesForSource(
  db: SupabaseClient,
  sourceCompanyId: string,
): Promise<RefreshResult> {
  try {
    const targets = new Set<string>([sourceCompanyId]);

    const { data: routes } = await db
      .from("company_departments")
      .select("routed_to_company_id")
      .eq("company_id", sourceCompanyId)
      .not("routed_to_company_id", "is", null);
    (routes ?? []).forEach((row) => {
      const dest = (row as { routed_to_company_id: string | null }).routed_to_company_id;
      if (dest) targets.add(dest);
    });

    const { error } = await db.rpc("refresh_cash_flow_monthly_aggregates", {
      p_company_ids: Array.from(targets),
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Recalcula os agregados de TODAS as empresas (mudancas globais / backfill). */
export async function refreshAllDreAggregates(db: SupabaseClient): Promise<RefreshResult> {
  try {
    const { error } = await db.rpc("refresh_dre_monthly_aggregates", {
      p_company_ids: null,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
