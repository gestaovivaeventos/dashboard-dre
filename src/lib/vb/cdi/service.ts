// src/lib/vb/cdi/service.ts
// Rendimento por CDI: plano, gravação e RECONCILIAÇÃO. Server-only, sem
// "use server": é chamado pelas actions (depois de requireVbGestor) e pelo
// cron do dia 5 (fechamento do mês, sem sessão). Quem chama decide o gate.

import "server-only";

import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { planAccrual } from "@/lib/vb/cdi/accrual";
import { VB_CDI_DESCRIPTION } from "@/lib/vb/cdi/config";
import { accrualStartFor, lastCdiDate, loadCdiRates } from "@/lib/vb/cdi/queries";
import { fromCents, sumCents } from "@/lib/vb/money";
import { listCreditors, listEntries } from "@/lib/vb/queries";
import type { VbEntryInsert } from "@/lib/vb/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any>;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

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

export interface CdiPlan {
  items: CdiAccrualItem[];
  total: number;
  /** Última taxa gravada (teto do cálculo). */
  lastRateDate: string | null;
  /** Data efetiva de fechamento usada no plano. */
  until?: string;
}

/**
 * Calcula, sem gravar, o rendimento que falta — de todos os credores ativos
 * ou só dos `creditorIds`. Cada um parte do fim do PRÓPRIO último rendimento.
 * `upTo` fecha numa data escolhida (ex.: último dia do mês); nunca passa da
 * última taxa gravada. A prévia da tela e a gravação usam esta mesma função.
 */
