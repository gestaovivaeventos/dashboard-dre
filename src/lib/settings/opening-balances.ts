"use server";

import { revalidatePath } from "next/cache";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// O "Saldo anterior ao Omie" é SEMPRE ancorado em JANEIRO/2022 — o corte da
// migração do Mundo Viva para a Omie. Ano/mês são fixos de propósito: a tela não
// os expõe; o Fluxo de Caixa usa esse valor como saldo inicial de 2022 e encadeia
// dali (empresa sem valor começa em zero). Ver
// src/app/(app)/fluxo-de-caixa/page.tsx (resolveSaldoInicialConsolidated).
const PRE_OMIE_YEAR = 2022;
const PRE_OMIE_MONTH = 1;

/**
 * Grava (ou limpa) o saldo inicial pré-Omie de várias empresas de uma vez.
 * Só admin. Valor `null`/vazio remove o override (Fluxo considera 0).
 */
export async function saveOpeningBalances(
  entries: Array<{ companyId: string; amount: number | null }>,
): Promise<{ ok: true; saved: number; cleared: number } | { error: string }> {
  const { user, profile } = await getCurrentSessionContext();
  if (!user) return { error: "Sessão expirada — refaça o login." };
  if (!profile || profile.role !== "admin") return { error: "Apenas administradores." };

  const db = createAdminClientIfAvailable() ?? (await createClient());
  const now = new Date().toISOString();

  let saved = 0;
  let cleared = 0;
  for (const e of entries) {
    if (!e.companyId) continue;

    if (e.amount === null || Number.isNaN(e.amount)) {
      // Vazio → sem override. Remove a linha (o Fluxo passa a considerar 0).
      const { error } = await db
        .from("cash_flow_opening_balances")
        .delete()
        .eq("company_id", e.companyId)
        .eq("period_year", PRE_OMIE_YEAR)
        .eq("period_month", PRE_OMIE_MONTH);
      if (error) return { error: error.message };
      cleared += 1;
      continue;
    }

    const { error } = await db.from("cash_flow_opening_balances").upsert(
      {
        company_id: e.companyId,
        period_year: PRE_OMIE_YEAR,
        period_month: PRE_OMIE_MONTH,
        amount: e.amount,
        notes: "Saldo anterior ao Omie (jan/2022) — ajuste manual.",
        updated_by: profile.id ?? user.id,
        updated_at: now,
      },
      { onConflict: "company_id,period_year,period_month" },
    );
    if (error) return { error: error.message };
    saved += 1;
  }

  // O Fluxo de Caixa lê os saldos a cada render; revalida o grupo (app) por
  // garantia (config + fluxo).
  revalidatePath("/(app)", "layout");
  return { ok: true, saved, cleared };
}
