"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireVbGestor } from "@/lib/vb/auth";
import { isUuid, type VbActionResult } from "@/lib/vb/types";

const creditorSchema = z.object({
  name: z.string().trim().min(1, "Nome obrigatório.").max(120, "Nome longo demais."),
  active: z.boolean(),
});

export async function updateCreditor(
  creditorId: string,
  input: { name: string; active: boolean },
): Promise<VbActionResult> {
  await requireVbGestor();
  if (!isUuid(creditorId)) return { error: "Identificador inválido." };
  const parsed = creditorSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };

  const admin = createAdminClient();
  const { error } = await admin
    .from("vb_creditors")
    .update({ name: parsed.data.name, active: parsed.data.active })
    .eq("id", creditorId);
  if (error) return { error: error.message };

  revalidatePath("/vb");
  revalidatePath("/(vb)/vb/importar/[batchId]", "page");
  revalidatePath(`/vb/credores/${creditorId}`);
  return { ok: true };
}

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(160, "E-mail longo demais.")
  .refine((v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "E-mail inválido.");

/** E-mail que recebe o extrato mensal. Vazio = o credor deixa de receber. */
export async function updateCreditorEmail(
  creditorId: string,
  email: string,
): Promise<VbActionResult<{ email: string | null }>> {
  await requireVbGestor();
  if (!isUuid(creditorId)) return { error: "Identificador inválido." };
  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "E-mail inválido." };
  const value = parsed.data || null;

  const admin = createAdminClient();
  const { error } = await admin.from("vb_creditors").update({ email: value }).eq("id", creditorId);
  if (error) return { error: error.message };

  revalidatePath("/vb");
  revalidatePath("/vb/relatorios");
  revalidatePath(`/vb/credores/${creditorId}`);
  return { ok: true, email: value };
}
