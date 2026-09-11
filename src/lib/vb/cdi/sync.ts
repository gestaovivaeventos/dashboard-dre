// src/lib/vb/cdi/sync.ts
// Busca no Banco Central o CDI que ainda não está gravado e faz upsert.
// Idempotente: parte sempre da última data gravada.

import "server-only";

import { todayBR } from "@/lib/ctrl/datetime";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchCdiRange } from "@/lib/vb/cdi/bcb";
import { VB_CDI_START_DATE } from "@/lib/vb/cdi/config";
import { lastCdiDate } from "@/lib/vb/cdi/queries";

export async function syncCdiRates(): Promise<{ inserted: number; lastDate: string | null }> {
  const stored = await lastCdiDate();
  const from = stored ?? VB_CDI_START_DATE;
  const to = todayBR();
  const rows = await fetchCdiRange(from, to);
  // O intervalo inclui a data já gravada; o upsert por chave primária absorve.
  if (rows.length === 0) return { inserted: 0, lastDate: stored };

  const admin = createAdminClient();
  const { error } = await admin.from("vb_cdi_rates").upsert(
    rows.map((row) => ({ rate_date: row.rate_date, rate: row.rate, fetched_at: new Date().toISOString() })),
    { onConflict: "rate_date" },
  );
  if (error) throw new Error(error.message);

  const newest = rows.reduce((max, row) => (row.rate_date > max ? row.rate_date : max), rows[0].rate_date);
  return { inserted: rows.length, lastDate: newest > (stored ?? "") ? newest : stored };
}
