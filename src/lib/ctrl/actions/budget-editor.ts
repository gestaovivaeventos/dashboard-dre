"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { requireCtrlRole } from "@/lib/ctrl/auth";

// Edição manual da planilha previsto × realizado (ctrl_budget), por
// setor × tipo de despesa × mês. Alternativa ao upload — grava os mesmos dados.
export interface BudgetMonth {
  month: number; // 1..12
  amount: number; // orçado
  realized: number; // realizado
}

/** Carrega os 12 meses (orçado/realizado) de uma linha setor×tipo×ano. */
export async function getBudgetLine(
  sectorId: string,
  expenseTypeId: string,
  year: number,
): Promise<{ error: string } | { months: BudgetMonth[] }> {
  await requireCtrlRole("csc", "admin");
  if (!sectorId || !expenseTypeId) return { error: "Selecione setor e tipo de despesa." };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());
  const { data, error } = await supabase
    .from("ctrl_budget")
    .select("period_month, amount, realized")
    .eq("sector_id", sectorId)
    .eq("expense_type_id", expenseTypeId)
    .eq("period_year", year);
  if (error) return { error: error.message };

  const byMonth = new Map<number, { amount: number; realized: number }>();
  for (const r of data ?? []) {
    byMonth.set(r.period_month, {
      amount: Number(r.amount ?? 0),
      realized: Number(r.realized ?? 0),
    });
  }
  const months: BudgetMonth[] = Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    const v = byMonth.get(m);
    return { month: m, amount: v?.amount ?? 0, realized: v?.realized ?? 0 };
  });
  return { months };
}

/**
 * Grava a linha: faz upsert dos meses com valor e remove os zerados (mantém a
 * tabela limpa, sem linha 0/0). Chave única (setor, tipo, ano, mês).
 */
export async function saveBudgetLine(
  sectorId: string,
  expenseTypeId: string,
  year: number,
  months: BudgetMonth[],
): Promise<{ error: string } | { ok: true }> {
  await requireCtrlRole("csc", "admin");
  if (!sectorId || !expenseTypeId) return { error: "Selecione setor e tipo de despesa." };
  const admin = createAdminClientIfAvailable();
  if (!admin) return { error: "Operação indisponível: credencial de serviço ausente." };

  const clean = (months ?? []).filter((m) => m.month >= 1 && m.month <= 12);
  const toUpsert = clean
    .filter((m) => m.amount !== 0 || m.realized !== 0)
    .map((m) => ({
      sector_id: sectorId,
      expense_type_id: expenseTypeId,
      period_year: year,
      period_month: m.month,
      amount: Math.abs(m.amount),
      realized: Math.abs(m.realized),
    }));
  const zeroMonths = clean
    .filter((m) => m.amount === 0 && m.realized === 0)
    .map((m) => m.month);

  if (toUpsert.length > 0) {
    const { error } = await admin
      .from("ctrl_budget")
      .upsert(toUpsert, { onConflict: "sector_id,expense_type_id,period_year,period_month" });
    if (error) return { error: error.message };
  }
  if (zeroMonths.length > 0) {
    const { error } = await admin
      .from("ctrl_budget")
      .delete()
      .eq("sector_id", sectorId)
      .eq("expense_type_id", expenseTypeId)
      .eq("period_year", year)
      .in("period_month", zeroMonths);
    if (error) return { error: error.message };
  }

  revalidatePath("/ctrl/orcamento");
  revalidatePath("/ctrl/orcamento/editar");
  return { ok: true as const };
}
