"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { requireCtrlRole } from "@/lib/ctrl/auth";
import { normalizePixTelefone } from "@/lib/ctrl/bancos";
import type { CtrlSupplier } from "@/lib/supabase/types";
import { decryptSecret } from "@/lib/security/encryption";
import { syncSupplierToOmieUnit, type OmieSupplierData } from "@/lib/omie/clientes";

export async function getSuppliers(status?: "pendente" | "aprovado" | "rejeitado") {
  await requireCtrlRole("solicitante", "gerente", "diretor", "csc", "admin", "aprovacao_fornecedor");
  const supabase = await createClient();

  // A API limita 1000 linhas/requisição e já há >1000 fornecedores — pagina em
  // blocos para não cortar a cauda da lista (nomes com "T" em diante sumiam).
  const pageSize = 1000;
  const all: CtrlSupplier[] = [];
  for (let from = 0; ; from += pageSize) {
    let query = supabase
      .from("ctrl_suppliers")
      .select("*, ctrl_supplier_expense_types(ctrl_expense_types(id, name))")
      .order("name")
      .range(from, from + pageSize - 1);
    if (status) query = query.eq("status", status);

    const { data, error } = await query;
    if (error) return { error: error.message };
    all.push(...((data ?? []) as CtrlSupplier[]));
    if (!data || data.length < pageSize) break;
  }
  return { suppliers: all };
}

