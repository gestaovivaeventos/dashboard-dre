"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { requireCtrlRole } from "@/lib/ctrl/auth";
import type { CtrlSupplier } from "@/lib/supabase/types";

export async function getSuppliers(status?: "pendente" | "aprovado" | "rejeitado") {
  await requireCtrlRole("solicitante", "gerente", "diretor", "csc", "admin");
  const supabase = await createClient();

  let query = supabase
    .from("ctrl_suppliers")
    .select("*, ctrl_supplier_expense_types(ctrl_expense_types(id, name))")
    .order("name");

  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) return { error: error.message };
  return { suppliers: data as CtrlSupplier[] };
}

export async function approveSupplier(supplierId: string) {
  const ctx = await requireCtrlRole("csc", "admin");
  const adminClient = createAdminClientIfAvailable();
  const supabase = adminClient ?? (await createClient());

  const { error } = await supabase
    .from("ctrl_suppliers")
    .update({
      status: "aprovado",
      approved_by: ctx.id,
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", supplierId);

  if (error) return { error: error.message };
  revalidatePath("/ctrl/admin/fornecedores");
  return { ok: true };
}

export async function rejectSupplier(supplierId: string, reason: string) {
  await requireCtrlRole("csc", "admin");
  const adminClient = createAdminClientIfAvailable();
  const supabase = adminClient ?? (await createClient());

  const { error } = await supabase
    .from("ctrl_suppliers")
    .update({
      status: "rejeitado",
      rejection_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq("id", supplierId);

  if (error) return { error: error.message };
  revalidatePath("/ctrl/admin/fornecedores");
  return { ok: true };
}

export async function createSupplier(data: {
  name: string;
  cnpj_cpf?: string;
  email?: string;
  phone?: string;
}) {
  const ctx = await requireCtrlRole("solicitante", "gerente", "diretor", "csc", "admin");
  const supabase = await createClient();

  const { data: inserted, error } = await supabase
    .from("ctrl_suppliers")
    .insert({
      name: data.name,
      cnpj_cpf: data.cnpj_cpf ?? null,
      email: data.email ?? null,
      phone: data.phone ?? null,
      status: "pendente",
      created_by: ctx.id,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };
  revalidatePath("/ctrl/admin/fornecedores");
  return { supplierId: inserted.id };
}
