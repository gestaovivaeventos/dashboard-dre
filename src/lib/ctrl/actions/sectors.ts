"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { hasCtrlRole, requireCtrlRole } from "@/lib/ctrl/auth";
import type { CtrlSector } from "@/lib/supabase/types";

export async function getSectors() {
  const ctx = await requireCtrlRole("solicitante", "gerente", "diretor", "csc", "admin");
  const supabase = await createClient();

  let query = supabase
    .from("ctrl_sectors")
    .select("*")
    .eq("active", true)
    .order("name");

  // admin vê todos os setores ativos; demais roles só os vinculados em user_sectors.
  if (!hasCtrlRole(ctx, "admin")) {
    const { data: links, error: linkErr } = await supabase
      .from("user_sectors")
      .select("sector_id")
      .eq("user_id", ctx.id);
    if (linkErr) return { error: linkErr.message };
    const ids = (links ?? []).map((l) => l.sector_id);
    if (ids.length === 0) return { sectors: [] as CtrlSector[] };
    query = query.in("id", ids);
  }

  const { data, error } = await query;
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
