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

/** Menor data com CDI gravado. */
export async function firstCdiDate(): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("vb_cdi_rates")
    .select("rate_date")
    .order("rate_date", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { rate_date: string } | null)?.rate_date ?? null;
}

/**
 * Ponto de partida do credor: o FIM DO ÚLTIMO RENDIMENTO aprovado dele, de
 * qualquer base (planilha ou CDI). Dali até a última taxa gravada o motor
 * corta em cada movimentação e rende cada trecho com o saldo que havia — é
 * o prazo de cada um, não uma data única para todos (decisão 14/09/2026: o
 * marco zero global fazia todo credor partir do mesmo dia).
 *
 * Não é "último lançamento": a conferência de 14/09/2026 mostrou trechos
 * entre o último rendimento e a movimentação seguinte que ficariam sem
 * render (Sotrate: 30/06→01/09, R$ 16,3 mil; Vitor: 30/06→01/08; Maria Ap:
 * 09/07→01/08). O rendimento por CDI entra em `period_end`, então ele mesmo
 * vira o próximo ponto de partida e nada é calculado duas vezes. Credor que
 * nunca teve rendimento parte do primeiro lançamento; sem nenhum, não há
 * saldo para render.
 */
export async function accrualStartFor(creditorId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data: last, error } = await admin
    .from("vb_entries")
    .select("entry_date, period_end")
    .eq("creditor_id", creditorId)
    .eq("status", "aprovado")
    .eq("kind", "rendimento")
    .order("period_end", { ascending: false, nullsFirst: false })
    .order("entry_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const row = last as { entry_date: string; period_end: string | null } | null;
  if (row) return row.period_end ?? row.entry_date;

  const { data: first, error: firstError } = await admin
    .from("vb_entries")
    .select("entry_date")
    .eq("creditor_id", creditorId)
    .eq("status", "aprovado")
    .order("entry_date", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (firstError) throw new Error(firstError.message);
  return (first as { entry_date: string } | null)?.entry_date ?? null;
}

/**
 * Menor ponto de partida entre os credores ativos: é até onde o download de
 * taxas precisa voltar para que todo mundo tenha CDI desde o próprio último
 * lançamento. Sem credor ativo com lançamento, o marco de download padrão.
 */
export async function earliestAccrualStart(): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin.from("vb_creditors").select("id").eq("active", true);
  if (error) throw new Error(error.message);
  let earliest: string | null = null;
  for (const row of (data ?? []) as Array<{ id: string }>) {
    const start = await accrualStartFor(row.id);
    if (start && (!earliest || start < earliest)) earliest = start;
  }
  return earliest ?? VB_CDI_START_DATE;
}
