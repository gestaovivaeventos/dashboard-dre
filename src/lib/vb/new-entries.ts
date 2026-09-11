// Monta as linhas de vb_entries de um "Novo lançamento": uma operação com uma
// ou mais linhas (credor · tipo · valor) que entram juntas no extrato —
// transferência entre credores, pagamento a vários no mesmo dia, juros do mês
// para todos. Função pura: a action só confere os credores e grava.

import { z } from "zod";

import { parseBrNumber } from "@/lib/orcamento/format";
import { diffDaysIso } from "@/lib/vb/import/excel-date";
import { roundCents } from "@/lib/vb/money";
import type { VbEntryInsert, VbEntryKind } from "@/lib/vb/types";

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

/**
 * Totais do formulário a partir do que foi digitado (strings BR). Linhas
 * inválidas são ignoradas — o submit é quem reclama delas. `bruto` (soma dos
 * módulos) é o número que se compara com o valor de um pagamento da Omie.
 */
export function sumTypedLines(
  lines: ReadonlyArray<{ kind: VbEntryKind; amount: string }>,
): { entradas: number; saidas: number; rendimentos: number; liquido: number; bruto: number } {
  let entradas = 0;
  let saidas = 0;
  let rendimentos = 0;
  let bruto = 0;
  for (const line of lines) {
    const raw = parseBrNumber(line.amount);
    if (raw == null || Number.isNaN(raw)) continue;
    bruto += Math.abs(raw);
    if (line.kind === "entrada") entradas += Math.abs(raw);
    else if (line.kind === "saida") saidas += Math.abs(raw);
    else rendimentos += raw;
  }
  return {
    entradas: roundCents(entradas),
    saidas: roundCents(saidas),
    rendimentos: roundCents(rendimentos),
    liquido: roundCents(entradas - saidas + rendimentos),
    bruto: roundCents(bruto),
  };
}

// ─── Composição das linhas no formulário ─────────────────────────────────────
// Puro de propósito: escolher o credor errado é o erro mais caro deste
// formulário (um lançamento de centenas de milhares no extrato de quem não
// devia), então a regra de quem entra e o que se replica fica testada.

export interface EntryLineDraft {
  creditorId: string;
  kind: VbEntryKind;
  amount: string;
}

/** Tipo e valor que uma linha nova herda: os da última linha JÁ preenchida. */
export function replicatedFrom(lines: readonly EntryLineDraft[]): { kind: VbEntryKind; amount: string } {
  const filled = [...lines].reverse().find((line) => line.amount.trim() !== "");
  const last = filled ?? lines[lines.length - 1];
  return { kind: last?.kind ?? "entrada", amount: last?.amount ?? "" };
}

/**
 * Liga ou desliga um credor na lista. Ligando, ocupa a primeira linha sem
 * credor (para não deixar linha órfã) ou acrescenta uma com o tipo e o valor
 * replicados. Desligando, tira as linhas dele — e nunca deixa a lista vazia.
 */
export function toggleCreditorLines<T extends EntryLineDraft>(
  lines: readonly T[],
  creditorId: string,
  make: (draft: EntryLineDraft) => T,
  max: number = VB_MAX_ENTRY_LINES,
): T[] {
  const mine = lines.filter((line) => line.creditorId === creditorId);
  if (mine.length > 0) {
    const rest = lines.filter((line) => line.creditorId !== creditorId);
    return rest.length > 0 ? rest : [make({ creditorId: "", kind: mine[0].kind, amount: mine[0].amount })];
  }
  if (lines.length >= max) return [...lines];
  const blank = lines.findIndex((line) => line.creditorId === "");
  if (blank >= 0) return lines.map((line, i) => (i === blank ? { ...line, creditorId } : line));
  return [...lines, make({ creditorId, ...replicatedFrom(lines) })];
}

/** Uma linha para cada credor ativo que ainda não está na lista, mesmo valor. */
export function addAllActiveLines<T extends EntryLineDraft>(
  lines: readonly T[],
  activeCreditorIds: readonly string[],
  make: (draft: EntryLineDraft) => T,
  max: number = VB_MAX_ENTRY_LINES,
): T[] {
  const seed = replicatedFrom(lines);
  const used = new Set(lines.map((line) => line.creditorId));
  const room = Math.max(max - lines.length, 0);
  const added = activeCreditorIds
    .filter((id) => !used.has(id))
    .slice(0, room)
    .map((creditorId) => make({ creditorId, ...seed }));
  // A linha em branco inicial some quando os nomes entram no lugar dela.
  const base = lines.length === 1 && lines[0].creditorId === "" && added.length > 0 ? [] : [...lines];
  return [...base, ...added];
}
