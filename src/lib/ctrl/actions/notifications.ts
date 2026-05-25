"use server";

import { revalidatePath } from "next/cache";

import { requireCtrlRole } from "@/lib/ctrl/auth";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Marca uma notificação como lida. Revalida o layout do CTRL pra que
 * o badge do sininho atualize na mesma navegação.
 */
export async function markNotificationRead(notificationId: string) {
  const ctx = await requireCtrlRole(
    "solicitante",
    "gerente",
    "diretor",
    "csc",
    "contas_a_pagar",
    "admin",
    "aprovacao_fornecedor",
  );
  const adminClient = createAdminClientIfAvailable();
  const supabase = adminClient ?? (await createClient());

  // Restringe ao dono pra não permitir marcar notificação de outro usuário.
  const { error } = await supabase
    .from("ctrl_notifications")
    .update({ is_read: true })
    .eq("id", notificationId)
    .eq("user_id", ctx.id);

  if (error) return { error: error.message };

  revalidatePath("/ctrl", "layout");
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function markAllNotificationsRead() {
  const ctx = await requireCtrlRole(
    "solicitante",
    "gerente",
    "diretor",
    "csc",
    "contas_a_pagar",
    "admin",
    "aprovacao_fornecedor",
  );
  const adminClient = createAdminClientIfAvailable();
  const supabase = adminClient ?? (await createClient());

  const { error } = await supabase
    .from("ctrl_notifications")
    .update({ is_read: true })
    .eq("user_id", ctx.id)
    .eq("is_read", false);

  if (error) return { error: error.message };

  revalidatePath("/ctrl", "layout");
  revalidatePath("/", "layout");
  return { ok: true };
}
