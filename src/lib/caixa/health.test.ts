import test from "node:test";
import assert from "node:assert/strict";

import { evaluateSyncHealth, type CaixaRunSummary } from "./health";
import { lastExpectedCronSlot } from "./schedule";

/** Instante em hora de Brasília (UTC−3) → Date. */
function brt(y: number, m: number, d: number, h: number, min = 0): Date {
  return new Date(Date.UTC(y, m - 1, d, h + 3, min));
}

function run(over: Partial<CaixaRunSummary> & { startedAt: string }): CaixaRunSummary {
  return {
    trigger: "cron",
    finishedAt: new Date(new Date(over.startedAt).getTime() + 90_000).toISOString(),
    companiesTotal: 26,
    companiesOk: 26,
    accountsError: 0,
    errors: [],
    ...over,
  };
}

// ── lastExpectedCronSlot ───────────────────────────────────────────────────

test("às 16:19, o último horário vencido é o das 12:30 de hoje", () => {
  const slot = lastExpectedCronSlot(brt(2026, 9, 17, 16, 19));
  assert.equal(slot?.label, "12:30");
  assert.equal(slot?.isToday, true);
  assert.equal(slot?.at.toISOString(), brt(2026, 9, 17, 12, 30).toISOString());
});

test("às 12:50 o das 12:30 ainda está na folga; vencido é o das 04:00", () => {
  const slot = lastExpectedCronSlot(brt(2026, 9, 17, 12, 50));
  assert.equal(slot?.label, "04:00");
  assert.equal(slot?.isToday, true);
});

test("às 04:20 o vencido é o das 12:30 de ONTEM", () => {
  const slot = lastExpectedCronSlot(brt(2026, 9, 17, 4, 20));
  assert.equal(slot?.label, "12:30");
  assert.equal(slot?.isToday, false);
  assert.equal(slot?.at.toISOString(), brt(2026, 9, 16, 12, 30).toISOString());
});

// ── evaluateSyncHealth ─────────────────────────────────────────────────────

test("cenário do pedido: 16:19, o cron das 12:30 falhou → avisa a falha", () => {
  const cron = run({
    startedAt: brt(2026, 9, 17, 12, 31).toISOString(),
    companiesOk: 24,
    accountsError: 3,
    errors: [{ company_name: "Terrazzo", error: "timeout" }, { company_name: "SGX", error: "401" }],
  });
  const alert = evaluateSyncHealth(cron, cron, brt(2026, 9, 17, 16, 19));
  assert.equal(alert?.kind, "failed");
  if (alert?.kind === "failed") {
    assert.equal(alert.companiesFailed, 2);
    assert.equal(alert.accountsFailed, 3);
    assert.deepEqual(alert.companies, ["Terrazzo", "SGX"]);
    assert.equal(alert.trigger, "cron");
  }
});

test("tudo certo: cron das 12:30 rodou limpo, são 16:19 → sem alerta", () => {
  const cron = run({ startedAt: brt(2026, 9, 17, 12, 31).toISOString() });
  assert.equal(evaluateSyncHealth(cron, cron, brt(2026, 9, 17, 16, 19)), null);
});

test("o cron das 12:30 não rodou (último foi o das 04:00) → 'não rodou'", () => {
  const cron = run({ startedAt: brt(2026, 9, 17, 4, 1).toISOString() });
  const alert = evaluateSyncHealth(cron, cron, brt(2026, 9, 17, 16, 19));
  assert.equal(alert?.kind, "missing");
  if (alert?.kind === "missing") {
    assert.equal(alert.expectedLabel, "12:30");
    assert.equal(alert.expectedToday, true);
  }
});

test("dentro da folga não alarma: 12:50 e o das 12:30 ainda não apareceu", () => {
  const cron = run({ startedAt: brt(2026, 9, 17, 4, 1).toISOString() });
  assert.equal(evaluateSyncHealth(cron, cron, brt(2026, 9, 17, 12, 50)), null);
});

test("manual bem-sucedida depois de cron com falha apaga a falha…", () => {
  const cron = run({
    startedAt: brt(2026, 9, 17, 12, 31).toISOString(),
    companiesOk: 25,
    errors: [{ company_name: "SGX", error: "x" }],
  });
  const manual = run({ trigger: "manual", startedAt: brt(2026, 9, 17, 14, 0).toISOString() });
  assert.equal(evaluateSyncHealth(manual, cron, brt(2026, 9, 17, 16, 19)), null);
});

test("…mas NÃO apaga o 'cron não rodou': o cron continua parado", () => {
  const cron = run({ startedAt: brt(2026, 9, 17, 4, 1).toISOString() });
  const manual = run({ trigger: "manual", startedAt: brt(2026, 9, 17, 14, 0).toISOString() });
  const alert = evaluateSyncHealth(manual, cron, brt(2026, 9, 17, 16, 19));
  assert.equal(alert?.kind, "missing");
});

test("execução que começou há 20 min e não terminou está morta", () => {
  const dead = run({
    startedAt: brt(2026, 9, 17, 12, 31).toISOString(),
    finishedAt: null,
  });
  const alert = evaluateSyncHealth(dead, dead, brt(2026, 9, 17, 12, 51));
  assert.equal(alert?.kind, "crashed");
});

test("execução que começou há 3 min e não terminou está só rodando", () => {
  const running = run({
    startedAt: brt(2026, 9, 17, 12, 31).toISOString(),
    finishedAt: null,
  });
  // Sem cron anterior e ainda dentro da folga do das 12:30: nada a avisar.
  const alert = evaluateSyncHealth(running, running, brt(2026, 9, 17, 12, 34));
  assert.equal(alert, null);
});

test("nunca rodou nada → 'não rodou' apontando o último horário vencido", () => {
  const alert = evaluateSyncHealth(null, null, brt(2026, 9, 17, 16, 19));
  assert.equal(alert?.kind, "missing");
  if (alert?.kind === "missing") assert.equal(alert.lastCronAt, null);
});
