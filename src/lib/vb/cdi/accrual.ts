// src/lib/vb/cdi/accrual.ts
// Motor do rendimento por CDI. Puro: recebe os lançamentos e as taxas, devolve
// os lançamentos de rendimento que faltam. Nada de banco, nada de rede.
//
// Independente de ordem de propósito: reconstrói os segmentos a partir da
// linha do tempo, então gravar um movimento sem fechar o rendimento antes não
// corrompe o cálculo seguinte — ele simplesmente quebra o período naquela data.

import { sortLedger, type LedgerEntryLike } from "@/lib/vb/ledger";
import { roundCents } from "@/lib/vb/money";

export interface AccrualSegment {
  /** 'YYYY-MM-DD'. O saldo rendeu de (period_start, period_end]. */
  period_start: string;
  period_end: string;
  /** Convenção do histórico: fim − início, em dias corridos. */
  days: number;
  /** Saldo parado durante o período. */
  balance: number;
  /** Produto de (1 + taxa/100) dos dias úteis do intervalo. */
  factor: number;
  /** factor − 1, que é o que vai para vb_entries.rate. */
  rate: number;
  amount: number;
}

const MS_PER_DAY = 86_400_000;

function diffDays(a: string, b: string): number {
  const [ya, ma, da] = a.split("-").map(Number);
  const [yb, mb, db] = b.split("-").map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / MS_PER_DAY);
}

/** Último dia de cada mês com after < dia < until (exclusivo nas duas pontas: as bordas já são cortes). */
export function monthEndsBetween(after: string, until: string): string[] {
  const out: string[] = [];
  const [y, m] = after.split("-").map(Number);
  let year = y;
  let month = m;
  for (;;) {
    const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    if (end >= until) break;
    if (end > after) out.push(end);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return out;
}

/**
 * Produto de (1 + taxa/100) das datas d com after < d <= until. O dia em que um
 * período fecha é o mesmo em que o próximo abre, e a taxa dele conta uma vez só.
 */
export function accumulatedFactor(
  rates: ReadonlyMap<string, number>,
  after: string,
  until: string,
): number {
  if (until <= after) return 1;
  let factor = 1;
  for (const [date, rate] of Array.from(rates.entries())) {
    if (date > after && date <= until) factor *= 1 + rate / 100;
  }
  return factor;
}

export function planAccrual(input: {
  entries: readonly LedgerEntryLike[];
  rates: ReadonlyMap<string, number>;
  /** Ponto de partida, exclusivo. */
  from: string;
  /** Última data com taxa publicada, inclusiva. */
  until: string;
}): AccrualSegment[] {
  const { rates, from, until } = input;
  if (until <= from) return [];

  const sorted = sortLedger(input.entries);
  // Saldo que já existia no ponto de partida.
  let balance = 0;
  for (const entry of sorted) {
    if (entry.entry_date <= from) balance += entry.amount;
  }

  // Datas de lançamento DENTRO do intervalo abrem um segmento novo. Todo
  // último dia de mês também: o rendimento nunca atravessa a virada do mês,
  // para o extrato mensal sair com o rendimento do mês dentro do mês
  // (decisão 15/09/2026).
  const cuts = new Set<string>();
  for (const entry of sorted) {
    if (entry.entry_date > from && entry.entry_date <= until) cuts.add(entry.entry_date);
  }
  for (const monthEnd of monthEndsBetween(from, until)) cuts.add(monthEnd);
  const bounds = [from, ...Array.from(cuts).sort()];
  if (bounds[bounds.length - 1] !== until) bounds.push(until);

  const segments: AccrualSegment[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const period_start = bounds[i];
    const period_end = bounds[i + 1];
    const factor = accumulatedFactor(rates, period_start, period_end);
    const amount = roundCents(balance * (factor - 1));
    if (balance > 0 && factor > 1 && amount > 0) {
      segments.push({
        period_start,
        period_end,
        days: diffDays(period_start, period_end),
        balance: roundCents(balance),
        factor,
        rate: factor - 1,
        amount,
      });
      // O rendimento entra no extrato em period_end e rende no segmento seguinte.
      balance += amount;
    }
    // Os lançamentos datados no fim deste segmento valem do próximo em diante.
    for (const entry of sorted) {
      if (entry.entry_date === period_end) balance += entry.amount;
    }
  }
  return segments;
}
