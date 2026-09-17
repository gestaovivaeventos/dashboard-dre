import assert from "node:assert/strict";
import { test } from "node:test";

import { isMonthKey, previousMonth, reportStatusFor } from "@/lib/vb/report/status";

const base = {
  email: "credor@exemplo.com",
  closingDate: "2026-08-31",
  lastYieldEnd: "2026-08-31",
  hadPositiveBalance: true,
  hasOfficialSend: false,
};

test("enviado vence tudo, inclusive credor que perdeu o e-mail depois", () => {
  assert.equal(reportStatusFor({ ...base, hasOfficialSend: true, email: null, lastYieldEnd: null }), "enviado");
});

test("sem e-mail não envia", () => {
  assert.equal(reportStatusFor({ ...base, email: null }), "sem_email");
  assert.equal(reportStatusFor({ ...base, email: "" }), "sem_email");
});

test("rendimento pendente quando o último rendimento termina antes do fim do mês", () => {
  assert.equal(reportStatusFor({ ...base, lastYieldEnd: "2026-08-20" }), "rendimento_pendente");
  assert.equal(reportStatusFor({ ...base, lastYieldEnd: null }), "rendimento_pendente");
  assert.equal(reportStatusFor({ ...base, lastYieldEnd: "2026-09-11" }), "pronto", "rendimento além do mês cobre o mês");
});

test("saldo nunca positivo no mês não espera rendimento", () => {
  assert.equal(reportStatusFor({ ...base, lastYieldEnd: null, hadPositiveBalance: false }), "pronto");
});

test("previousMonth vira o ano", () => {
  assert.equal(previousMonth("2026-01"), "2025-12");
  assert.equal(previousMonth("2026-09"), "2026-08");
});

test("isMonthKey aceita só YYYY-MM válido", () => {
  assert.equal(isMonthKey("2026-08"), true);
  assert.equal(isMonthKey("2026-13"), false);
  assert.equal(isMonthKey("2026-8"), false);
  assert.equal(isMonthKey(null), false);
});
