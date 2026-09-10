import assert from "node:assert/strict";
import { test } from "node:test";

import { describeRendimento, formatPercent } from "@/lib/vb/format";

test("formatPercent em pt-BR", () => {
  assert.equal(formatPercent(0.0335), "3,35%");
  assert.equal(formatPercent(0.0075), "0,75%");
  assert.equal(formatPercent(0.148), "14,80%");
});

test("describeRendimento: período, dias e taxa por método", () => {
  assert.equal(
    describeRendimento({ period_start: "2026-01-01", period_end: "2026-03-31", days: 89, rate: 0.0335, rate_basis: "periodo" }),
    "01/01/2026 a 31/03/2026 · 89 dias · 3,35% no período",
  );
  assert.equal(
    describeRendimento({ period_start: "2017-08-08", period_end: "2018-05-01", days: 266, rate: 0.01, rate_basis: "mensal" }),
    "08/08/2017 a 01/05/2018 · 266 dias · 1,00% a.m.",
  );
  assert.equal(
    describeRendimento({ period_start: "2022-01-02", period_end: "2023-09-05", days: 611, rate: null, rate_basis: "ajuste" }),
    "02/01/2022 a 05/09/2023 · 611 dias · ajuste manual",
  );
  assert.equal(
    describeRendimento({ period_start: "2026-07-01", period_end: "2026-07-01", days: 0, rate: 0.001, rate_basis: "cdi" }),
    "01/07/2026 · 0 dias · 0,10% (CDI)",
  );
  assert.equal(describeRendimento({ period_start: null, period_end: null, days: null, rate: null, rate_basis: null }), null);
  assert.equal(describeRendimento({ period_start: null, period_end: null, days: 1, rate: null, rate_basis: null }), "1 dia");
});