export async function buildCdiPlan(
  admin: Admin,
  options: { creditorIds?: readonly string[]; upTo?: string } = {},
): Promise<CdiPlan> {
  const lastRate = await lastCdiDate();
  if (!lastRate) return { items: [], total: 0, lastRateDate: null };
  const upTo = options.upTo;
  const until = upTo && ISO_DAY.test(upTo) && upTo < lastRate ? upTo : lastRate;

  const wanted = options.creditorIds ? new Set(options.creditorIds) : null;
  const creditors = (await listCreditors(admin)).filter((c) => c.active && (!wanted || wanted.has(c.id)));
  const rates = await loadCdiRates("1900-01-01");
  const items: CdiAccrualItem[] = [];

  for (const creditor of creditors) {
    const from = await accrualStartFor(creditor.id);
    if (!from || until <= from) continue;
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
  return { items, total: fromCents(sumCents(items.map((i) => i.amount))), lastRateDate: lastRate, until };
}

function toEntryRow(
  item: CdiAccrualItem,
  groupId: string,
  userId: string | null,
  description: string,
  index: number,
): VbEntryInsert {
  return {
    creditor_id: item.creditor_id,
    entry_date: item.period_end,
    kind: "rendimento",
    amount: item.amount,
    description,
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

export class CdiDuplicateError extends Error {
  constructor() {
    super("Esse rendimento acabou de ser lançado por outra execução. Atualize a página.");
    this.name = "CdiDuplicateError";
  }
}

/**
 * Grava um plano. `userId` nulo = execução automática (cron). Um INSERT só:
 * entra tudo ou nada. O índice único (credor, fim do período) é a trava
 * contra duplo clique ou duas execuções ao mesmo tempo (23505).
 */
export async function postCdiPlan(
  admin: Admin,
  plan: CdiPlan,
  options: { userId: string | null; description?: string },
): Promise<{ created: number; total: number }> {
  if (plan.items.length === 0) return { created: 0, total: 0 };
  const groupId = randomUUID();
  const description = options.description ?? VB_CDI_DESCRIPTION;
  const rows = plan.items.map((item, index) => toEntryRow(item, groupId, options.userId, description, index));
  const { data, error } = await admin.from("vb_entries").insert(rows).select("id");
  if (error || !data) {
    if (error?.code === "23505") throw new CdiDuplicateError();
    throw new Error(error?.message ?? "Falha ao gravar os rendimentos.");
  }
  return { created: data.length, total: plan.total };
}

export interface CdiReconcileResult {
  /** Rendimentos por CDI apagados por ficarem depois da data alterada. */
  removed: number;
  /** Rendimentos regravados/fechados. */
  created: number;
  /** A data alterada era anterior ao último rendimento por CDI: houve recálculo. */
  retroativo: boolean;
  /**
   * A data alterada é anterior ao fim do histórico congelado (rendimentos
   * importados da planilha, `rate_basis` ≠ 'cdi'). Esses períodos são fatos
   * acordados com o credor e NÃO são recalculados — o saldo muda, mas o
   * rendimento antigo fica. Avisar, não impedir.
   */
  historicoCongelado: boolean;
}

/**
 * Depois de qualquer mudança na linha do tempo de um credor (lançamento
 * manual, vínculo/desvínculo da Omie) datada em `changedDate`:
 *
 *  1. apaga os rendimentos por CDI cujo período termina DEPOIS da data — eles
 *     foram calculados sobre um saldo que não é mais o verdadeiro;
 *  2. recalcula do último rendimento que sobrou até onde o mais tardio dos
 *     apagados chegava (ou até a própria data, quando nada foi apagado — é o
 *     "fecha o rendimento antes do lançamento" de sempre).
 *
 * O motor reconstrói os segmentos a partir da linha do tempo, então a regra
 * de negócio "lançamento retroativo recalcula tudo dali em diante" é só
 * apagar e recalcular. Cortes de fim de mês e de cada movimentação saem de
 * novo, com o saldo certo. Falhas nunca sobem: a próxima execução (botão ou
 * cron do dia 5) refaz o que faltar, porque o motro parte do que existe.
 */
export async function reconcileCdiAfterChange(
  admin: Admin,
  creditorIds: readonly string[],
  changedDate: string,
  userId: string | null,
): Promise<CdiReconcileResult> {
  const result: CdiReconcileResult = { removed: 0, created: 0, retroativo: false, historicoCongelado: false };
  try {
    const lastRate = await lastCdiDate();
    if (!lastRate) return result;

    for (const creditorId of Array.from(new Set(creditorIds))) {
      const { data: frozen, error: frozenError } = await admin
        .from("vb_entries")
        .select("period_end, entry_date")
        .eq("creditor_id", creditorId)
        .eq("status", "aprovado")
        .eq("kind", "rendimento")
        .neq("rate_basis", "cdi")
        .order("period_end", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      if (frozenError) throw new Error(frozenError.message);
      const frozenEnd = (frozen as { period_end: string | null; entry_date: string } | null)?.period_end ?? null;
      if (frozenEnd && changedDate < frozenEnd) result.historicoCongelado = true;

      const { data: removed, error: removeError } = await admin
        .from("vb_entries")
        .delete()
        .eq("creditor_id", creditorId)
        .eq("status", "aprovado")
        .eq("kind", "rendimento")
        .eq("rate_basis", "cdi")
        .gt("period_end", changedDate)
        .select("period_end");
      if (removeError) throw new Error(removeError.message);
      const ends = (removed ?? []).map((r) => r.period_end as string);
      result.removed += ends.length;
      if (ends.length > 0) result.retroativo = true;

      const horizon = ends.length > 0 ? ends.reduce((a, b) => (a > b ? a : b)) : changedDate;
      const plan = await buildCdiPlan(admin, { creditorIds: [creditorId], upTo: horizon });
      if (plan.items.length === 0) continue;
      const posted = await postCdiPlan(admin, plan, { userId });
      result.created += posted.created;
    }
  } catch (error) {
    console.error("[vb-cdi] reconcile failed", error);
  }
  return result;
}

/** Último dia do mês anterior a `today` ('YYYY-MM-DD'). */
export function previousMonthEnd(today: string): string {
  const [y, m] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10);
}
