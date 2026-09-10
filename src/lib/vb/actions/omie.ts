"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { VB_OMIE_PATH } from "@/lib/auth/vb";
import { runCompanySyncAsSystem } from "@/lib/omie/sync";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireVbGestor } from "@/lib/vb/auth";
import { buildEntryRows, newEntriesSchema } from "@/lib/vb/new-entries";
import { VB_OMIE_COMPANY_ID } from "@/lib/vb/omie/config";
import { getCandidateMovement, getOmieSyncStatus } from "@/lib/vb/omie/queries";
import type { VbActionResult, VbOmieMovement } from "@/lib/vb/types";

const UNIQUE_VIOLATION = "23505";
const ALREADY_DECIDED = "Este movimento já foi decidido.";
const NOT_FOUND = "Movimento não encontrado na Omie.";

const linkOmieSchema = newEntriesSchema.extend({ omie_id: z.string().min(1, "Movimento inválido.") });
export type LinkOmieInput = z.infer<typeof linkOmieSchema>;

function revalidateOmie(creditorIds: readonly string[] = []) {
  revalidatePath("/vb");
  revalidatePath(VB_OMIE_PATH);
  for (const id of creditorIds) revalidatePath(`/vb/credores/${id}`);
}

/** Retrato do movimento no momento da decisão (sobrevive ao sync apagar a linha). */
function snapshot(movement: VbOmieMovement) {
  return {
    company_id: VB_OMIE_COMPANY_ID,
    omie_id: movement.omie_id,
    financial_entry_id: movement.id,
    payment_date: movement.payment_date,
    supplier_customer: movement.supplier_customer,
    description: movement.description,
    category_code: movement.category_code,
    category_name: movement.category_name,
    value: movement.value,
  };
}

/** Descarta: grava a decisão com retrato. Reversível por restoreOmieMovement. */
export async function discardOmieMovement(omieId: string): Promise<VbActionResult> {
  const user = await requireVbGestor();
  const movement = await getCandidateMovement(omieId);
  if (!movement) return { error: NOT_FOUND };

  const admin = createAdminClient();
  const { error } = await admin
    .from("vb_omie_triage")
    .insert({ ...snapshot(movement), status: "descartado", group_id: null, decided_by: user.id });
  if (error) return { error: error.code === UNIQUE_VIOLATION ? ALREADY_DECIDED : error.message };

  revalidateOmie();
  return { ok: true };
}

