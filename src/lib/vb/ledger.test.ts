import assert from "node:assert/strict";
import { test } from "node:test";

import {
  currentBalance,
  groupByYear,
  ledgerTotals,
  sortLedger,
  withRunningBalance,
  withSheetOrderBalance,
  yieldBySemester,
  yieldOf,
  type LedgerEntryLike,
} from "@/lib/vb/ledger";

function e(
  id: string,
  entry_date: string,
  kind: LedgerEntryLike["kind"],
  amount: number,
  sort_order = 0,
  created_at = "2026-09-09T00:00:00Z",
): LedgerEntryLike {
  return { id, entry_date, kind, amount, sort_order, created_at };
}

const ENTRIES = [
  e("r1", "2025-07-01", "rendimento", 100.5, 60),
  e("a1", "2025-01-10", "entrada", 1000, 51),
  e("s1", "2025-07-01", "saida", -200, 62),
  e("r2", "2026-03-31", "rendimento", 30.25, 70),
  e("m1", "2025-07-01", "entrada", 50, 0, "2026-09-10T00:00:00Z"),
];

test("sortLedger: data, depois sort_order, depois created_at", () => {
  assert.deepEqual(sortLedger(ENTRIES).map((x) => x.id), ["a1", "m1", "r1", "s1", "r2"]);
});

test("withRunningBalance acumula em centavos e aceita saldo de abertura", () => {
  const rows = withRunningBalance(ENTRIES);
  assert.deepEqual(rows.map((r) => [r.id, r.balance]), [
    ["a1", 1000],
    ["m1", 1050],
    ["r1", 1150.5],
    ["s1", 950.5],
    ["r2", 980.75],
  ]);
  assert.equal(withRunningBalance([e("x", "2026-01-01", "entrada", 0.1)], 0.2)[0].balance, 0.3);
});

test("withSheetOrderBalance usa a ordem da planilha (sort_order), não a data", () => {
  const rows = withSheetOrderBalance([
    e("b", "2023-07-20", "saida", -10, 620),
    e("a", "2023-09-13", "rendimento", 5, 630),
    e("z", "2023-01-01", "entrada", 100, 50),
  ]);
  assert.deepEqual(rows.map((r) => [r.id, r.balance]), [["z", 100], ["b", 90], ["a", 95]]);
});

test("ledgerTotals: saídas em módulo, rendimentos com sinal, saldo = soma", () => {
  assert.deepEqual(ledgerTotals(ENTRIES), { entradas: 1050, saidas: 200, rendimentos: 130.75, saldo: 980.75 });
  assert.equal(currentBalance(ENTRIES), 980.75);
  assert.deepEqual(ledgerTotals([]), { entradas: 0, saidas: 0, rendimentos: 0, saldo: 0 });
});

test("groupByYear: anos do mais recente ao mais antigo, saldo de fechamento acumulado", () => {
  const groups = groupByYear(ENTRIES);
  assert.deepEqual(groups.map((g) => g.year), [2026, 2025]);
  assert.equal(groups[1].closingBalance, 950.5);
  assert.equal(groups[0].closingBalance, 980.75);
  assert.deepEqual(groups[1].entries.map((x) => x.id), ["a1", "m1", "r1", "s1"]);
  assert.equal(groups[1].totals.rendimentos, 100.5);
  assert.equal(groups[0].entries[0].balance, 980.75);
});

test("yieldOf e yieldBySemester", () => {
  assert.equal(yieldOf(ENTRIES, 2025), 100.5);
  assert.equal(yieldOf(ENTRIES, 2024), 0);
  assert.deepEqual(yieldBySemester(ENTRIES, [2025, 2026]), [
    { year: 2025, semester: 1, total: 0 },
    { year: 2025, semester: 2, total: 100.5 },
    { year: 2026, semester: 1, total: 30.25 },
    { year: 2026, semester: 2, total: 0 },
  ]);
});

test("compareLedger: mesma data e mesmo sort_order → desempata por created_at", () => {
  const later = e("b", "2026-01-15", "entrada", 10, 0, "2026-09-10T12:00:00Z");
  const earlier = e("a", "2026-01-15", "entrada", 5, 0, "2026-09-10T08:00:00Z");
  assert.deepEqual(sortLedger([later, earlier]).map((x) => x.id), ["a", "b"]);
  assert.deepEqual(withRunningBalance([later, earlier]).map((x) => [x.id, x.balance]), [["a", 5], ["b", 15]]);
});

test("rendimento negativo (ajuste) reduz o saldo e entra com sinal nos totais", () => {
  const entries = [
    e("a1", "2024-01-10", "entrada", 1000, 51),
    e("r1", "2024-06-30", "rendimento", 50, 60),
    e("r2", "2024-07-26", "rendimento", -6484, 70),
    e("r3", "2025-03-31", "rendimento", 25.5, 80),
  ];
  assert.deepEqual(ledgerTotals(entries), { entradas: 1000, saidas: 0, rendimentos: -6408.5, saldo: -5408.5 });
  assert.equal(currentBalance(entries), -5408.5);
  const groups = groupByYear(entries);
  assert.deepEqual(groups.map((g) => [g.year, g.totals.rendimentos, g.closingBalance]), [
    [2025, 25.5, -5408.5],
    [2024, -6434, -5434],
  ]);
  assert.equal(yieldOf(entries, 2024), -6434);
});
