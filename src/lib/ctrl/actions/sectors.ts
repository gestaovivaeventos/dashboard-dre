"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { requireCtrlRole } from "@/lib/ctrl/auth";
import type { CtrlSector } from "@/lib/supabase/types";

export async function getSectors() {
  await requireCtrlRole("solicitante", "gerente", "diretor", "csc", "admin");
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("ctrl_sectors")
    .select("*")
    .eq("active", true)
    .order("name");

  if (error) return { error: error.message };
  return { sectors: data as CtrlSector[] };
}

export async function createSector(name: string) {
  await requireCtrlRole("admin");
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("ctrl_sectors")
    .insert({ name })
    .select("id")
    .single();

  if (error) return { error: error.message };
  revalidatePath("/ctrl/admin/setores");
  return { sectorId: data.id };
}

export async function updateSector(id: string, name: string) {
  await requireCtrlRole("admin");
  const supabase = await createClient();

  const { error } = await supabase
    .from("ctrl_sectors")
    .update({ name })
    .eq("id", id);

  if (error) return { error: error.message };
  revalidatePath("/ctrl/admin/setores");
  return { ok: true };
}

export async function deactivateSector(id: string) {
  await requireCtrlRole("admin");
  const supabase = await createClient();

  const { error } = await supabase
    .from("ctrl_sectors")
    .update({ active: false })
    .eq("id", id);

  if (error) return { error: error.message };
  revalidatePath("/ctrl/admin/setores");
  return { ok: true };
}
