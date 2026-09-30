// A abertura do orçado no drilldown do Budget.

import test from "node:test";
import assert from "node:assert/strict";

import { agruparDetalheOrcado } from "./budget-detalhe";

const nomes: Record<string, string> = { c1: "Terrazzo", c2: "Sirena" };
const nomeDe = (id: string) => nomes[id] ?? "";

test("a mesma despesa em 12 meses vira UMA linha somada", () => {
  const linhas = Array.from({ length: 12 }, () => ({ company_id: "c1", nome: "SAMS CLUB", valor: 100 }));
  assert.deepEqual(agruparDetalheOrcado(linhas, nomeDe, false), [
    { nome: "SAMS CLUB", valor: 1200 },
  ]);
});

test("ordena da maior para a menor", () => {
  const r = agruparDetalheOrcado(
    [
      { company_id: "c1", nome: "Pequena", valor: 10 },
      { company_id: "c1", nome: "Grande", valor: 900 },
      { company_id: "c1", nome: "Média", valor: 300 },
    ],
    nomeDe,
    false,
  );
  assert.deepEqual(r.map((i) => i.nome), ["Grande", "Média", "Pequena"]);
});

test("consolidado de VÁRIAS empresas não funde homônimos", () => {
  // Sem o nome da empresa, "Aluguel" das duas viraria uma linha de R$ 300 e o
  // leitor concluiria que existe um aluguel que custa o dobro.
  const r = agruparDetalheOrcado(
    [
      { company_id: "c1", nome: "Aluguel", valor: 100 },
      { company_id: "c2", nome: "Aluguel", valor: 200 },
    ],
    nomeDe,
    true,
  );
  assert.equal(r.length, 2);
  assert.deepEqual(r.map((i) => i.nome).sort(), ["Aluguel · Sirena", "Aluguel · Terrazzo"]);
});

test("uma empresa só não polui o rótulo", () => {
  const r = agruparDetalheOrcado([{ company_id: "c1", nome: "Aluguel", valor: 100 }], nomeDe, false);
  assert.deepEqual(r, [{ nome: "Aluguel", valor: 100 }]);
});

test("numeric em STRING soma, não concatena", () => {
  // O PostgREST pode entregar `numeric` como string; "100" + "200" daria
  // "100200" e o drilldown mostraria um número absurdo.
  const r = agruparDetalheOrcado(
    [
      { company_id: "c1", nome: "X", valor: "100.50" },
      { company_id: "c1", nome: "X", valor: "200.25" },
    ],
    nomeDe,
    false,
  );
  assert.deepEqual(r, [{ nome: "X", valor: 300.75 }]);
});

test("zero e valor inválido não viram linha", () => {
  const r = agruparDetalheOrcado(
    [
      { company_id: "c1", nome: "Zerada", valor: 0 },
      { company_id: "c1", nome: "Quebrada", valor: "abc" },
      { company_id: "c1", nome: "Boa", valor: 5 },
    ],
    nomeDe,
    false,
  );
  assert.deepEqual(r, [{ nome: "Boa", valor: 5 }]);
});

test("despesa sem nome não some da lista", () => {
  const r = agruparDetalheOrcado([{ company_id: "c1", nome: "  ", valor: 50 }], nomeDe, false);
  assert.deepEqual(r, [{ nome: "Sem nome", valor: 50 }]);
});

test("lista vazia devolve vazio", () => {
  assert.deepEqual(agruparDetalheOrcado([], nomeDe, false), []);
});
