import test from "node:test";
import assert from "node:assert/strict";

import { parseSnapshot, stableJson, EMPTY_SNAPSHOT } from "@/components/data-table/filter-logic";
import { defaultCaixaRealPrefs, parseCaixaRealPrefs, prefsKey } from "./prefs";

// ── parseSnapshot ──────────────────────────────────────────────────────────

test("snapshot: JSON válido passa inteiro", () => {
  const snap = parseSnapshot({
    values: { empresa: ["Terrazzo", "Feat"], status: [] },
    ranges: { saldo: { min: "1000", max: "" } },
    sortKey: "saldo",
    sortDir: "desc",
  });
  assert.deepEqual(snap.values, { empresa: ["Terrazzo", "Feat"], status: [] });
  assert.deepEqual(snap.ranges, { saldo: { min: "1000", max: "" } });
  assert.equal(snap.sortKey, "saldo");
  assert.equal(snap.sortDir, "desc");
});

test("snapshot: lista vazia é preservada — significa 'nada passa', não 'sem filtro'", () => {
  const snap = parseSnapshot({ values: { status: [] } });
  assert.deepEqual(snap.values.status, []);
});

test("snapshot: lixo é descartado campo a campo, o resto sobrevive", () => {
  const snap = parseSnapshot({
    values: { empresa: ["Terrazzo"], tipo: "não é lista", banco: [1, 2] },
    ranges: { saldo: { min: 5 }, variacao: { min: "", max: "" }, x: "?" },
    sortKey: 42,
    sortDir: "sideways",
  });
  assert.deepEqual(snap.values, { empresa: ["Terrazzo"] });
  assert.deepEqual(snap.ranges, {}, "faixa sem string válida ou toda vazia cai fora");
  assert.equal(snap.sortKey, null);
  assert.equal(snap.sortDir, "asc");
});

test("snapshot: null/primitivo vira vazio, nunca lança", () => {
  assert.deepEqual(parseSnapshot(null), EMPTY_SNAPSHOT);
  assert.deepEqual(parseSnapshot("x"), EMPTY_SNAPSHOT);
  assert.deepEqual(parseSnapshot(undefined), EMPTY_SNAPSHOT);
});

test("stableJson: ordem das chaves e dos valores não muda a chave", () => {
  const a = parseSnapshot({ values: { b: ["2", "1"], a: ["x"] }, sortKey: "a", sortDir: "asc" });
  const b = parseSnapshot({ values: { a: ["x"], b: ["1", "2"] }, sortKey: "a", sortDir: "asc" });
  assert.equal(stableJson(a), stableJson(b));
});

// ── parseCaixaRealPrefs ────────────────────────────────────────────────────

test("prefs: o padrão é ativas + dinheiro, 90 dias, todas as empresas", () => {
  const d = defaultCaixaRealPrefs();
  assert.deepEqual(d.table.values.status, ["Ativa"]);
  assert.deepEqual(d.table.values.tipo, ["Conta corrente", "Caixa físico", "Conta de pagamento"]);
  assert.equal(d.chartDays, 90);
  assert.equal(d.scope, null);
});

test("prefs: ida e volta pelo JSON é idempotente", () => {
  const d = defaultCaixaRealPrefs();
  const back = parseCaixaRealPrefs(JSON.parse(JSON.stringify(d)));
  assert.notEqual(back, null);
  assert.equal(prefsKey(back!), prefsKey(d));
});

test("prefs: versão desconhecida → null (a tela cai no padrão)", () => {
  assert.equal(parseCaixaRealPrefs({ v: 2, table: {} }), null);
  assert.equal(parseCaixaRealPrefs({}), null);
  assert.equal(parseCaixaRealPrefs(null), null);
});

test("prefs: janela inválida cai em 90 e escopo inválido em 'todas', sem perder a tabela", () => {
  const p = parseCaixaRealPrefs({
    v: 1,
    table: { values: { empresa: ["SGX"] } },
    chartDays: 7,
    scope: "todas",
  });
  assert.notEqual(p, null);
  assert.equal(p!.chartDays, 90);
  assert.equal(p!.scope, null);
  assert.deepEqual(p!.table.values, { empresa: ["SGX"] });
});

test("prefs: escopo é lembrado como lista de ids", () => {
  const p = parseCaixaRealPrefs({ v: 1, table: {}, chartDays: 30, scope: ["a", "b"] });
  assert.deepEqual(p!.scope, ["a", "b"]);
  assert.equal(p!.chartDays, 30);
});

test("prefsKey: mesmo escopo em outra ordem não conta como mudança", () => {
  const a = parseCaixaRealPrefs({ v: 1, table: {}, chartDays: 90, scope: ["b", "a"] })!;
  const b = parseCaixaRealPrefs({ v: 1, table: {}, chartDays: 90, scope: ["a", "b"] })!;
  assert.equal(prefsKey(a), prefsKey(b));
  const c = parseCaixaRealPrefs({ v: 1, table: {}, chartDays: 30, scope: ["a", "b"] })!;
  assert.notEqual(prefsKey(a), prefsKey(c));
});
