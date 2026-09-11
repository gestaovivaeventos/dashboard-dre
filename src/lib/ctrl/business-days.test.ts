import assert from "node:assert/strict";
import { test } from "node:test";

import { businessDayOnOrAfter, earliestDueDateBRT, formatBR, isBusinessDay } from "./business-days";

/** Instante UTC a partir de uma hora de Brasília (UTC-3, sem horário de verão desde 2019). */
function brt(ymd: string, time: string): Date {
  const [h, m, s] = time.split(":").map(Number);
  return new Date(`${ymd}T${String(h + 3).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}Z`);
}

test("isBusinessDay: fim de semana não é dia útil", () => {
  assert.equal(isBusinessDay("2026-09-11"), true); // sexta
  assert.equal(isBusinessDay("2026-09-12"), false); // sábado
  assert.equal(isBusinessDay("2026-09-13"), false); // domingo
  assert.equal(isBusinessDay("2026-09-14"), true); // segunda
});

test("isBusinessDay: feriados nacionais fixos", () => {
  for (const day of ["2026-01-01", "2026-04-21", "2026-05-01", "2026-09-07", "2026-11-20", "2026-12-25"]) {
    assert.equal(isBusinessDay(day), false, day);
  }
  // Véspera de Natal é dia útil: não é feriado nacional.
  assert.equal(isBusinessDay("2026-12-24"), true);
});

test("isBusinessDay: feriados móveis derivados da Páscoa (05/04/2026)", () => {
  assert.equal(isBusinessDay("2026-04-03"), false); // Sexta-feira Santa
  assert.equal(isBusinessDay("2026-02-16"), false); // segunda de Carnaval
  assert.equal(isBusinessDay("2026-02-17"), false); // terça de Carnaval
  assert.equal(isBusinessDay("2026-06-04"), false); // Corpus Christi
  assert.equal(isBusinessDay("2026-06-05"), true); // sexta seguinte
});

test("businessDayOnOrAfter devolve o próprio dia quando já é útil e pula o que não é", () => {
  assert.equal(businessDayOnOrAfter("2026-09-11"), "2026-09-11");
  assert.equal(businessDayOnOrAfter("2026-09-12"), "2026-09-14"); // sábado → segunda
  // 20/11 (sexta, Consciência Negra) → segunda 23/11.
  assert.equal(businessDayOnOrAfter("2026-11-20"), "2026-11-23");
});

test("earliestDueDateBRT: até o meio-dia vence no mesmo dia", () => {
  assert.equal(earliestDueDateBRT(brt("2026-09-11", "09:30:00")), "2026-09-11");
  // 12:00:00 em ponto ainda conta como "até o meio-dia".
  assert.equal(earliestDueDateBRT(brt("2026-09-11", "12:00:00")), "2026-09-11");
});

test("earliestDueDateBRT: depois do meio-dia só a partir do próximo dia útil", () => {
  assert.equal(earliestDueDateBRT(brt("2026-09-11", "12:00:01")), "2026-09-14"); // sexta tarde → segunda
  assert.equal(earliestDueDateBRT(brt("2026-09-10", "15:00:00")), "2026-09-11"); // quinta tarde → sexta
  assert.equal(earliestDueDateBRT(brt("2026-04-02", "14:00:00")), "2026-04-06"); // véspera da Sexta Santa → segunda
});

test("earliestDueDateBRT usa o fuso de Brasília, não o do servidor", () => {
  // 02:00 UTC de 12/09 ainda é 23:00 de 11/09 em Brasília (sexta, após o meio-dia).
  assert.equal(earliestDueDateBRT(new Date("2026-09-12T02:00:00Z")), "2026-09-14");
});

test("formatBR", () => {
  assert.equal(formatBR("2026-09-14"), "14/09/2026");
});
