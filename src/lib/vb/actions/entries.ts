"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireVbGestor } from "@/lib/vb/auth";
import { buildEntryRows, newEntriesSchema, type NewEntriesInput } from "@/lib/vb/new-entries";
import type { VbActionResult } from "@/lib/vb/types";

/**
 * "Novo lançamento" do gestor: uma operação com uma ou mais linhas (credor ·
 * tipo · valor). Um INSERT só, então entra tudo ou nada, e as linhas ficam
 * ligadas pelo group_id. Cada uma entra direto como 'aprovado' — a revisão é
 * só para a importação. O histórico aprovado não é editável nesta fase.
 */
export async function createVbEntries(
  input: NewEntriesInput,
): Promise<VbActionResult<{ ids: string[]; group_id: string }>> {
  const user = await requireVbGestor();
  const parsed = newEntriesSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };

  const group_id = randomUUID();
  const built = buildEntryRows(parsed.data, { userId: user.id, groupId: group_id });
  if ("error" in built) return built;

  const admin = createAdminClient();
  const creditorIds = Array.from(new Set(built.rows.map((row) => row.creditor_id)));
  const { data: creditors, error: creditorError } = await admin
    .from("vb_creditors")
    .select("id")
    .in("id", creditorIds);
  if (creditorError) return { error: creditorError.message };
  if ((creditors ?? []).length !== creditorIds.length) return { error: "Credor não encontrado." };

  const { data, error } = await admin.from("vb_entries").insert(built.rows).select("id");
  if (error || !data) return { error: error?.message ?? "Falha ao gravar." };

  revalidatePath("/vb");
  for (const id of creditorIds) revalidatePath(`/vb/credores/${id}`);
  return { ok: true, ids: data.map((row) => row.id as string), group_id };
}
