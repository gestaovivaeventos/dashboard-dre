// src/lib/vb/report/monthly-statement.ts
// Extrato mensal de um credor: os números do relatório que vai por e-mail.
// Puro: recebe TODOS os lançamentos aprovados do credor e o mês, devolve
// saldo de abertura, movimentações do mês com saldo corrente e fechamento.
// O saldo nunca é lido do banco — é a soma em ordem cronológica (ledger.ts).

import { sortLedger, type LedgerEntryLike } from "@/lib/vb/ledger";
import { fromCents, sumCents, toCents } from "@/lib/vb/money";
import type { VbEntry } from "@/lib/vb/types";

export interface MonthlyStatementLine {
  entry_date: string;
  kind: VbEntry["kind"];
  description: string;
  amount: number;
  /** Saldo depois desta linha. */
  balance: number;
  /** Só rendimento: (period_start, period_end], taxa acumulada do período. */
  period_start: string | null;
  period_end: string | null;
  rate: number | null;
}

export interface MonthlyStatement {
  /** 'YYYY-MM' */
  month: string;
  /** Último dia do mês anterior / do mês, 'YYYY-MM-DD'. */
  opening_date: string;
  closing_date: string;
  opening_balance: number;
  closing_balance: number;
  entradas: number;
  saidas: number;
  rendimento: number;
  /** Rendimento acumulado no ano até o fim deste mês. */
  rendimento_ano: number;
  lines: MonthlyStatementLine[];
  /** Fim do último rendimento lançado até o fechamento — para avisar quando o mês não está fechado. */
  last_yield_end: string | null;
  /** Houve saldo positivo em algum momento do mês (abertura ou depois de alguma linha). */
  had_positive_balance: boolean;
}

type StatementEntry = LedgerEntryLike &
  Pick<VbEntry, "description" | "period_start" | "period_end" | "rate">;

function lastDayOf(year: number, month: number): string {
  const d = new Date(Date.UTC(year, month, 0));
  return d.toISOString().slice(0, 10);
}

export function monthBounds(month: string): { first: string; last: string; previousLast: string } {
  const [y, m] = month.split("-").map(Number);
  return {
    first: `${month}-01`,
    last: lastDayOf(y, m),
    previousLast: lastDayOf(y, m - 1),
  };
}

export function buildMonthlyStatement(entries: readonly StatementEntry[], month: string): MonthlyStatement {
  const { first, last, previousLast } = monthBounds(month);
  const sorted = sortLedger(entries);

  let running = 0;
  for (const e of sorted) if (e.entry_date < first) running += toCents(e.amount);
  const opening = running;

  const lines: MonthlyStatementLine[] = [];
  const inMonth = sorted.filter((e) => e.entry_date >= first && e.entry_date <= last);
  for (const e of inMonth) {
    running += toCents(e.amount);
    lines.push({
      entry_date: e.entry_date,
      kind: e.kind,
      description: (e.description ?? "").trim() || (e.kind === "rendimento" ? "Rendimento" : ""),
      amount: e.amount,
      balance: fromCents(running),
      period_start: e.kind === "rendimento" ? e.period_start : null,
      period_end: e.kind === "rendimento" ? e.period_end : null,
      rate: e.kind === "rendimento" ? e.rate : null,
    });
  }

  const year = month.slice(0, 4);
  const rendimentoAno = sumCents(
    sorted
      .filter((e) => e.kind === "rendimento" && e.entry_date >= `${year}-01-01` && e.entry_date <= last)
      .map((e) => e.amount),
  );
  const yieldEnds = sorted
    .filter((e) => e.kind === "rendimento" && e.entry_date <= last)
    .map((e) => e.period_end ?? e.entry_date);

  return {
    month,
    opening_date: previousLast,
    closing_date: last,
    opening_balance: fromCents(opening),
    closing_balance: fromCents(running),
    entradas: fromCents(sumCents(inMonth.filter((e) => e.kind === "entrada").map((e) => e.amount))),
    saidas: fromCents(sumCents(inMonth.filter((e) => e.kind === "saida").map((e) => e.amount))),
    rendimento: fromCents(sumCents(inMonth.filter((e) => e.kind === "rendimento").map((e) => e.amount))),
    rendimento_ano: fromCents(rendimentoAno),
    lines,
    last_yield_end: yieldEnds.length ? yieldEnds.sort().pop()! : null,
    had_positive_balance: opening > 0 || lines.some((l) => l.balance > 0),
  };
}