/** Restaura um descarte: apaga a decisão; o movimento volta a pendente. */
export async function restoreOmieMovement(omieId: string): Promise<VbActionResult> {
  await requireVbGestor();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("vb_omie_triage")
    .delete()
    .eq("company_id", VB_OMIE_COMPANY_ID)
    .eq("omie_id", omieId)
    .eq("status", "descartado")
    .select("id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: "Nenhum descarte para restaurar." };

  revalidateOmie();
  return { ok: true };
}

/**
 * Vincula: grava os lançamentos (um INSERT, group_id novo) e depois a decisão.
 * Se a decisão falhar, apaga os lançamentos do grupo — sem decisão eles não
 * podem existir. A chave única (company_id, omie_id) é a garantia contra o
 * vínculo duplo mesmo em corrida; a checagem prévia só evita gravar à toa.
 */
export async function linkOmieMovement(
  input: LinkOmieInput,
): Promise<VbActionResult<{ ids: string[]; group_id: string }>> {
  const user = await requireVbGestor();
  const parsed = linkOmieSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  const { omie_id, ...entriesInput } = parsed.data;

  const movement = await getCandidateMovement(omie_id);
  if (!movement) return { error: NOT_FOUND };

  const group_id = randomUUID();
  const built = buildEntryRows(entriesInput, { userId: user.id, groupId: group_id });
  if ("error" in built) return built;

  const admin = createAdminClient();
  const creditorIds = Array.from(new Set(built.rows.map((row) => row.creditor_id)));
  const { data: creditors, error: creditorError } = await admin
    .from("vb_creditors")
    .select("id")
    .in("id", creditorIds);
  if (creditorError) return { error: creditorError.message };
  if ((creditors ?? []).length !== creditorIds.length) return { error: "Credor não encontrado." };

  const { data: existing, error: existingError } = await admin
    .from("vb_omie_triage")
    .select("id")
    .eq("company_id", VB_OMIE_COMPANY_ID)
    .eq("omie_id", omie_id)
    .maybeSingle();
  if (existingError) return { error: existingError.message };
  if (existing) return { error: ALREADY_DECIDED };

  const { data: inserted, error: insertError } = await admin.from("vb_entries").insert(built.rows).select("id");
  if (insertError || !inserted) return { error: insertError?.message ?? "Falha ao gravar os lançamentos." };

  const { error: triageError } = await admin
    .from("vb_omie_triage")
    .insert({ ...snapshot(movement), status: "vinculado", group_id, decided_by: user.id });
  if (triageError) {
    const { error: cleanupError } = await admin.from("vb_entries").delete().eq("group_id", group_id);
    if (cleanupError) {
      console.error("[vb-omie] link compensation failed", { group_id, error: cleanupError.message });
      revalidateOmie(creditorIds);
      return {
        error: `Falha ao registrar o vínculo e a limpeza também falhou (grupo ${group_id}). Avise o suporte.`,
      };
    }
    return { error: triageError.code === UNIQUE_VIOLATION ? ALREADY_DECIDED : triageError.message };
  }

  revalidateOmie(creditorIds);
  return { ok: true, ids: inserted.map((row) => row.id as string), group_id };
}

/**
 * Desvincula: apaga os lançamentos do grupo e depois a decisão. Tolera zero
 * lançamentos (reexecução depois de uma falha parcial só apaga a decisão).
 */
export async function unlinkOmieMovement(omieId: string): Promise<VbActionResult<{ removed: number }>> {
  await requireVbGestor();
  const admin = createAdminClient();
  const { data: triage, error: triageError } = await admin
    .from("vb_omie_triage")
    .select("id, group_id")
    .eq("company_id", VB_OMIE_COMPANY_ID)
    .eq("omie_id", omieId)
    .eq("status", "vinculado")
    .maybeSingle();
  if (triageError) return { error: triageError.message };
  if (!triage) return { error: "Vínculo não encontrado." };

  const groupId = triage.group_id as string | null;
  let removed = 0;
  let creditorIds: string[] = [];
  if (groupId) {
    const { data: deleted, error: deleteError } = await admin
      .from("vb_entries")
      .delete()
      .eq("group_id", groupId)
      .eq("status", "aprovado")
      .select("id, creditor_id");
    if (deleteError) return { error: deleteError.message };
    removed = deleted?.length ?? 0;
    creditorIds = Array.from(new Set((deleted ?? []).map((row) => row.creditor_id as string)));
  }

  const { error } = await admin.from("vb_omie_triage").delete().eq("id", triage.id as string);
  if (error) {
    revalidateOmie(creditorIds);
    return { error: `${error.message} (${removed} lançamento(s) já apagados; repita o desvincular)` };
  }

  revalidateOmie(creditorIds);
  return { ok: true, removed };
}

/** "Buscar na Omie": o mesmo sync rolling (3 dias) do cron, agora. */
export async function syncOmieNow(): Promise<VbActionResult<{ recordsImported: number }>> {
  await requireVbGestor();
  const status = await getOmieSyncStatus();
  if (status.running) return { error: "Sincronização em andamento. Aguarde um minuto e tente de novo." };
  try {
    const result = await runCompanySyncAsSystem(VB_OMIE_COMPANY_ID, "rolling");
    revalidateOmie();
    return { ok: true, recordsImported: result.recordsImported };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Falha ao sincronizar com a Omie." };
  }
}
