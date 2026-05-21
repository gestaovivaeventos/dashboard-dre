"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { requireCtrlRole } from "@/lib/ctrl/auth";
import type { CtrlSupplier } from "@/lib/supabase/types";

export async function getSuppliers(status?: "pendente" | "aprovado" | "rejeitado") {
  await requireCtrlRole("solicitante", "gerente", "diretor", "csc", "admin", "aprovacao_fornecedor");
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

export async function approveSupplier(
  supplierId: string,
  expenseTypeIds: string[],
) {
  const ctx = await requireCtrlRole("csc", "admin", "aprovacao_fornecedor");

  if (!Array.isArray(expenseTypeIds) || expenseTypeIds.length === 0) {
    return { error: "Selecione ao menos um tipo de despesa." };
  }

  const adminClient = createAdminClientIfAvailable();
  const supabase = adminClient ?? (await createClient());

  const { error: updateError } = await supabase
    .from("ctrl_suppliers")
    .update({
      status: "aprovado",
      approved_by: ctx.id,
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", supplierId);

  if (updateError) return { error: updateError.message };

  // Substitui os vinculos existentes pelos selecionados (idempotente em re-aprovacoes).
  const { error: deleteError } = await supabase
    .from("ctrl_supplier_expense_types")
    .delete()
    .eq("supplier_id", supplierId);

  if (deleteError) return { error: deleteError.message };

  const rows = expenseTypeIds.map((expenseTypeId) => ({
    supplier_id: supplierId,
    expense_type_id: expenseTypeId,
  }));

  const { error: insertError } = await supabase
    .from("ctrl_supplier_expense_types")
    .insert(rows);

  if (insertError) return { error: insertError.message };

  revalidatePath("/ctrl/admin/fornecedores");
  return { ok: true };
}

export async function rejectSupplier(supplierId: string, reason: string) {
  await requireCtrlRole("csc", "admin", "aprovacao_fornecedor");
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

export async function updateSupplier(
  supplierId: string,
  data: {
    name?: string;
    cnpj_cpf?: string | null;
    email?: string | null;
    phone?: string | null;
    chave_pix?: string | null;
    banco?: string | null;
    agencia?: string | null;
    conta_corrente?: string | null;
    titular_banco?: string | null;
    doc_titular?: string | null;
    transf_padrao?: boolean;
  },
) {
  // Any user in CTRL can edit a supplier they can see. The act of editing
  // resets the approval, so even non-approvers can effectively "demote"
  // a supplier back to pending — that's the desired behaviour (mistakes
  // in bank data need to be flagged for re-approval).
  await requireCtrlRole("solicitante", "gerente", "diretor", "csc", "admin", "aprovacao_fornecedor");
  const adminClient = createAdminClientIfAvailable();
  const supabase = adminClient ?? (await createClient());

  // Build an update payload that only touches the fields actually provided.
  // Empty strings explicitly mean "clear this field"; undefined means "leave
  // it alone".
  const payload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    // Any edit invalidates the previous approval — back to pending.
    status: "pendente",
    approved_by: null,
    approved_at: null,
    rejection_reason: null,
  };
  if (data.name !== undefined) {
    const trimmed = data.name.trim();
    if (!trimmed) return { error: "O nome do fornecedor não pode ficar vazio." };
    payload.name = trimmed;
  }
  if (data.cnpj_cpf !== undefined) payload.cnpj_cpf = data.cnpj_cpf?.trim() || null;
  if (data.email !== undefined) payload.email = data.email?.trim() || null;
  if (data.phone !== undefined) payload.phone = data.phone?.trim() || null;
  if (data.chave_pix !== undefined) payload.chave_pix = data.chave_pix?.trim() || null;
  if (data.banco !== undefined) payload.banco = data.banco?.trim() || null;
  if (data.agencia !== undefined) payload.agencia = data.agencia?.trim() || null;
  if (data.conta_corrente !== undefined) payload.conta_corrente = data.conta_corrente?.trim() || null;
  if (data.titular_banco !== undefined) payload.titular_banco = data.titular_banco?.trim() || null;
  if (data.doc_titular !== undefined) payload.doc_titular = data.doc_titular?.trim() || null;
  if (data.transf_padrao !== undefined) payload.transf_padrao = data.transf_padrao;

  const { error } = await supabase
    .from("ctrl_suppliers")
    .update(payload)
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
