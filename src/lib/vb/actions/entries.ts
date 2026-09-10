"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireVbGestor } from "@/lib/vb/auth";
import { diffDaysIso } from "@/lib/vb/import/excel-date";
import { roundCents } from "@/lib/vb/money";
import type { VbActionResult } from "@/lib/vb/types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const newEntrySchema = z.object({
  creditor_id: z.string().uuid("Credor inválido."),
  entry_date: z.string().regex(ISO_DATE, "Data inválida."),
  kind: z.enum(["entrada", "saida", "rendimento"]),
  /** Com sinal já aplicado pelo formulário (entrada +, saída −, rendimento ±). */
  amount: z.number(),
  description: z.string().trim().max(300, "Descrição longa demais.").nullable(),
  period_start: z.string().regex(ISO_DATE, "Início do período inválido.").nullable(),
  period_end: z.string().regex(ISO_DATE, "Fim do período inválido.").nullable(),
  /** Fração (0.0335 = 3,35%). */
  rate: z.number().nullable(),
  rate_basis: z.enum(["periodo", "ajuste"]).nullable(),
});

export type NewEntryInput = z.infer<typeof newEntrySchema>;

/**
 * Lançamento manual do gestor. Entra direto como 'aprovado' — a revisão é só
 * para a importação. O histórico aprovado não é editável nesta fase.
 */
export async function createVbEntry(input: NewEntryInput): Promise<VbActionResult<{ id: string }>> {
  const user = await requireVbGestor();
  const parsed = newEntrySchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  const v = parsed.data;

  const amount = roundCents(v.amount);
  if (amount === 0) return { error: "Valor não pode ser zero." };
  if (v.kind === "entrada" && amount < 0) return { error: "Entrada precisa ser positiva." };
  if (v.kind === "saida" && amount > 0) return { error: "Saída precisa ser negativa." };

  let period_start: string | null = null;
  let period_end: string | null = null;
  let days: number | null = null;
  let rate: number | null = null;
  let rate_basis: "periodo" | "ajuste" | null = null;
  if (v.kind === "rendimento") {
    period_end = v.period_end ?? v.entry_date;
    period_start = v.period_start ?? period_end;
    if (period_start > period_end) return { error: "Início do período depois do fim." };
    days = diffDaysIso(period_start, period_end);
    rate = v.rate;
    // Sem taxa não existe "saldo × taxa": é ajuste, decida o formulário o que decidir.
    rate_basis = rate == null ? "ajuste" : (v.rate_basis ?? "periodo");
  }

  const admin = createAdminClient();
  const { data: creditor, error: creditorError } = await admin
    .from("vb_creditors")
    .select("id")
    .eq("id", v.creditor_id)
    .maybeSingle();
  if (creditorError) return { error: creditorError.message };
  if (!creditor) return { error: "Credor não encontrado." };

  const { data, error } = await admin
    .from("vb_entries")
    .insert({
      creditor_id: v.creditor_id,
      entry_date: v.entry_date,
      kind: v.kind,
      amount,
      description: v.description || null,
      period_start,
      period_end,
      days,
      rate,
      rate_basis,
      status: "aprovado",
      sort_order: 0,
      flags: [],
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "Falha ao gravar." };

  revalidatePath("/vb");
  revalidatePath(`/vb/credores/${v.creditor_id}`);
  return { ok: true, id: data.id as string };
}
