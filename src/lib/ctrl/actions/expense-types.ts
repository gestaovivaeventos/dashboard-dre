"use server";

import { createClient } from "@/lib/supabase/server";
import { requireCtrlRole } from "@/lib/ctrl/auth";
import type { CtrlExpenseType } from "@/lib/supabase/types";

export async function getExpenseTypes() {
  await requireCtrlRole("solicitante", "gerente", "diretor", "csc", "admin");
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("ctrl_expense_types")
    .select("id, name, created_at")
    .order("name");

  if (error) return { error: error.message };
  return { expenseTypes: data as CtrlExpenseType[] };
}