export async function approveSupplier(
  supplierId: string,
  expenseTypeIds: string[],
  companyIds: string[] = [],
) {
  const ctx = await requireCtrlRole("csc", "admin", "aprovacao_fornecedor");

  if (!Array.isArray(expenseTypeIds) || expenseTypeIds.length === 0) {
    return { error: "Selecione ao menos um tipo de despesa." };
  }

  const adminClient = createAdminClientIfAvailable();
  const supabase = adminClient ?? (await createClient());

  // Carrega o fornecedor (campos p/ Omie + flag).
  const { data: supplier, error: supErr } = await supabase
    .from("ctrl_suppliers")
    .select(
      "id, name, cnpj_cpf, email, phone, banco, agencia, conta_corrente, titular_banco, doc_titular, chave_pix, omie_sync_required",
    )
    .eq("id", supplierId)
    .maybeSingle();

  if (supErr || !supplier) return { error: "Fornecedor não encontrado." };

  if (supplier.omie_sync_required && companyIds.length === 0) {
    return { error: "Selecione ao menos uma unidade para cadastro no Omie." };
  }

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

  // Substitui os vínculos de tipo de despesa pelos selecionados.
  const { error: deleteError } = await supabase
    .from("ctrl_supplier_expense_types")
    .delete()
    .eq("supplier_id", supplierId);
  if (deleteError) return { error: deleteError.message };

  const { error: insertError } = await supabase
    .from("ctrl_supplier_expense_types")
    .insert(
      expenseTypeIds.map((expenseTypeId) => ({
        supplier_id: supplierId,
        expense_type_id: expenseTypeId,
      })),
    );
  if (insertError) return { error: insertError.message };

  // Sincroniza no Omie nas unidades selecionadas (só fornecedores do novo fluxo).
  const omieResults: { companyId: string; ok: boolean; error?: string }[] = [];
  if (supplier.omie_sync_required && companyIds.length > 0) {
    const { data: companies } = await supabase
      .from("companies")
      .select("id, name, omie_app_key, omie_app_secret")
      .in("id", companyIds);

    const supplierData: OmieSupplierData = {
      id: supplier.id,
      name: supplier.name,
      cnpj_cpf: supplier.cnpj_cpf,
      email: supplier.email,
      phone: supplier.phone,
      banco: supplier.banco,
      agencia: supplier.agencia,
      conta_corrente: supplier.conta_corrente,
      titular_banco: supplier.titular_banco,
      doc_titular: supplier.doc_titular,
      chave_pix: supplier.chave_pix,
    };

    for (const companyId of companyIds) {
      const company = (companies ?? []).find((c) => c.id === companyId);
      const now = new Date().toISOString();

      await supabase.from("ctrl_supplier_omie_links").upsert(
        { supplier_id: supplierId, company_id: companyId, sync_status: "pendente", updated_at: now },
        { onConflict: "supplier_id,company_id" },
      );

      if (!company?.omie_app_key || !company?.omie_app_secret) {
        await supabase
          .from("ctrl_supplier_omie_links")
          .update({ sync_status: "erro", sync_error: "Unidade sem credenciais Omie.", updated_at: now })
          .eq("supplier_id", supplierId)
          .eq("company_id", companyId);
        omieResults.push({ companyId, ok: false, error: "Unidade sem credenciais Omie." });
        continue;
      }

      try {
        const appKey = decryptSecret(company.omie_app_key);
        const appSecret = decryptSecret(company.omie_app_secret);
        const { codigoCliente } = await syncSupplierToOmieUnit(appKey, appSecret, supplierData);
        await supabase
          .from("ctrl_supplier_omie_links")
          .update({
            sync_status: "ok",
            omie_codigo_cliente: codigoCliente,
            sync_error: null,
            synced_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("supplier_id", supplierId)
          .eq("company_id", companyId);
        omieResults.push({ companyId, ok: true });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await supabase
          .from("ctrl_supplier_omie_links")
          .update({ sync_status: "erro", sync_error: msg, updated_at: new Date().toISOString() })
          .eq("supplier_id", supplierId)
          .eq("company_id", companyId);
        omieResults.push({ companyId, ok: false, error: msg });
      }
    }
  }

  const okCount = omieResults.filter((r) => r.ok).length;
  const errCount = omieResults.length - okCount;
  await logSupplierHistory(supabase, {
    supplierId,
    userId: ctx.id,
    action: "aprovado",
    comment:
      `${expenseTypeIds.length} tipo(s) de despesa` +
      (omieResults.length ? ` · Omie: ${okCount} ok, ${errCount} erro` : ""),
  });

  revalidatePath("/ctrl/admin/fornecedores");
  return { ok: true, omieResults };
}

// Reenvia o fornecedor ao Omie em uma unidade (botão "Reenviar ao Omie").
export async function resyncSupplierOmie(supplierId: string, companyId: string) {
  await requireCtrlRole("csc", "admin", "aprovacao_fornecedor");
  const adminClient = createAdminClientIfAvailable();
  const supabase = adminClient ?? (await createClient());

  const { data: supplier } = await supabase
    .from("ctrl_suppliers")
    .select(
      "id, name, cnpj_cpf, email, phone, banco, agencia, conta_corrente, titular_banco, doc_titular, chave_pix",
    )
    .eq("id", supplierId)
    .maybeSingle();
  if (!supplier) return { error: "Fornecedor não encontrado." };

  const { data: company } = await supabase
    .from("companies")
    .select("id, omie_app_key, omie_app_secret")
    .eq("id", companyId)
    .maybeSingle();
  if (!company?.omie_app_key || !company?.omie_app_secret) {
    return { error: "Unidade sem credenciais Omie." };
  }

  const now = new Date().toISOString();
  await supabase.from("ctrl_supplier_omie_links").upsert(
    { supplier_id: supplierId, company_id: companyId, sync_status: "pendente", updated_at: now },
    { onConflict: "supplier_id,company_id" },
  );

  try {
    const { codigoCliente } = await syncSupplierToOmieUnit(
      decryptSecret(company.omie_app_key),
      decryptSecret(company.omie_app_secret),
      supplier as OmieSupplierData,
    );
    await supabase
      .from("ctrl_supplier_omie_links")
      .update({
        sync_status: "ok",
        omie_codigo_cliente: codigoCliente,
        sync_error: null,
        synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("supplier_id", supplierId)
      .eq("company_id", companyId);
    revalidatePath("/ctrl/admin/fornecedores");
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await supabase
      .from("ctrl_supplier_omie_links")
      .update({ sync_status: "erro", sync_error: msg, updated_at: new Date().toISOString() })
      .eq("supplier_id", supplierId)
      .eq("company_id", companyId);
    return { error: msg };
  }
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
    // Qualquer edição passa a exigir (re)sync com o Omie na reaprovação.
    omie_sync_required: true,
  };
  if (data.name !== undefined) {
    const trimmed = data.name.trim();
    if (!trimmed) return { error: "O nome do fornecedor não pode ficar vazio." };
    if (trimmed.length > 60) {
      return { error: "O nome do fornecedor deve ter no máximo 60 caracteres (limite do Omie)." };
    }
    payload.name = trimmed;
  }
  if (data.cnpj_cpf !== undefined) {
    payload.cnpj_cpf = data.cnpj_cpf?.trim() || null;
    // Impede editar o documento para um que já pertence a outro fornecedor.
    const normalizedDoc = (payload.cnpj_cpf as string | null)?.replace(/\D/g, "") ?? "";
    if (normalizedDoc) {
      const { data: existing, error: dupErr } = await supabase.rpc(
        "ctrl_find_supplier_by_doc",
        { p_doc: payload.cnpj_cpf as string },
      );
      if (dupErr) return { error: dupErr.message };
      const match = ((existing ?? []) as Array<{ id: string; name: string; status: string }>)
        .find((s) => s.id !== supplierId);
      if (match) {
        const statusLabel = match.status === "aprovado" ? "aprovado" : "em aprovação";
        return {
          error: `Já existe um fornecedor ${statusLabel} com este CNPJ/CPF: ${match.name}.`,
        };
      }
    }
  }
  if (data.email !== undefined) payload.email = data.email?.trim() || null;
  if (data.phone !== undefined) payload.phone = data.phone?.trim() || null;
  if (data.chave_pix !== undefined) {
    const tipo = (data.pix_key_type ?? payload.pix_key_type)?.toString().trim();
    const chave = data.chave_pix?.trim() || null;
    payload.chave_pix = chave && tipo === "telefone" ? normalizePixTelefone(chave) : chave;
  }
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

  if (error) {
    if ((error as { code?: string }).code === "23505") {
      return { error: "Já existe um fornecedor com este CNPJ/CPF." };
    }
    return { error: error.message };
  }

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
  // 60 é o limite do campo no Omie (razao_social/nome_fantasia).
  if (trimmedName.length > 60) {
    return { error: "O nome do fornecedor deve ter no máximo 60 caracteres (limite do Omie)." };
  }

  // Dedupe por CNPJ/CPF normalizado (só dígitos) — bloqueia mesmo se o
  // existente ainda estiver pendente, pra evitar fila de duplicatas em
  // aprovação. A comparação roda no banco (ctrl_find_supplier_by_doc): o scan
  // antigo no JS era cortado em 1000 linhas pelo PostgREST e, com >1000
  // fornecedores, documentos além desse limite escapavam e permitiam recadastro.
  const normalizedDoc = data.cnpj_cpf.replace(/\D/g, "");
  if (normalizedDoc) {
    const { data: existing, error: dupErr } = await supabase.rpc(
      "ctrl_find_supplier_by_doc",
      { p_doc: data.cnpj_cpf },
    );
    if (dupErr) return { error: dupErr.message };
    const match = (existing ?? [])[0] as
      | { id: string; name: string; status: string; cnpj_cpf: string | null }
      | undefined;
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
      chave_pix:
        data.chave_pix?.trim() && data.pix_key_type?.trim() === "telefone"
          ? normalizePixTelefone(data.chave_pix)
          : data.chave_pix?.trim() || null,
      pix_key_type: data.pix_key_type?.trim() || null,
      banco: data.banco?.trim() || null,
      agencia: data.agencia?.trim() || null,
      conta_corrente: data.conta_corrente?.trim() || null,
      titular_banco: data.titular_banco?.trim() || null,
      doc_titular: data.doc_titular?.trim() || null,
      transf_padrao: data.transf_padrao ?? false,
      pix_padrao: data.pix_padrao ?? false,
      status: "pendente",
      omie_sync_required: true,
      created_by: ctx.id,
    })
    .select("id")
    .single();

  if (error) {
    // Índice único parcial (ctrl_suppliers_doc_norm_unique) — fallback caso o
    // dedupe acima perca uma corrida entre dois cadastros simultâneos.
    if ((error as { code?: string }).code === "23505") {
      return { error: "Já existe um fornecedor com este CNPJ/CPF." };
    }
    return { error: error.message };
  }

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
