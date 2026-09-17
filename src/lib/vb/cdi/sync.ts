// src/lib/vb/cdi/sync.ts
// Busca no Banco Central o CDI que ainda não está gravado e faz upsert.
// Idempotente: parte sempre da última data gravada. Também preenche para
// trás: como cada credor rende desde o PRÓPRIO último lançamento, a tabela
// precisa cobrir desde o mais antigo desses pontos de partida — senão o
// motor vê "sem taxa" e o rendimento daquele trecho simplesmente não sai.

import "server-only";

import { todayBR } from "@/lib/ctrl/datetime";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchCdiRange, type CdiRate } from "@/lib/vb/cdi/bcb";
import { VB_CDI_START_DATE } from "@/lib/vb/cdi/config";
import { earliestAccrualStart, firstCdiDate, lastCdiDate } from "@/lib/vb/cdi/queries";

export async function syncCdiRates(): Promise<{ inserted: number; lastDate: string | null }> {
  const [stored, first] = await Promise.all([lastCdiDate(), firstCdiDate()]);
  // Falha ao ler os credores não pode travar o download do dia: cai no marco padrão.
  const needed = await earliestAccrualStart().catch(() => VB_CDI_START_DATE);
  const to = todayBR();

  const ranges: Array<[string, string]> = [];
  // Para trás: do ponto de partida mais antigo até a primeira taxa gravada.
  if (!first || needed < first) ranges.push([needed, first ?? to]);
  // Para frente: da última gravada (inclusa; o upsert absorve) até hoje.
  if (stored) ranges.push([stored, to]);

  const rows = new Map<string, CdiRate>();
  for (const [from, until] of ranges) {
    for (const row of await fetchCdiRange(from, until)) rows.set(row.rate_date, row);
  }
  if (rows.size === 0) return { inserted: 0, lastDate: stored };

  const admin = createAdminClient();
  const fetchedAt = new Date().toISOString();
  const { error } = await admin.from("vb_cdi_rates").upsert(
    Array.from(rows.values()).map((row) => ({ rate_date: row.rate_date, rate: row.rate, fetched_at: fetchedAt })),
    { onConflict: "rate_date" },
  );
  if (error) throw new Error(error.message);

  let newest = stored ?? "";
  for (const date of Array.from(rows.keys())) if (date > newest) newest = date;
  return { inserted: rows.size, lastDate: newest || null };
}
