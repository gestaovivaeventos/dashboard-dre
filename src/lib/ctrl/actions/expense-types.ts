"use server";

import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { hasCtrlRole, requireCtrlRole } from "@/lib/ctrl/auth";
import type { CtrlExpenseType } from "@/lib/supabase/types";

export async function getExpenseTypes() {
  const ctx = await requireCtrlRole(
    "solicitante",
    "gerente",
    "diretor",
    "csc",
    "contas_a_pagar",
    "admin",
  );
  // O RLS de ctrl_expense_types nao cita contas_a_pagar — sem o admin client a
  // lista volta vazia e a Nova Requisicao fica sem tipo de despesa.
  const supabase = hasCtrlRole(ctx, "contas_a_pagar")
    ? createAdminClientIfAvailable() ?? (await createClient())
    : await createClient();

  const { data, error } = await supabase
    .from("ctrl_expense_types")
    .select("id, name, created_at, active")
    .eq("active", true)
    .order("name");

  if (error) return { error: error.message };
  return { expenseTypes: data as CtrlExpenseType[] };
}
