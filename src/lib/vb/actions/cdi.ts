"use server";

// Ações do botão "Calcular rendimento". A lógica mora em cdi/service.ts
// (compartilhada com o cron do dia 5); aqui só o gate de gestor e o formato
// de resposta para a tela.

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireVbGestor } from "@/lib/vb/auth";
import { buildCdiPlan, CdiDuplicateError, postCdiPlan, type CdiPlan } from "@/lib/vb/cdi/service";
import { syncCdiRates } from "@/lib/vb/cdi/sync";
import type { VbActionResult } from "@/lib/vb/types";

export type { CdiAccrualItem } from "@/lib/vb/cdi/service";

async function syncQuietly() {
  try {
    await syncCdiRates();
  } catch (error) {
    // Sem internet o cálculo segue com o que já está gravado.
    console.error("[vb-cdi] sync failed, using stored rates", error);
  }
}

/**
 * Prévia. `creditorId` restringe ao credor da tela; sem ele, todos os
 * ativos. `upTo` fecha numa data (limitada à última taxa gravada).
 */
export async function previewCdiAccrual(creditorId?: string, upTo?: string): Promise<VbActionResult<CdiPlan>> {
  await requireVbGestor();
  await syncQuietly();
  try {
    const admin = createAdminClient();
    return { ok: true, ...(await buildCdiPlan(admin, { creditorIds: creditorId ? [creditorId] : undefined, upTo })) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Falha ao calcular o rendimento." };
  }
}

export async function postCdiAccrual(
  creditorId?: string,
  upTo?: string,
): Promise<VbActionResult<{ created: number; total: number }>> {
  const user = await requireVbGestor();
  await syncQuietly();
  try {
    const admin = createAdminClient();
    // Recalcula no servidor: a prévia do cliente nunca é entrada de dados.
    const plan = await buildCdiPlan(admin, { creditorIds: creditorId ? [creditorId] : undefined, upTo });
    const posted = await postCdiPlan(admin, plan, { userId: user.id });
    revalidatePath("/vb");
    revalidatePath("/vb/relatorios");
    for (const id of Array.from(new Set(plan.items.map((i) => i.creditor_id)))) {
      revalidatePath(`/vb/credores/${id}`);
    }
    return { ok: true, ...posted };
  } catch (error) {
    if (error instanceof CdiDuplicateError) revalidatePath("/vb");
    return { error: error instanceof Error ? error.message : "Falha ao gravar os rendimentos." };
  }
}
