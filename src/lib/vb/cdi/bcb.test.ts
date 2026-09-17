// src/lib/vb/cdi/bcb.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { cdiRangeUrl, parseCdiPayload, toBcbDate } from "@/lib/vb/cdi/bcb";

test("toBcbDate converte ISO para o formato do Banco Central", () => {
  assert.equal(toBcbDate("2026-09-10"), "10/09/2026");
});

test("cdiRangeUrl monta a consulta da série 12", () => {
  const url = cdiRangeUrl("2026-09-01", "2026-09-10");
  assert.ok(url.includes("bcdata.sgs.12/dados"));
  assert.ok(url.includes("dataInicial=01%2F09%2F2026") || url.includes("dataInicial=01/09/2026"));
  assert.ok(url.includes("dataFinal=10%2F09%2F2026") || url.includes("dataFinal=10/09/2026"));
});

test("parseCdiPayload converte data e valor", () => {
  assert.deepEqual(parseCdiPayload([{ data: "10/09/2026", valor: "0.051660" }]), [
    { rate_date: "2026-09-10", rate: 0.05166 },
  ]);
});

test("parseCdiPayload ignora linhas quebradas em vez de derrubar a rotina", () => {
  const rows = parseCdiPayload([
    { data: "10/09/2026", valor: "0.051660" },
    { data: "sem data", valor: "0.05" },
    { data: "11/09/2026", valor: "abc" },
    { data: "11/09/2026" },
    null,
  ]);
  assert.deepEqual(rows, [{ rate_date: "2026-09-10", rate: 0.05166 }]);
});

test("parseCdiPayload devolve lista vazia para o corpo de erro do BCB", () => {
  // O 404 do SGS vem com este corpo quando não há taxa no intervalo.
  assert.deepEqual(parseCdiPayload({ erro: { statusCode: 404, detail: "Value(s) not found" } }), []);
  assert.deepEqual(parseCdiPayload(null), []);
});
