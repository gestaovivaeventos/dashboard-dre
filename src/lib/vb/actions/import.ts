"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireVbGestor } from "@/lib/vb/auth";
import { diffDaysIso } from "@/lib/vb/import/excel-date";
import { roundCents } from "@/lib/vb/money";
import {
  VB_BLOCKING_FLAGS,
  type VbActionResult,
  type VbEntryFlag,
  type VbImportSummary,
} from "@/lib/vb/types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const pendingEntrySchema = z.object({
  entry_date: z.string().regex(ISO_DATE, "Data inválida."),
  kind: z.enum(["entrada", "saida", "rendimento"]),
  amount: z.number(),
  description: z.string().trim().max(300, "Descrição longa demais.").nullable(),
  period_start: z.string().regex(ISO_DATE, "Início do período inválido.").nullable(),
  period_end: z.string().regex(ISO_DATE, "Fim do período inválido.").nullable(),
  /** Fração (0.0335 = 3,35%). */
  rate: z.number().nullable(),
});

export type PendingEntryInput = z.infer<typeof pendingEntrySchema>;

function revalidateVb(batchId?: string | null) {
  revalidatePath("/vb");
  revalidatePath("/vb/importar");
  revalidatePath("/vb/credores/[id]", "page");
  if (batchId) revalidatePath(`/vb/importar/${batchId}`);
}

/** Aprova o lote inteiro numa transação (função SQL vb_approve_import_batch). */
export async function approveImportBatch(
  batchId: string,
): Promise<VbActionResult<{ approved: number }>> {
  const user = await requireVbGestor();
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("vb_approve_import_batch", {
    p_batch_id: batchId,
    p_user_id: user.id,
  });
  if (error) return { error: error.message };
  revalidateVb(batchId);
  return { ok: true, approved: Number(data ?? 0) };
}

/**
 * Apaga os lançamentos pendentes do lote e os credores que ficaram sem nenhum
 * lançamento. A linha do lote fica, como 'descartado'.
 */
export async function discardImportBatch(batchId: string): Promise<VbActionResult> {
  await requireVbGestor();
  const admin = createAdminClient();

  const { data: batch, error: batchError } = await admin
    .from("vb_import_batches")
    .select("id, status, summary")
    .eq("id", batchId)
    .maybeSingle();
  if (batchError) return { error: batchError.message };
  if (!batch) return { error: "Lote não encontrado." };
  if (batch.status !== "pendente") return { error: "Só lotes pendentes podem ser descartados." };

  const { error: deleteError } = await admin
    .from("vb_entries")
    .delete()
    .eq("import_batch_id", batchId)
    .eq("status", "pendente");
  if (deleteError) return { error: deleteError.message };

  const summary = (batch.summary ?? {}) as Partial<VbImportSummary>;
  for (const creditor of summary.creditors ?? []) {
    const { count, error: countError } = await admin
      .from("vb_entries")
      .select("id", { count: "exact", head: true })
      .eq("creditor_id", creditor.creditorId);
    if (countError) return { error: countError.message };
    if ((count ?? 0) === 0) {
      const { error: deleteError } = await admin
        .from("vb_creditors")
        .delete()
        .eq("id", creditor.creditorId);
      if (deleteError) return { error: deleteError.message };
    }
  }

  const { error: updateError } = await admin
    .from("vb_import_batches")
    .update({ status: "descartado", discarded_at: new Date().toISOString() })
    .eq("id", batchId);
  if (updateError) return { error: updateError.message };

  revalidateVb(batchId);
  return { ok: true };
}

/**
 * Edita um lançamento PENDENTE. Remove as flags bloqueantes (o gestor acabou
 * de olhar a linha); as demais ficam como registro do que a planilha trazia.
 */
export async function updatePendingEntry(
  entryId: string,
  input: PendingEntryInput,
): Promise<VbActionResult> {
  await requireVbGestor();
  const parsed = pendingEntrySchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  const v = parsed.data;

  const amount = roundCents(v.amount);
  if (amount === 0) return { error: "Valor não pode ser zero." };
  if (v.kind === "entrada" && amount < 0) return { error: "Entrada precisa ser positiva." };
  if (v.kind === "saida" && amount > 0) return { error: "Saída precisa ser negativa." };

  let period_start: string | null = null;
  let period_end: string | null = null;
  let days: number | null = null;
  let rate: number | null = null;
  if (v.kind === "rendimento") {
    period_end = v.period_end ?? v.entry_date;
    period_start = v.period_start ?? period_end;
    if (period_start > period_end) return { error: "Início do período depois do fim." };
    days = diffDaysIso(period_start, period_end);
    rate = v.rate;
  }

  const admin = createAdminClient();
  const { data: current, error: readError } = await admin
    .from("vb_entries")
    .select("id, status, flags, import_batch_id, rate_basis")
    .eq("id", entryId)
    .maybeSingle();
  if (readError) return { error: readError.message };
  if (!current) return { error: "Lançamento não encontrado." };
  if (current.status !== "pendente") return { error: "Só lançamentos pendentes podem ser editados." };

  const flags = ((current.flags as string[] | null) ?? []).filter(
    (flag) => !VB_BLOCKING_FLAGS.has(flag as VbEntryFlag),
  );

  const { error } = await admin
    .from("vb_entries")
    .update({
      entry_date: v.entry_date,
      kind: v.kind,
      amount,
      description: v.description || null,
      period_start,
      period_end,
      days,
      rate,
      rate_basis: v.kind === "rendimento" ? (current.rate_basis ?? "ajuste") : null,
      flags,
    })
    .eq("id", entryId)
    .eq("status", "pendente");
  if (error) return { error: error.message };

  revalidateVb(current.import_batch_id as string | null);
  return { ok: true };
}

export async function deletePendingEntry(entryId: string): Promise<VbActionResult> {
  await requireVbGestor();
  const admin = createAdminClient();
  const { data: current, error: readError } = await admin
    .from("vb_entries")
    .select("id, status, import_batch_id")
    .eq("id", entryId)
    .maybeSingle();
  if (readError) return { error: readError.message };
  if (!current) return { error: "Lançamento não encontrado." };
  if (current.status !== "pendente") return { error: "Só lançamentos pendentes podem ser excluídos." };

  const { error } = await admin.from("vb_entries").delete().eq("id", entryId).eq("status", "pendente");
  if (error) return { error: error.message };

  revalidateVb(current.import_batch_id as string | null);
  return { ok: true };
}
