// Matemática do extrato do VB. Tudo em centavos inteiros (ver money.ts). O
// saldo nunca é gravado no banco: é sempre recomputado daqui.

import { fromCents, sumCents, toCents } from "@/lib/vb/money";
import type { VbEntry } from "@/lib/vb/types";

export type LedgerEntryLike = Pick<
  VbEntry,
  "id" | "entry_date" | "sort_order" | "created_at" | "kind" | "amount"
>;

export type WithBalance<T> = T & { balance: number };

export interface LedgerTotals {
  entradas: number;
  /** Em módulo (positivo). */
  saidas: number;
  /** Com sinal — há rendimentos negativos (ajustes). */
  rendimentos: number;
  saldo: number;
}

export interface YearGroup<T extends LedgerEntryLike> {
  year: number;
  entries: WithBalance<T>[];
  totals: LedgerTotals;
  closingBalance: number;
}

export interface SemesterYield {
  year: number;
  semester: 1 | 2;
  total: number;
}

/** Ordem cronológica: data, depois ordem da planilha, depois criação. */
export function compareLedger(a: LedgerEntryLike, b: LedgerEntryLike): number {
  if (a.entry_date !== b.entry_date) return a.entry_date < b.entry_date ? -1 : 1;
  if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
  return 0;
}

export function sortLedger<T extends LedgerEntryLike>(entries: readonly T[]): T[] {
  return [...entries].sort(compareLedger);
}

function accumulate<T extends LedgerEntryLike>(ordered: T[], openingCents: number): WithBalance<T>[] {
  let cents = openingCents;
  return ordered.map((entry) => {
    cents += toCents(entry.amount);
    return { ...entry, balance: fromCents(cents) };
  });
}

/** Saldo corrente em ordem cronológica. */
export function withRunningBalance<T extends LedgerEntryLike>(
  entries: readonly T[],
  opening = 0,
): WithBalance<T>[] {
  return accumulate(sortLedger(entries), toCents(opening));
}

/**
 * Saldo em ordem de PLANILHA (sort_order). Usado só na revisão da importação,
 * para bater linha a linha com a coluna SALDO — a planilha tem datas fora de
 * ordem e o saldo dela segue a posição da linha.
 */
export function withSheetOrderBalance<T extends LedgerEntryLike>(
  entries: readonly T[],
): WithBalance<T>[] {
  const ordered = [...entries].sort((a, b) => a.sort_order - b.sort_order || compareLedger(a, b));
  return accumulate(ordered, 0);
}

export function ledgerTotals(entries: readonly LedgerEntryLike[]): LedgerTotals {
  let entradas = 0;
  let saidas = 0;
  let rendimentos = 0;
  for (const entry of entries) {
    const cents = toCents(entry.amount);
    if (entry.kind === "entrada") entradas += cents;
    else if (entry.kind === "saida") saidas += Math.abs(cents);
    else rendimentos += cents;
  }
  return {
    entradas: fromCents(entradas),
    saidas: fromCents(saidas),
    rendimentos: fromCents(rendimentos),
    saldo: fromCents(sumCents(entries.map((e) => e.amount))),
  };
}

export function currentBalance(entries: readonly LedgerEntryLike[]): number {
  return fromCents(sumCents(entries.map((e) => e.amount)));
}

function yearOf(entry: LedgerEntryLike): number {
  return Number(entry.entry_date.slice(0, 4));
}

/** Anos do mais recente ao mais antigo; dentro do ano, ordem cronológica. */
export function groupByYear<T extends LedgerEntryLike>(entries: readonly T[]): YearGroup<T>[] {
  const withBalance = withRunningBalance(entries);
  const byYear = new Map<number, WithBalance<T>[]>();
  for (const entry of withBalance) {
    const year = yearOf(entry);
    const list = byYear.get(year) ?? [];
    list.push(entry);
    byYear.set(year, list);
  }
  // Array.from, não spread: o tsconfig não tem downlevelIteration (padrão do repo).
  return Array.from(byYear.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([year, list]) => ({
      year,
      entries: list,
      totals: ledgerTotals(list),
      closingBalance: list[list.length - 1].balance,
    }));
}

export function yieldOf(entries: readonly LedgerEntryLike[], year: number): number {
  return fromCents(
    sumCents(entries.filter((e) => e.kind === "rendimento" && yearOf(e) === year).map((e) => e.amount)),
  );
}

export function yieldBySemester(
  entries: readonly LedgerEntryLike[],
  years: readonly number[],
): SemesterYield[] {
  const out: SemesterYield[] = [];
  for (const year of years) {
    for (const semester of [1, 2] as const) {
      const total = fromCents(
        sumCents(
          entries
            .filter((e) => {
              if (e.kind !== "rendimento" || yearOf(e) !== year) return false;
              const month = Number(e.entry_date.slice(5, 7));
              return semester === 1 ? month <= 6 : month >= 7;
            })
            .map((e) => e.amount),
        ),
      );
      out.push({ year, semester, total });
    }
  }
  return out;
}
