"use server";

import { revalidatePath } from "next/cache";

import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireCtrlRole } from "@/lib/ctrl/auth";

// Itens de orçamento (rubricas) por setor × tipo × ano. Cada item tem orçado
// ANUAL próprio; a requisição aponta para um item e a verificação roda contra
// ele (Bloco 2). Ver migration 20260924140000_ctrl_budget_items.sql.

export interface BudgetItem {
  id: string;
  name: string;
  amount: number; // orçado anual
  active: boolean;
}

/**
 * Lista os itens de um setor × tipo × ano (ordenados por nome). Liberado a
 * qualquer papel do módulo — o formulário de nova requisição precisa listar.
 */
export async function listBudgetItems(
  sectorId: string,
  expenseTypeId: string,
  year: number,
): Promise<{ error: string } | { items: BudgetItem[] }> {
  await requireCtrlRole("solicitante", "gerente", "diretor", "csc", "contas_a_pagar", "admin");
  if (!sectorId || !expenseTypeId) return { items: [] };

  const db = createAdminClientIfAvailable() ?? (await createClient());
  const { data, error } = await db
    .from("ctrl_budget_items")
    .select("id, name, amount, active")
    .eq("sector_id", sectorId)
    .eq("expense_type_id", expenseTypeId)
    .eq("period_year", year)
    .order("name");
  if (error) return { error: error.message };

  return {
    items: (data ?? []).map((r) => ({
      id: r.id as string,
      name: r.name as string,
      amount: Number(r.amount ?? 0),
      active: Boolean(r.active),
    })),
  };
}

/** Cria ou atualiza um item. Nome único por setor × tipo × ano. Só admin/CSC/Contas a Pagar. */
export async function saveBudgetItem(input: {
  id?: string;
  sectorId: string;
  expenseTypeId: string;
  year: number;
  name: string;
  amount: number;
}): Promise<{ error: string } | { ok: true; id: string }> {
  const ctx = await requireCtrlRole("csc", "admin"); // admite admin + contas_a_pagar (csc)
  const admin = createAdminClientIfAvailable();
  if (!admin) return { error: "Operação indisponível: credencial de serviço ausente." };

  const name = input.name?.trim();
  if (!input.sectorId || !input.expenseTypeId) return { error: "Selecione setor e tipo de despesa." };
  if (!name) return { error: "Informe o nome do item." };
  const amount = Math.abs(Number(input.amount) || 0);

  const row = {
    sector_id: input.sectorId,
    expense_type_id: input.expenseTypeId,
    period_year: input.year,
    name,
    amount,
    updated_at: new Date().toISOString(),
    updated_by: ctx.id,
  };

  if (input.id) {
    const { error } = await admin.from("ctrl_budget_items").update(row).eq("id", input.id);
    if (error) {
      if ((error as { code?: string }).code === "23505") {
        return { error: "Já existe um item com esse nome neste setor/tipo/ano." };
      }
      return { error: error.message };
    }
    revalidatePath("/ctrl/orcamento/editar");
    return { ok: true, id: input.id };
  }

  const { data, error } = await admin.from("ctrl_budget_items").insert(row).select("id").single();
  if (error) {
    if ((error as { code?: string }).code === "23505") {
      return { error: "Já existe um item com esse nome neste setor/tipo/ano." };
    }
    return { error: error.message };
  }
  revalidatePath("/ctrl/orcamento/editar");
  return { ok: true, id: data.id as string };
}

/** Exclui um item. Bloqueia se houver requisição vinculada (integridade). */
export async function deleteBudgetItem(id: string): Promise<{ error: string } | { ok: true }> {
  await requireCtrlRole("csc", "admin");
  const admin = createAdminClientIfAvailable();
  if (!admin) return { error: "Operação indisponível: credencial de serviço ausente." };
  if (!id) return { error: "Item inválido." };

  const { count } = await admin
    .from("ctrl_requests")
    .select("id", { count: "exact", head: true })
    .eq("budget_item_id", id)
    .is("deleted_at", null);
  if ((count ?? 0) > 0) {
    return {
      error: `Não dá para excluir: ${count} requisição(ões) usam este item. Zere o orçado dele ou reatribua as requisições antes.`,
    };
  }

  const { error } = await admin.from("ctrl_budget_items").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/ctrl/orcamento/editar");
  return { ok: true };
}
