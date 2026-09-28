// Orçado × aprovado e o abre/fecha da árvore.
//
// A comparação vale em três telas (tabela, drilldown, Excel) e precisa dar o
// mesmo número nas três. O abre/fecha precisa esconder o ramo INTEIRO — fechar
// um grupo e continuar vendo os netos é o defeito clássico dessa feature.

import test from "node:test";
import assert from "node:assert/strict";

import {
  alternarFechada,
  comparar,
  compararSeries,
  linhasVisiveis,
  todasFechaveis,
} from "./previa-comparativo";

// ─── A comparação ────────────────────────────────────────────────────────────

test("diferença é aprovado − orçado, negativa enquanto falta aprovar", () => {
  const c = comparar(1000, 600);
  assert.equal(c.diferenca, -400);
  assert.equal(c.percentual, 60);
});

test("orçado zero não vira Infinity nem 0% — vira null", () => {
  // "Não dá para dizer" é diferente de "nada aprovado". A tela mostra "—".
  assert.equal(comparar(0, 0).percentual, null);
  assert.equal(comparar(0, 500).percentual, null);
});

test("nada aprovado é 0%, não null", () => {
  assert.equal(comparar(1000, 0).percentual, 0);
});

test("tudo aprovado é 100% e diferença zero", () => {
  const c = comparar(2400, 2400);
  assert.equal(c.percentual, 100);
  assert.equal(c.diferenca, 0);
});

test("compararSeries devolve 12 meses e o ano somado", () => {
  const orc = Array(12).fill(100);
  const apr = [100, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const r = compararSeries(orc, apr);
  assert.equal(r.meses.length, 12);
  assert.equal(r.ano.orcado, 1200);
  assert.equal(r.ano.aprovado, 200);
  assert.equal(r.meses[2].percentual, 0);
});

test("compararSeries aceita série curta sem quebrar", () => {
  const r = compararSeries([100], []);
  assert.equal(r.meses.length, 12);
  assert.equal(r.ano.orcado, 100);
  assert.equal(r.ano.aprovado, 0);
});

// ─── Abrir e fechar ──────────────────────────────────────────────────────────

const arvore = [
  { id: "a", code: "7", level: 1, hasChildren: true },
  { id: "b", code: "7.1", level: 2, hasChildren: true },
  { id: "c", code: "7.1.1", level: 3, hasChildren: false },
  { id: "d", code: "7.2", level: 2, hasChildren: false },
  { id: "e", code: "70", level: 1, hasChildren: false },
];

test("sem nada fechado, tudo aparece", () => {
  assert.equal(linhasVisiveis(arvore, new Set()).length, 5);
});

test("fechar o pai esconde o ramo INTEIRO, inclusive os netos", () => {
  // Esconder só o filho direto e deixar o neto à mostra é o defeito clássico.
  const vis = linhasVisiveis(arvore, new Set(["a"])).map((l) => l.code);
  assert.deepEqual(vis, ["7", "70"]);
});

test("a linha fechada continua visível — é por ela que se reabre", () => {
  assert.ok(linhasVisiveis(arvore, new Set(["b"])).some((l) => l.code === "7.1"));
});

test("fechar '7' não esconde '70' — é outra conta, não uma filha", () => {
  const vis = linhasVisiveis(arvore, new Set(["a"])).map((l) => l.code);
  assert.ok(vis.includes("70"));
});

test("alternar abre e fecha sem mutar o conjunto anterior", () => {
  const a = new Set<string>();
  const b = alternarFechada(a, "x");
  assert.equal(a.size, 0);
  assert.ok(b.has("x"));
  assert.equal(alternarFechada(b, "x").size, 0);
});

test("todasFechaveis pega só quem tem filhos", () => {
  assert.deepEqual(Array.from(todasFechaveis(arvore)).sort(), ["a", "b"]);
});
