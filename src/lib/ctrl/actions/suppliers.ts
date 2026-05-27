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

  await logSupplierHistory(supabase, {
    supplierId,
    userId: ctx.id,
    action: "aprovado",
    comment: `${expenseTypeIds.length} tipo(s) de despesa vinculado(s)`,
  });

  revalidatePath("/ctrl/admin/fornecedores");
  return { ok: true };
}

export async function rejectSupplier(supplierId: string, reason: string) {
  const ctx = await requireCtrlRole("csc", "admin", "aprovacao_fornecedor");
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

  await logSupplierHistory(supabase, {
    supplierId,
    userId: ctx.id,
    action: "rejeitado",
    comment: reason,
  });

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
    pix_key_type?: string | null;
    banco?: string | null;
    agencia?: string | null;
    conta_corrente?: string | null;
    titular_banco?: string | null;
    doc_titular?: string | null;
    transf_padrao?: boolean;
    pix_padrao?: boolean;
  },
) {
  // Any user in CTRL can edit a supplier they can see. The act of editing
  // resets the approval, so even non-approvers can effectively "demote"
  // a supplier back to pending — that's the desired behaviour (mistakes
  // in bank data need to be flagged for re-approval).
  const ctx = await requireCtrlRole("solicitante", "gerente", "diretor", "csc", "admin", "aprovacao_fornecedor");
  const adminClient = createAdminClientIfAvailable();
  const supabase = adminClient ?? (await createClient());

  // Snapshot do registro atual pra calcular diff antes do update.
  const { data: current } = await supabase
    .from("ctrl_suppliers")
    .select(
      "name, cnpj_cpf, email, phone, chave_pix, pix_key_type, banco, agencia, conta_corrente, titular_banco, doc_titular, transf_padrao, pix_padrao",
    )
    .eq("id", supplierId)
    .maybeSingle();

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
  if (data.pix_key_type !== undefined) payload.pix_key_type = data.pix_key_type?.trim() || null;
  if (data.banco !== undefined) payload.banco = data.banco?.trim() || null;
  if (data.agencia !== undefined) payload.agencia = data.agencia?.trim() || null;
  if (data.conta_corrente !== undefined) payload.conta_corrente = data.conta_corrente?.trim() || null;
  if (data.titular_banco !== undefined) payload.titular_banco = data.titular_banco?.trim() || null;
  if (data.doc_titular !== undefined) payload.doc_titular = data.doc_titular?.trim() || null;
  if (data.transf_padrao !== undefined) payload.transf_padrao = data.transf_padrao;
  if (data.pix_padrao !== undefined) payload.pix_padrao = data.pix_padrao;

  const { error } = await supabase
    .from("ctrl_suppliers")
    .update(payload)
    .eq("id", supplierId);

  if (error) return { error: error.message };

  // Calcula diff campo a campo (so loga campos do payload — descarta os
  // internos como status/approved_by que sao consequencia da edicao).
  const TRACKED = [
    "name",
    "cnpj_cpf",
    "email",
    "phone",
    "chave_pix",
    "pix_key_type",
    "banco",
    "agencia",
    "conta_corrente",
    "titular_banco",
    "doc_titular",
    "transf_padrao",
    "pix_padrao",
  ] as const;
  const changes: Record<string, [unknown, unknown]> = {};
  if (current) {
    for (const k of TRACKED) {
      if (k in payload) {
        const before = (current as Record<string, unknown>)[k] ?? null;
        const after = payload[k] ?? null;
        if (before !== after) changes[k] = [before, after];
      }
    }
  }

  await logSupplierHistory(supabase, {
    supplierId,
    userId: ctx.id,
    action: "editado",
    changes: Object.keys(changes).length > 0 ? changes : null,
  });

  revalidatePath("/ctrl/admin/fornecedores");
  return { ok: true };
}

