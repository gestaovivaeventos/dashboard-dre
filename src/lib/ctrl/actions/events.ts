"use server";

import { revalidatePath } from "next/cache";

import { getCtrlUser, hasCtrlRole } from "@/lib/ctrl/auth";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

async function getAdminSupabase() {
  return createAdminClientIfAvailable() ?? (await createClient());
}

export async function createEvent(formData: FormData) {
  const ctx = await getCtrlUser();
  if (!ctx || !hasCtrlRole(ctx, "csc", "admin")) {
    return { error: "Permissão negada." };
  }

  const name = (formData.get("name") as string)?.trim();
  if (!name) return { error: "Nome é obrigatório." };

  const supabase = await getAdminSupabase();
  const { error } = await supabase.from("ctrl_events").insert({
    name,
    description: (formData.get("description") as string)?.trim() || null,
    is_active: true,
    created_by: ctx.id,
  });

  if (error) return { error: error.message };
  revalidatePath("/ctrl/admin/eventos");
}

export async function toggleEventActive(eventId: string, isActive: boolean) {
  const ctx = await getCtrlUser();
  if (!ctx || !hasCtrlRole(ctx, "csc", "admin")) {
    return { error: "Permissão negada." };
  }
  const supabase = await getAdminSupabase();
  await supabase.from("ctrl_events").update({ is_active: !isActive }).eq("id", eventId);
  revalidatePath("/ctrl/admin/eventos");
}
