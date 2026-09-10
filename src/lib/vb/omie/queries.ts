// src/lib/vb/omie/queries.ts
// Leituras da triagem da Omie. Sempre pelo admin client, depois do gate de
// gestor (página) ou requireVbGestor() (actions): as policies de
// financial_entries dependem de vínculo com a empresa, que um gestor do VB não
// precisa ter. Lançam em erro de banco — a página cai no error.tsx do grupo.

import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  VB_OMIE_COMPANY_ID,
  VB_OMIE_START_DATE,
  VB_OMIE_SYNC_RUNNING_WINDOW_MS,
  VB_OMIE_TYPES,
} from "@/lib/vb/omie/config";
import { isCandidateMovement } from "@/lib/vb/omie/suggest";
import type {
  VbEntryKind,
  VbOmieLinkedEntry,
  VbOmieMovement,
  VbOmieSyncStatus,
  VbOmieTriageRow,
  VbOmieTriageStatus,
} from "@/lib/vb/types";

/** Teto folgado: a ABD Holding tem uns 25 pagamentos por mês. */
const MAX_MOVEMENTS = 2000;
const MOVEMENT_COLUMNS =
  "id, omie_id, payment_date, supplier_customer, description, category_code, value, document_number";

type Admin = ReturnType<typeof createAdminClient>;

interface MovementRow {
  id: string;
  omie_id: string;
  payment_date: string;
  supplier_customer: string | null;
  description: string | null;
  category_code: string | null;
  value: number | string;
  document_number: string | null;
}

interface TriageDbRow {
  id: string;
  omie_id: string;
  status: VbOmieTriageStatus;
  group_id: string | null;
  payment_date: string;
  supplier_customer: string | null;
  description: string | null;
  category_code: string | null;
  category_name: string | null;
  value: number | string;
  decided_by: string | null;
  decided_at: string;
}

function unique(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((v): v is string => Boolean(v))));
}

/** Código → nome do plano de contas da ABD (omie_categories). */
async function categoryNames(admin: Admin): Promise<Map<string, string>> {
  const { data, error } = await admin
    .from("omie_categories")
    .select("code, description")
    .eq("company_id", VB_OMIE_COMPANY_ID);
  if (error) throw new Error(error.message);
  const map = new Map<string, string>();
  for (const row of (data ?? []) as Array<{ code: string; description: string | null }>) {
    if (row.description && !map.has(row.code)) map.set(row.code, row.description);
  }
  return map;
}

function toMovement(row: MovementRow, categories: Map<string, string>): VbOmieMovement {
  return {
    id: row.id,
    omie_id: row.omie_id,
    payment_date: row.payment_date,
    supplier_customer: row.supplier_customer,
    description: row.description,
    category_code: row.category_code,
    category_name: row.category_code ? (categories.get(row.category_code) ?? null) : null,
    value: Number(row.value),
    document_number: row.document_number,
  };
}

