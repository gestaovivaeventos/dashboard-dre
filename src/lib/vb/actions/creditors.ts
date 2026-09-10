"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireVbGestor } from "@/lib/vb/auth";
import type { VbActionResult } from "@/lib/vb/types";

const creditorSchema = z.object({
  name: z.string().trim().min(1, "Nome obrigatório.").max(120, "Nome longo demais."),
  active: z.boolean(),
});

export async function updateCreditor(
  creditorId: string,
  input: { name: string; active: boolean },
): Promise<VbActionResult> {
  await requireVbGestor();
  const parsed = creditorSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };

  const admin = createAdminClient();
  const { error } = await admin
    .from("vb_creditors")
    .update({ name: parsed.data.name, active: parsed.data.active })
    .eq("id", creditorId);
  if (error) return { error: error.message };

  revalidatePath("/vb");
  revalidatePath("/vb/importar/[batchId]", "page");
  revalidatePath(`/vb/credores/${creditorId}`);
  return { ok: true };
}