export async function createSupplier(data: {
  name: string;
  cnpj_cpf?: string;
  email?: string;
  phone?: string;
  chave_pix?: string;
  pix_key_type?: string;
  banco?: string;
  agencia?: string;
  conta_corrente?: string;
  titular_banco?: string;
  doc_titular?: string;
  transf_padrao?: boolean;
  pix_padrao?: boolean;
}) {
  const ctx = await requireCtrlRole("solicitante", "gerente", "diretor", "csc", "admin");

  // CNPJ ou CPF é obrigatório — sem documento, fornecedor nao pode ser
  // identificado de forma unica e cria duplicatas no Omie.
  if (!data.cnpj_cpf?.trim()) {
    return { error: "Informe o CNPJ ou CPF do fornecedor." };
  }
  // requireCtrlRole already enforces auth + role. We use the admin client
  // here because RLS on ctrl_suppliers checks has_ctrl_role() against
  // user_module_roles directly — DRE admins (who get an implicit ctrl admin
  // in the session context) don't always have a matching row there, so the
  // insert would fail via the regular client.
  const adminClient = createAdminClientIfAvailable();
  const supabase = adminClient ?? (await createClient());

  const trimmedName = data.name.trim();
  if (!trimmedName) return { error: "O nome do fornecedor é obrigatório." };

  // Dedupe por CNPJ/CPF normalizado (só dígitos) — bloqueia mesmo se o
  // existente ainda estiver pendente, pra evitar fila de duplicatas em
  // aprovação.
  const normalizedDoc = data.cnpj_cpf.replace(/\D/g, "");
  if (normalizedDoc) {
    const { data: existing, error: dupErr } = await supabase
      .from("ctrl_suppliers")
      .select("id, name, status, cnpj_cpf")
      .neq("status", "rejeitado");
    if (dupErr) return { error: dupErr.message };
    const match = (existing ?? []).find(
      (s) => (s.cnpj_cpf ?? "").replace(/\D/g, "") === normalizedDoc,
    );
    if (match) {
      const statusLabel = match.status === "aprovado" ? "aprovado" : "em aprovação";
      return {
        error: `Já existe um fornecedor ${statusLabel} com este CNPJ/CPF: ${match.name}.`,
      };
    }
  }

  const { data: inserted, error } = await supabase
    .from("ctrl_suppliers")
    .insert({
      name: trimmedName,
      cnpj_cpf: data.cnpj_cpf?.trim() || null,
      email: data.email?.trim() || null,
      phone: data.phone?.trim() || null,
      chave_pix: data.chave_pix?.trim() || null,
      pix_key_type: data.pix_key_type?.trim() || null,
      banco: data.banco?.trim() || null,
      agencia: data.agencia?.trim() || null,
      conta_corrente: data.conta_corrente?.trim() || null,
      titular_banco: data.titular_banco?.trim() || null,
      doc_titular: data.doc_titular?.trim() || null,
      transf_padrao: data.transf_padrao ?? false,
      pix_padrao: data.pix_padrao ?? false,
      status: "pendente",
      created_by: ctx.id,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  await logSupplierHistory(supabase, {
    supplierId: inserted.id,
    userId: ctx.id,
    action: "criado",
  });

  revalidatePath("/ctrl/admin/fornecedores");
  return { supplierId: inserted.id };
}

// ─── Historico ───────────────────────────────────────────────────────────────

async function logSupplierHistory(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  params: {
    supplierId: string;
    userId: string;
    action: "criado" | "editado" | "aprovado" | "rejeitado";
    changes?: Record<string, [unknown, unknown]> | null;
    comment?: string | null;
  },
) {
  const { error } = await supabase.from("ctrl_supplier_history").insert({
    supplier_id: params.supplierId,
    user_id: params.userId,
    action: params.action,
    changes: params.changes ?? null,
    comment: params.comment ?? null,
  });
  if (error) console.error("[supplier_history] Falha ao registrar:", error);
}

export interface SupplierHistoryEntry {
  id: string;
  action: "criado" | "editado" | "aprovado" | "rejeitado" | string;
  changes: Record<string, [unknown, unknown]> | null;
  comment: string | null;
  createdAt: string;
  user: { id: string; name: string | null; email: string | null } | null;
}

export async function getSupplierHistory(
  supplierId: string,
): Promise<{ entries?: SupplierHistoryEntry[]; error?: string }> {
  await requireCtrlRole(
    "solicitante",
    "gerente",
    "diretor",
    "csc",
    "admin",
    "aprovacao_fornecedor",
  );
  const adminClient = createAdminClientIfAvailable();
  const supabase = adminClient ?? (await createClient());

  const { data, error } = await supabase
    .from("ctrl_supplier_history")
    .select(
      `id, action, changes, comment, created_at,
       user:users!ctrl_supplier_history_user_id_fkey(id, name, email)`,
    )
    .eq("supplier_id", supplierId)
    .order("created_at", { ascending: false });

  if (error) return { error: error.message };

  type Row = {
    id: string;
    action: string;
    changes: Record<string, [unknown, unknown]> | null;
    comment: string | null;
    created_at: string;
    user:
      | { id: string; name: string | null; email: string | null }
      | Array<{ id: string; name: string | null; email: string | null }>
      | null;
  };
  const entries: SupplierHistoryEntry[] = ((data ?? []) as Row[]).map((row) => {
    const u = Array.isArray(row.user) ? row.user[0] ?? null : row.user;
    return {
      id: row.id,
      action: row.action,
      changes: row.changes,
      comment: row.comment,
      createdAt: row.created_at,
      user: u,
    };
  });

  // Fornecedores aprovados antes do historico existir nao tem entry "aprovado".
  // Sintetiza uma a partir de approved_by/approved_at quando ausente.
  const hasApprovalEntry = entries.some((e) => e.action === "aprovado");
  if (!hasApprovalEntry) {
    const { data: sup } = await supabase
      .from("ctrl_suppliers")
      .select(
        `status, approved_at,
         approver:users!ctrl_suppliers_approved_by_fkey(id, name, email)`,
      )
      .eq("id", supplierId)
      .maybeSingle<{
        status: string;
        approved_at: string | null;
        approver:
          | { id: string; name: string | null; email: string | null }
          | Array<{ id: string; name: string | null; email: string | null }>
          | null;
      }>();

    if (sup?.status === "aprovado" && sup.approved_at) {
      const approver = Array.isArray(sup.approver) ? sup.approver[0] ?? null : sup.approver;
      entries.push({
        id: `synthetic-approval-${supplierId}`,
        action: "aprovado",
        changes: null,
        comment: null,
        createdAt: sup.approved_at,
        user: approver,
      });
      // Reordena para manter desc por data (a nova entry pode ser mais antiga ou
      // mais nova que algum edito subsequente).
      entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
  }

  return { entries };
}
