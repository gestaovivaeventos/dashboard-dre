import assert from "node:assert/strict";
import { test } from "node:test";

import { fromCents, roundCents, sumCents, toCents } from "@/lib/vb/money";

test("roundCents arredonda para centavos, simétrico", () => {
  assert.equal(roundCents(3613.8951), 3613.9);
  assert.equal(roundCents(-6484.0004), -6484);
  assert.equal(roundCents(0.005), 0.01);
  assert.equal(roundCents(-0.005), -0.01);
  assert.equal(roundCents(1.005), 1.01); // Math.round(1.005*100) daria 1.00
  assert.equal(roundCents(0.004), 0);
});

test("toCents/fromCents são inteiros e voltam ao valor", () => {
  assert.equal(toCents(331092.83), 33109283);
  assert.equal(toCents(-258593.57), -25859357);
  assert.equal(fromCents(33109283), 331092.83);
  assert.equal(Number.isInteger(toCents(0.1 + 0.2)), true);
});

test("sumCents soma sem erro binário", () => {
  assert.equal(fromCents(sumCents([0.1, 0.2, 0.3])), 0.6);
  assert.equal(fromCents(sumCents([40000, -37000, 3613.9])), 6613.9);
});
