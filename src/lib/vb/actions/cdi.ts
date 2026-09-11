"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireVbGestor } from "@/lib/vb/auth";
import { planAccrual } from "@/lib/vb/cdi/accrual";
import { VB_CDI_DESCRIPTION } from "@/lib/vb/cdi/config";
import { accrualStartFor, lastCdiDate, loadCdiRates } from "@/lib/vb/cdi/queries";
import { syncCdiRates } from "@/lib/vb/cdi/sync";
import { listCreditors, listEntries } from "@/lib/vb/queries";
import { fromCents, sumCents } from "@/lib/vb/money";
import type { VbActionResult, VbEntryInsert } from "@/lib/vb/types";

export interface CdiAccrualItem {
  creditor_id: string;
  creditor_name: string;
  period_start: string;
  period_end: string;
  days: number;
  balance: number;
  /** Fração acumulada do período (0.0025 = 0,25%). */
  rate: number;
  amount: number;
}

interface Plan {
  items: CdiAccrualItem[];
  total: number;
  lastRateDate: string | null;
}

/**
 * Calcula, sem gravar, o rendimento que falta para cada credor ativo. É a
 * mesma função que a gravação usa — a prévia nunca vira entrada de dados.
 */
async function buildPlan(): Promise<Plan> {
  const until = await lastCdiDate();
  if (!until) return { items: [], total: 0, lastRateDate: null };

  const admin = createAdminClient();
  const creditors = (await listCreditors(admin)).filter((c) => c.active);
  const rates = await loadCdiRates("1900-01-01");
  const items: CdiAccrualItem[] = [];

  for (const creditor of creditors) {
    const from = await accrualStartFor(creditor.id);
    if (until <= from) continue;
    const entries = await listEntries(admin, { status: "aprovado", creditorId: creditor.id });
    for (const segment of planAccrual({ entries, rates, from, until })) {
      items.push({
        creditor_id: creditor.id,
        creditor_name: creditor.name,
        period_start: segment.period_start,
        period_end: segment.period_end,
        days: segment.days,
        balance: segment.balance,
        rate: segment.rate,
        amount: segment.amount,
      });
    }
  }
  return { items, total: fromCents(sumCents(items.map((i) => i.amount))), lastRateDate: until };
}

/** Linha de vb_entries para um segmento calculado. */
function toEntryRow(item: CdiAccrualItem, groupId: string, userId: string, index: number): VbEntryInsert {
  return {
    creditor_id: item.creditor_id,
    entry_date: item.period_end,
    kind: "rendimento",
    amount: item.amount,
    description: VB_CDI_DESCRIPTION,
    period_start: item.period_start,
    period_end: item.period_end,
    days: item.days,
    rate: item.rate,
    rate_basis: "cdi",
    status: "aprovado",
    import_batch_id: null,
    source_row: null,
    sheet_balance: null,
    sort_order: index,
    flags: [],
    group_id: groupId,
    created_by: userId,
  };
}

export async function previewCdiAccrual(): Promise<VbActionResult<Plan>> {
  await requireVbGestor();
  try {
    await syncCdiRates();
  } catch (error) {
    // Sem internet o cálculo segue com o que já está gravado.
    console.error("[vb-cdi] sync failed, using stored rates", error);
  }
  try {
    return { ok: true, ...(await buildPlan()) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Falha ao calcular o rendimento." };
  }
}

export async function postCdiAccrual(): Promise<VbActionResult<{ created: number; total: number }>> {
  const user = await requireVbGestor();
  try {
    await syncCdiRates();
  } catch (error) {
    console.error("[vb-cdi] sync failed, using stored rates", error);
  }
  // Recalcula no servidor: a prévia do cliente nunca é entrada de dados.
  const plan = await buildPlan();
  if (plan.items.length === 0) return { ok: true, created: 0, total: 0 };

  const groupId = randomUUID();
  const rows = plan.items.map((item, index) => toEntryRow(item, groupId, user.id, index));
  const admin = createAdminClient();
  const { data, error } = await admin.from("vb_entries").insert(rows).select("id");
  if (error || !data) return { error: error?.message ?? "Falha ao gravar os rendimentos." };

  revalidatePath("/vb");
  for (const id of Array.from(new Set(plan.items.map((i) => i.creditor_id)))) {
    revalidatePath(`/vb/credores/${id}`);
  }
  return { ok: true, created: data.length, total: plan.total };
}

/**
 * Fecha o rendimento de alguns credores até `upTo`, para o lançamento manual.
 * Conveniência, não requisito: o motor reconstrói os segmentos, então lançar
 * sem fechar antes não corrompe o cálculo seguinte. Por isso nunca lança erro.
 */
export async function accrueForCreditors(
  creditorIds: readonly string[],
  upTo: string,
  /** Quem está gravando; quem chama já passou por requireVbGestor(). */
  userId: string,
): Promise<{ created: number; retroativo: boolean }> {
  try {
    const until = await lastCdiDate();
    if (!until) return { created: 0, retroativo: false };
    const limit = upTo < until ? upTo : until;

    const admin = createAdminClient();
    const rates = await loadCdiRates("1900-01-01");
    const rows: VbEntryInsert[] = [];
    const groupId = randomUUID();
    let retroativo = false;
    let index = 0;

    for (const creditorId of Array.from(new Set(creditorIds))) {
      const from = await accrualStartFor(creditorId);
      if (upTo < from) {
        retroativo = true;
        continue;
      }
      if (limit <= from) continue;
      const entries = await listEntries(admin, { status: "aprovado", creditorId });
      for (const segment of planAccrual({ entries, rates, from, until: limit })) {
        rows.push(
          toEntryRow(
            {
              creditor_id: creditorId,
              creditor_name: "",
              period_start: segment.period_start,
              period_end: segment.period_end,
              days: segment.days,
              balance: segment.balance,
              rate: segment.rate,
              amount: segment.amount,
            },
            groupId,
            userId,
            index++,
          ),
        );
      }
    }
    if (rows.length === 0) return { created: 0, retroativo };
    const { data, error } = await admin.from("vb_entries").insert(rows).select("id");
    if (error) {
      console.error("[vb-cdi] accrual before entry failed", error.message);
      return { created: 0, retroativo };
    }
    return { created: data?.length ?? 0, retroativo };
  } catch (error) {
    console.error("[vb-cdi] accrual before entry failed", error);
    return { created: 0, retroativo: false };
  }
}