/** Candidatos (empresa, tipo, data) que ainda não têm decisão, mais recente primeiro. */
export async function listPendingMovements(): Promise<VbOmieMovement[]> {
  const admin = createAdminClient();
  const [decided, rows, categories] = await Promise.all([
    admin.from("vb_omie_triage").select("omie_id").eq("company_id", VB_OMIE_COMPANY_ID),
    admin
      .from("financial_entries")
      .select(MOVEMENT_COLUMNS)
      .eq("company_id", VB_OMIE_COMPANY_ID)
      .in("type", [...VB_OMIE_TYPES])
      .gte("payment_date", VB_OMIE_START_DATE)
      .order("payment_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(MAX_MOVEMENTS),
    categoryNames(admin),
  ]);
  if (decided.error) throw new Error(decided.error.message);
  if (rows.error) throw new Error(rows.error.message);
  const decidedIds = new Set(((decided.data ?? []) as Array<{ omie_id: string }>).map((r) => r.omie_id));
  return ((rows.data ?? []) as unknown as MovementRow[])
    .filter((row) => !decidedIds.has(row.omie_id))
    .map((row) => toMovement(row, categories));
}

export async function countPendingMovements(): Promise<number> {
  return (await listPendingMovements()).length;
}

/** O movimento, se existir hoje e for candidato; senão null. Usado pelas actions antes de decidir. */
export async function getCandidateMovement(omieId: string): Promise<VbOmieMovement | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("financial_entries")
    .select(`${MOVEMENT_COLUMNS}, company_id, type`)
    .eq("company_id", VB_OMIE_COMPANY_ID)
    .eq("omie_id", omieId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const row = data as unknown as MovementRow & { company_id: string; type: string };
  if (!isCandidateMovement(row)) return null;
  return toMovement(row, await categoryNames(admin));
}

/** Decisões de um status, com o que existe hoje na Omie e os lançamentos do grupo. */
export async function listTriage(status: VbOmieTriageStatus): Promise<VbOmieTriageRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("vb_omie_triage")
    .select("*")
    .eq("company_id", VB_OMIE_COMPANY_ID)
    .eq("status", status)
    .order("decided_at", { ascending: false });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as TriageDbRow[];
  if (rows.length === 0) return [];

  const userIds = unique(rows.map((r) => r.decided_by));
  const groupIds = unique(rows.map((r) => r.group_id));

  const [live, users, entries] = await Promise.all([
    admin
      .from("financial_entries")
      .select("omie_id, value")
      .eq("company_id", VB_OMIE_COMPANY_ID)
      .in("omie_id", rows.map((r) => r.omie_id)),
    userIds.length > 0
      ? admin.from("users").select("id, name").in("id", userIds)
      : Promise.resolve({ data: [] as unknown[], error: null }),
    groupIds.length > 0
      ? admin
          .from("vb_entries")
          .select("id, creditor_id, kind, amount, sort_order, group_id")
          .in("group_id", groupIds)
          .order("sort_order")
      : Promise.resolve({ data: [] as unknown[], error: null }),
  ]);
  if (live.error) throw new Error(live.error.message);
  if (users.error) throw new Error(users.error.message);
  if (entries.error) throw new Error(entries.error.message);

  const liveValue = new Map<string, number>();
  for (const row of (live.data ?? []) as Array<{ omie_id: string; value: number | string }>) {
    liveValue.set(row.omie_id, Number(row.value));
  }
  const userName = new Map<string, string | null>();
  for (const row of (users.data ?? []) as Array<{ id: string; name: string | null }>) {
    userName.set(row.id, row.name);
  }

  type EntryRow = { id: string; creditor_id: string; kind: VbEntryKind; amount: number | string; sort_order: number; group_id: string };
  const entryRows = (entries.data ?? []) as EntryRow[];
  const creditorIds = unique(entryRows.map((e) => e.creditor_id));
  const creditorName = new Map<string, string>();
  if (creditorIds.length > 0) {
    const { data: creditors, error: creditorsError } = await admin
      .from("vb_creditors")
      .select("id, name")
      .in("id", creditorIds);
    if (creditorsError) throw new Error(creditorsError.message);
    for (const row of (creditors ?? []) as Array<{ id: string; name: string }>) creditorName.set(row.id, row.name);
  }
  const entriesByGroup = new Map<string, VbOmieLinkedEntry[]>();
  for (const e of entryRows) {
    const list = entriesByGroup.get(e.group_id) ?? [];
    list.push({
      id: e.id,
      creditor_id: e.creditor_id,
      creditor_name: creditorName.get(e.creditor_id) ?? "—",
      kind: e.kind,
      amount: Number(e.amount),
      sort_order: e.sort_order,
    });
    entriesByGroup.set(e.group_id, list);
  }

  return rows.map((row) => ({
    id: row.id,
    omie_id: row.omie_id,
    status: row.status,
    group_id: row.group_id,
    payment_date: row.payment_date,
    supplier_customer: row.supplier_customer,
    description: row.description,
    category_code: row.category_code,
    category_name: row.category_name,
    value: Number(row.value),
    decided_by_name: row.decided_by ? (userName.get(row.decided_by) ?? null) : null,
    decided_at: row.decided_at,
    live: liveValue.has(row.omie_id) ? { value: liveValue.get(row.omie_id)! } : null,
    entries: row.group_id ? (entriesByGroup.get(row.group_id) ?? []) : [],
  }));
}

/** Fornecedor → credor da primeira linha (sort_order 0) do vínculo mais recente com esse fornecedor. */
export async function suggestionMemory(): Promise<Record<string, string>> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("vb_omie_triage")
    .select("supplier_customer, group_id")
    .eq("company_id", VB_OMIE_COMPANY_ID)
    .eq("status", "vinculado")
    .not("supplier_customer", "is", null)
    .order("decided_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<{ supplier_customer: string; group_id: string | null }>;
  const groupIds = unique(rows.map((r) => r.group_id));
  if (groupIds.length === 0) return {};

  const { data: firsts, error: firstsError } = await admin
    .from("vb_entries")
    .select("group_id, creditor_id")
    .in("group_id", groupIds)
    .eq("sort_order", 0);
  if (firstsError) throw new Error(firstsError.message);
  const creditorByGroup = new Map<string, string>();
  for (const row of (firsts ?? []) as Array<{ group_id: string; creditor_id: string }>) {
    creditorByGroup.set(row.group_id, row.creditor_id);
  }

  const memory: Record<string, string> = {};
  for (const row of rows) {
    // Mais recente primeiro: a primeira ocorrência de cada fornecedor vence.
    if (memory[row.supplier_customer] || !row.group_id) continue;
    const creditor = creditorByGroup.get(row.group_id);
    if (creditor) memory[row.supplier_customer] = creditor;
  }
  return memory;
}

/** Último sync com sucesso e se há um em andamento (trava do botão "Buscar na Omie"). */
export async function getOmieSyncStatus(): Promise<VbOmieSyncStatus> {
  const admin = createAdminClient();
  const [latest, success] = await Promise.all([
    admin
      .from("sync_log")
      .select("status, started_at")
      .eq("company_id", VB_OMIE_COMPANY_ID)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("sync_log")
      .select("finished_at")
      .eq("company_id", VB_OMIE_COMPANY_ID)
      .eq("status", "success")
      .order("finished_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (latest.error) throw new Error(latest.error.message);
  if (success.error) throw new Error(success.error.message);
  const latestRow = latest.data as { status: string; started_at: string } | null;
  const startedAt = latestRow?.started_at ? new Date(latestRow.started_at).getTime() : 0;
  const running = latestRow?.status === "running" && Date.now() - startedAt < VB_OMIE_SYNC_RUNNING_WINDOW_MS;
  const successRow = success.data as { finished_at: string | null } | null;
  return { finishedAt: successRow?.finished_at ?? null, running };
}
