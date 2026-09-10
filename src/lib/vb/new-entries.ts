// Monta as linhas de vb_entries de um "Novo lançamento": uma operação com uma
// ou mais linhas (credor · tipo · valor) que entram juntas no extrato —
// transferência entre credores, pagamento a vários no mesmo dia, juros do mês
// para todos. Função pura: a action só confere os credores e grava.

import { z } from "zod";

import { diffDaysIso } from "@/lib/vb/import/excel-date";
import { roundCents } from "@/lib/vb/money";
import type { VbEntryInsert } from "@/lib/vb/types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Teto por operação: cobre "juros do mês para todos" com folga. */
export const VB_MAX_ENTRY_LINES = 50;

export const newEntryLineSchema = z.object({
  creditor_id: z.string().uuid("Credor inválido."),
  kind: z.enum(["entrada", "saida", "rendimento"]),
  /**
   * Como digitado. Entrada e saída recebem o sinal do tipo (o módulo é o que
   * vale); rendimento mantém o sinal, porque negativo é ajuste legítimo.
   */
  amount: z.number(),
});

export const newEntriesSchema = z.object({
  entry_date: z.string().regex(ISO_DATE, "Data inválida."),
  /** Igual para todas as linhas. */
  description: z.string().max(300, "Descrição longa demais.").nullable(),
  /** Só valem para as linhas de rendimento; ignorados quando não há nenhuma. */
  period_start: z.string().regex(ISO_DATE, "Início do período inválido.").nullable(),
  period_end: z.string().regex(ISO_DATE, "Fim do período inválido.").nullable(),
  /** Fração (0.0335 = 3,35%). */
  rate: z.number().nullable(),
  rate_basis: z.enum(["periodo", "ajuste"]).nullable(),
  lines: z
    .array(newEntryLineSchema)
    .min(1, "Informe ao menos uma linha.")
    .max(VB_MAX_ENTRY_LINES, `No máximo ${VB_MAX_ENTRY_LINES} linhas por lançamento.`),
});

export type NewEntriesInput = z.infer<typeof newEntriesSchema>;
export type NewEntryLine = z.infer<typeof newEntryLineSchema>;

export type NewEntryRow = VbEntryInsert & { status: "aprovado"; group_id: string; created_by: string };

type YieldFields = Pick<VbEntryInsert, "period_start" | "period_end" | "days" | "rate" | "rate_basis">;

const NO_YIELD: YieldFields = { period_start: null, period_end: null, days: null, rate: null, rate_basis: null };

function yieldFields(input: NewEntriesInput): YieldFields | { error: string } {
  const period_end = input.period_end ?? input.entry_date;
  const period_start = input.period_start ?? period_end;
  if (period_start > period_end) return { error: "Início do período depois do fim." };
  const rate = input.rate;
  return {
    period_start,
    period_end,
    // Convenção herdada do histórico: fim − início.
    days: diffDaysIso(period_start, period_end),
    rate,
    // Sem taxa não existe "saldo × taxa": é ajuste, decida o formulário o que decidir.
    rate_basis: rate == null ? "ajuste" : (input.rate_basis ?? "periodo"),
  };
}

export function buildEntryRows(
  input: NewEntriesInput,
  ctx: { userId: string; groupId: string },
): { rows: NewEntryRow[] } | { error: string } {
  const hasYield = input.lines.some((line) => line.kind === "rendimento");
  const yields = hasYield ? yieldFields(input) : NO_YIELD;
  if ("error" in yields) return yields;
  const description = input.description?.trim() || null;

  const rows: NewEntryRow[] = [];
  for (let index = 0; index < input.lines.length; index++) {
    const line = input.lines[index];
    const magnitude = roundCents(Math.abs(line.amount));
    if (magnitude === 0) return { error: `Linha ${index + 1}: valor não pode ser zero.` };
    const amount =
      line.kind === "entrada" ? magnitude : line.kind === "saida" ? -magnitude : roundCents(line.amount);
    rows.push({
      creditor_id: line.creditor_id,
      entry_date: input.entry_date,
      kind: line.kind,
      amount,
      description,
      ...(line.kind === "rendimento" ? yields : NO_YIELD),
      status: "aprovado",
      import_batch_id: null,
      source_row: null,
      sheet_balance: null,
      // Posição na operação: duas linhas do mesmo credor no mesmo dia mantêm
      // a ordem digitada no extrato (o INSERT dá o mesmo created_at a todas).
      sort_order: index,
      flags: [],
      group_id: ctx.groupId,
      created_by: ctx.userId,
    });
  }
  return { rows };
}
