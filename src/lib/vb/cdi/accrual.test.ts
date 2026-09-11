// src/lib/vb/cdi/accrual.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { accumulatedFactor, planAccrual } from "@/lib/vb/cdi/accrual";
import type { LedgerEntryLike } from "@/lib/vb/ledger";

/** 0,05% ao dia em todos os dias úteis de 11 a 18/09/2026 (13 e 14 são fim de semana). */
const RATES = new Map<string, number>([
  ["2026-09-11", 0.05],
  ["2026-09-15", 0.05],
  ["2026-09-16", 0.05],
  ["2026-09-17", 0.05],
  ["2026-09-18", 0.05],
]);

function entry(id: string, entry_date: string, amount: number, sort_order = 0): LedgerEntryLike {
  return { id, entry_date, amount, kind: amount >= 0 ? "entrada" : "saida", sort_order, created_at: "2026-09-01T00:00:00Z" };
}

test("accumulatedFactor multiplica só as taxas do intervalo meio aberto", () => {
  // (10/09, 11/09] = um dia útil.
  assert.equal(accumulatedFactor(RATES, "2026-09-10", "2026-09-11").toFixed(8), (1.0005).toFixed(8));
  // (11/09, 18/09] = 15, 16, 17 e 18 — o 11 já foi contado no período anterior.
  assert.equal(accumulatedFactor(RATES, "2026-09-11", "2026-09-18").toFixed(8), Math.pow(1.0005, 4).toFixed(8));
  // Intervalo sem dia útil não rende.
  assert.equal(accumulatedFactor(RATES, "2026-09-11", "2026-09-14"), 1);
  // Fim antes do início não rende.
  assert.equal(accumulatedFactor(RATES, "2026-09-18", "2026-09-11"), 1);
});

test("planAccrual: saldo parado o período inteiro vira um lançamento só", () => {
  const rows = planAccrual({
    entries: [entry("a", "2026-09-01", 100000)],
    rates: RATES,
    from: "2026-09-10",
    until: "2026-09-18",
  });
  assert.equal(rows.length, 1);
  const [row] = rows;
  assert.equal(row.period_start, "2026-09-10");
  assert.equal(row.period_end, "2026-09-18");
  assert.equal(row.days, 8);
  assert.equal(row.balance, 100000);
  // Cinco dias úteis: 11, 15, 16, 17 e 18.
  assert.equal(row.rate.toFixed(8), (Math.pow(1.0005, 5) - 1).toFixed(8));
  assert.equal(row.amount, 250.25);
});

test("planAccrual: cada lançamento no meio do caminho quebra o período", () => {
  const rows = planAccrual({
    entries: [entry("a", "2026-09-01", 100000), entry("b", "2026-09-16", 50000)],
    rates: RATES,
    from: "2026-09-10",
    until: "2026-09-18",
  });
  assert.deepEqual(
    rows.map((r) => [r.period_start, r.period_end, r.balance]),
    [
      ["2026-09-10", "2026-09-16", 100000],
      // 100.000 + 150,08 de rendimento do primeiro período + os 50.000 do dia 16.
      ["2026-09-16", "2026-09-18", 150150.08],
    ],
  );
  assert.equal(rows[0].amount, 150.08);
  assert.equal(rows[1].amount, 150.19);
  // O dia 16 entra só no primeiro período; o segundo pega 17 e 18.
  assert.equal(rows[0].rate.toFixed(8), (Math.pow(1.0005, 3) - 1).toFixed(8));
  assert.equal(rows[1].rate.toFixed(8), (Math.pow(1.0005, 2) - 1).toFixed(8));
});

test("planAccrual: o rendimento de um período rende no seguinte (juros sobre juros)", () => {
  const rows = planAccrual({
    entries: [entry("a", "2026-09-01", 100000), entry("b", "2026-09-16", 0.01)],
    rates: RATES,
    from: "2026-09-10",
    until: "2026-09-18",
  });
  // 100.000 + 150,08 do primeiro período + o centavo lançado no dia 16.
  assert.equal(rows[1].balance, 100150.09);
});

test("planAccrual: saldo negativo e saldo zero não geram lançamento", () => {
  assert.deepEqual(
    planAccrual({ entries: [entry("a", "2026-09-01", -5000)], rates: RATES, from: "2026-09-10", until: "2026-09-18" }),
    [],
  );
  assert.deepEqual(
    planAccrual({ entries: [], rates: RATES, from: "2026-09-10", until: "2026-09-18" }),
    [],
  );
});

test("planAccrual: período sem taxa publicada não gera lançamento", () => {
  assert.deepEqual(
    planAccrual({ entries: [entry("a", "2026-09-01", 100000)], rates: RATES, from: "2026-09-11", until: "2026-09-14" }),
    [],
  );
});

test("planAccrual é idempotente: partir do fim do período gerado não produz nada", () => {
  const first = planAccrual({
    entries: [entry("a", "2026-09-01", 100000)],
    rates: RATES,
    from: "2026-09-10",
    until: "2026-09-18",
  });
  const again = planAccrual({
    entries: [entry("a", "2026-09-01", 100000)],
    rates: RATES,
    from: first[0].period_end,
    until: "2026-09-18",
  });
  assert.deepEqual(again, []);
});

test("planAccrual ignora lançamento anterior ao início, mas soma no saldo", () => {
  const rows = planAccrual({
    entries: [entry("a", "2026-08-01", 40000), entry("b", "2026-09-05", 60000)],
    rates: RATES,
    from: "2026-09-10",
    until: "2026-09-11",
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].balance, 100000, "os dois já estavam no saldo antes do início");
});
