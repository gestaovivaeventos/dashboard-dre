import assert from "node:assert/strict";
import { test } from "node:test";

import { buildMonthlyStatement, monthBounds } from "@/lib/vb/report/monthly-statement";

function e(
  id: string,
  entry_date: string,
  kind: "entrada" | "saida" | "rendimento",
  amount: number,
  extra: Partial<{ description: string; period_start: string; period_end: string; rate: number }> = {},
) {
  return {
    id,
    entry_date,
    kind,
    amount,
    sort_order: 0,
    created_at: "2026-01-01T00:00:00Z",
    description: extra.description ?? null,
    period_start: extra.period_start ?? null,
    period_end: extra.period_end ?? null,
    rate: extra.rate ?? null,
  };
}

test("monthBounds fecha no último dia do mês e do mês anterior (inclusive fevereiro e virada de ano)", () => {
  assert.deepEqual(monthBounds("2026-03"), { first: "2026-03-01", last: "2026-03-31", previousLast: "2026-02-28" });
  assert.deepEqual(monthBounds("2026-01"), { first: "2026-01-01", last: "2026-01-31", previousLast: "2025-12-31" });
  assert.deepEqual(monthBounds("2028-02"), { first: "2028-02-01", last: "2028-02-29", previousLast: "2028-01-31" });
});

test("buildMonthlyStatement: abertura = tudo antes do mês, linhas com saldo corrente, fechamento = abertura + mês", () => {
  const s = buildMonthlyStatement(
    [
      e("a", "2026-03-15", "entrada", 100000),
      e("b", "2026-04-30", "rendimento", 1000, { period_start: "2026-03-15", period_end: "2026-04-30", rate: 0.01 }),
      e("c", "2026-05-04", "saida", -20000, { description: "resgate" }),
      e("d", "2026-05-22", "rendimento", 500, { period_start: "2026-04-30", period_end: "2026-05-22", rate: 0.0062 }),
      e("z", "2026-06-01", "entrada", 5000),
    ],
    "2026-05",
  );
  assert.equal(s.opening_balance, 101000);
  assert.equal(s.closing_balance, 81500);
  assert.equal(s.entradas, 0);
  assert.equal(s.saidas, -20000);
  assert.equal(s.rendimento, 500);
  assert.equal(s.rendimento_ano, 1500, "acumula os rendimentos do ano até o fim do mês");
  assert.deepEqual(
    s.lines.map((l) => [l.entry_date, l.description, l.balance]),
    [
      ["2026-05-04", "resgate", 81000],
      ["2026-05-22", "Rendimento", 81500],
    ],
  );
  assert.equal(s.lines[1].period_start, "2026-04-30");
  assert.equal(s.last_yield_end, "2026-05-22");
});

test("buildMonthlyStatement: rendimento datado no mês seguinte ainda conta como cobertura do mês", () => {
  const s = buildMonthlyStatement(
    [
      e("a", "2026-07-01", "entrada", 100000),
      e("b", "2026-09-14", "rendimento", 900, { period_start: "2026-08-01", period_end: "2026-09-14" }),
    ],
    "2026-08",
  );
  assert.equal(s.lines.length, 0);
  assert.equal(s.rendimento, 0, "o valor só aparece no mês em que a linha está datada");
  assert.equal(s.last_yield_end, "2026-09-14", "mas o mês está coberto: não é rendimento pendente");
});

test("buildMonthlyStatement: mês sem movimentação mantém o saldo e não tem linhas", () => {
  const s = buildMonthlyStatement([e("a", "2026-01-10", "entrada", 250.5)], "2026-05");
  assert.equal(s.opening_balance, 250.5);
  assert.equal(s.closing_balance, 250.5);
  assert.equal(s.lines.length, 0);
  assert.equal(s.last_yield_end, null);
});
