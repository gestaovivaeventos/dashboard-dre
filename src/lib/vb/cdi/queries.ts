// src/lib/vb/cdi/queries.ts
// Leituras do rendimento por CDI. Sempre pelo admin client, depois do gate de
// gestor (ação/página) ou do CRON_SECRET (cron).

import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { VB_CDI_START_DATE } from "@/lib/vb/cdi/config";

/** PostgREST devolve no máximo 1000 linhas por requisição. */
const PAGE = 1000;

/** Taxas de rate_date >= from, indexadas por data. */
export async function loadCdiRates(from: string): Promise<Map<string, number>> {
  const admin = createAdminClient();
  const rates = new Map<string, number>();
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await admin
      .from("vb_cdi_rates")
      .select("rate_date, rate")
      .gte("rate_date", from)
      .order("rate_date")
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Array<{ rate_date: string; rate: number | string }>;
    for (const row of rows) rates.set(row.rate_date, Number(row.rate));
    if (rows.length < PAGE) break;
  }
  return rates;
}

/** Maior data com CDI gravado. É até aqui que o rendimento pode ir. */
export async function lastCdiDate(): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("vb_cdi_rates")
    .select("rate_date")
    .order("rate_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { rate_date: string } | null)?.rate_date ?? null;
}

/**
 * Ponto de partida do credor: fim do último rendimento por CDI. Sem nenhum,
 * o marco zero — é o que garante que o passado não é recalculado.
 */
export async function accrualStartFor(creditorId: string): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("vb_entries")
    .select("period_end")
    .eq("creditor_id", creditorId)
    .eq("status", "aprovado")
    .eq("kind", "rendimento")
    .eq("rate_basis", "cdi")
    .not("period_end", "is", null)
    .order("period_end", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const last = (data as { period_end: string | null } | null)?.period_end ?? null;
  return last && last > VB_CDI_START_DATE ? last : VB_CDI_START_DATE;
}
