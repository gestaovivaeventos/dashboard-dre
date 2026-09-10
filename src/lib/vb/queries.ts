// Leituras do módulo VB. Recebem o client (do usuário → RLS; admin → service
// role) para que páginas e actions escolham o contexto. Lançam em erro de
// banco: a página cai no error.tsx do grupo.

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  EMPTY_IMPORT_SUMMARY,
  type VbCreditor,
  type VbEntry,
  type VbEntryStatus,
  type VbImportBatch,
  type VbImportSummary,
} from "@/lib/vb/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type VbDb = SupabaseClient<any>;

/** PostgREST devolve no máximo 1000 linhas por requisição. */
const PAGE = 1000;

function normalizeEntry(row: Record<string, unknown>): VbEntry {
  return {
    ...(row as unknown as VbEntry),
    amount: Number(row.amount),
    rate: row.rate == null ? null : Number(row.rate),
    sheet_balance: row.sheet_balance == null ? null : Number(row.sheet_balance),
    flags: (row.flags as VbEntry["flags"] | null) ?? [],
  };
}

function normalizeBatch(row: Record<string, unknown>): VbImportBatch {
  const summary = row.summary as Partial<VbImportSummary> | null;
  return {
    ...(row as unknown as VbImportBatch),
    summary: { ...EMPTY_IMPORT_SUMMARY, ...(summary ?? {}) },
  };
}

export async function listCreditors(db: VbDb): Promise<VbCreditor[]> {
  const { data, error } = await db
    .from("vb_creditors")
    .select("*")
    .order("sort_order")
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as VbCreditor[];
}

export async function getCreditor(db: VbDb, id: string): Promise<VbCreditor | null> {
  const { data, error } = await db.from("vb_creditors").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as VbCreditor | null) ?? null;
}

export async function listEntries(
  db: VbDb,
  filter: { status: VbEntryStatus; creditorId?: string; batchId?: string },
): Promise<VbEntry[]> {
  const all: VbEntry[] = [];
  for (let from = 0; ; from += PAGE) {
    let query = db
      .from("vb_entries")
      .select("*")
      .eq("status", filter.status)
      .order("entry_date")
      .order("sort_order")
      .order("created_at")
      .order("id")
      .range(from, from + PAGE - 1);
    if (filter.creditorId) query = query.eq("creditor_id", filter.creditorId);
    if (filter.batchId) query = query.eq("import_batch_id", filter.batchId);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const rows = ((data ?? []) as Record<string, unknown>[]).map(normalizeEntry);
    all.push(...rows);
    if (rows.length < PAGE) break;
  }
  return all;
}

export async function countPendingEntries(db: VbDb, creditorId: string): Promise<number> {
  const { count, error } = await db
    .from("vb_entries")
    .select("id", { count: "exact", head: true })
    .eq("creditor_id", creditorId)
    .eq("status", "pendente");
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function getPendingBatch(db: VbDb): Promise<VbImportBatch | null> {
  const { data, error } = await db
    .from("vb_import_batches")
    .select("*")
    .eq("status", "pendente")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? normalizeBatch(data as Record<string, unknown>) : null;
}

export async function listBatches(db: VbDb): Promise<VbImportBatch[]> {
  const { data, error } = await db
    .from("vb_import_batches")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map(normalizeBatch);
}

export async function getBatch(db: VbDb, id: string): Promise<VbImportBatch | null> {
  const { data, error } = await db.from("vb_import_batches").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? normalizeBatch(data as Record<string, unknown>) : null;
}
