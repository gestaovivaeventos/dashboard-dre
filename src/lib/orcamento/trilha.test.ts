// A trilha: o diff de campos e a regra da trava da diretoria.
//
// O diff é o que decide se uma gravação vira registro ("alterou X de A para B")
// ou nada. Errar para o lado de "mudou" enche a trilha de ruído — updated_at em
// toda linha — e errar para o lado de "não mudou" perde a alteração que o
// gerente precisa ver no retorno.

import test from "node:test";
import assert from "node:assert/strict";

import { diffCampos, itemAtivo, travaOItem, abrePendencia } from "./trilha";

test("só os campos que mudaram entram no diff", () => {
  const r = diffCampos(
    { nome: "Ana", salario_atual: 3000, cargo_atual: "Analista" },
    { nome: "Ana", salario_atual: 3500, cargo_atual: "Analista" },
  );
  assert.deepEqual(r.antes, { salario_atual: 3000 });
  assert.deepEqual(r.depois, { salario_atual: 3500 });
  assert.equal(r.mudou, true);
});

test("gravação sem mudança real não vira registro", () => {
  const r = diffCampos({ nome: "Ana", salario_atual: 3000 }, { nome: "Ana", salario_atual: 3000 });
  assert.equal(r.mudou, false);
  assert.deepEqual(r.depois, {});
});

test("numeric do Postgres como string não conta como mudança", () => {
  // O banco devolve numeric como "3000.00"; o formulário manda 3000.
  const r = diffCampos({ valor_base: "3000.00" }, { valor_base: 3000 });
  assert.equal(r.mudou, false);
});

test("null, undefined e string vazia são o mesmo vazio", () => {
  assert.equal(diffCampos({ descricao: null }, { descricao: "" }).mudou, false);
  assert.equal(diffCampos({ descricao: undefined }, { descricao: null }).mudou, false);
  // Mas sair de vazio para um valor É mudança.
  assert.equal(diffCampos({ descricao: null }, { descricao: "Trello" }).mudou, true);
});

test("metadados de gravação são ignorados", () => {
  const r = diffCampos(
    { nome: "Ana", updated_at: "2026-01-01", updated_by: "u1" },
    { nome: "Ana", updated_at: "2026-09-23", updated_by: "u2" },
  );
  assert.equal(r.mudou, false, "updated_at/by não são alteração de orçamento");
});

test("campo ausente no patch não é mudança", () => {
  // As gravações são parciais: o que não veio não foi tocado.
  const r = diffCampos({ nome: "Ana", salario_atual: 3000 }, { salario_atual: 3000 });
  assert.equal(r.mudou, false);
});

test("lista vazia não é igual a zero", () => {
  // Guarda contra a comparação numérica frouxa (Number([]) === 0).
  assert.equal(diffCampos({ itens: [] }, { itens: 0 }).mudou, true);
  assert.equal(diffCampos({ ativo: true }, { ativo: "1" }).mudou, true);
});

test("jsonb é comparado por conteúdo", () => {
  assert.equal(diffCampos({ p: { a: 1 } }, { p: { a: 1 } }).mudou, false);
  assert.equal(diffCampos({ p: { a: 1 } }, { p: { a: 2 } }).mudou, true);
});

// ─── Trava da diretoria ──────────────────────────────────────────────────────

test("alteração do validador trava o item por padrão", () => {
  assert.equal(travaOItem("validador", "alterou", null), true);
  assert.equal(travaOItem("validador", "cancelou", undefined), true);
  assert.equal(travaOItem("validador", "moveu_categoria", false), true);
});

test('"Permitir que o gestor ajuste" é a única forma de NÃO travar', () => {
  assert.equal(travaOItem("validador", "alterou", true), false);
});

test("solicitação nunca trava — ela pressupõe que o construtor vá editar", () => {
  assert.equal(travaOItem("validador", "solicitou", null), false);
});

test("ação do construtor ou do admin nunca trava", () => {
  for (const papel of ["construtor", "construtor_amplo", "admin"] as const) {
    assert.equal(travaOItem(papel, "alterou", null), false, papel);
  }
});

test("solicitar e contestar abrem pendência; alterar não", () => {
  assert.ok(abrePendencia("solicitou"));
  assert.ok(abrePendencia("contestou"));
  assert.ok(!abrePendencia("alterou"));
  assert.ok(!abrePendencia("liberou"));
});

test("item cancelado não é ativo", () => {
  assert.equal(itemAtivo({ cancelado_em: null }), true);
  assert.equal(itemAtivo({}), true);
  assert.equal(itemAtivo(null), true, "linha ausente não é 'cancelada'");
  assert.equal(itemAtivo({ cancelado_em: "2026-09-23T12:00:00Z" }), false);
});
