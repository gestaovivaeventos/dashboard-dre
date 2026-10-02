// O canal de status do stream.
//
// O defeito que estes testes impedem é o que motivou o módulo: silêncio durante a
// busca na web, que a pessoa lê como "travado". E o defeito que eles impedem de
// NASCER é a marca de status vazar para o texto — basta um quadro do streaming
// com o envelope pela metade para o usuário ver `\u0000pesquisando` no meio da
// resposta.

import test from "node:test";
import assert from "node:assert/strict";

import { marcarStatus, separarStatus } from "./stream-status";

const NUL = "\u0000";

test("texto sem marca nenhuma passa inteiro", () => {
  const r = separarStatus("Quantas pessoas vão nesta viagem?");
  assert.equal(r.texto, "Quantas pessoas vão nesta viagem?");
  assert.equal(r.status, null);
});

test("a marca sai do texto e vira status", () => {
  const bruto = marcarStatus("pesquisando preços") + "Encontrei duas opções.";
  const r = separarStatus(bruto);
  assert.equal(r.texto, "Encontrei duas opções.");
  assert.equal(r.status, "pesquisando preços");
});

test("envelope PELA METADE não vaza para o texto", () => {
  // É o caso de todo quadro do streaming em que a marca chegou cortada.
  const r = separarStatus(`${NUL}pesquisando pre`);
  assert.equal(r.texto, "", "nada do envelope pode aparecer na tela");
  assert.equal(r.status, "pesquisando pre");
});

test("o NUL de abertura sozinho não deixa resto visível", () => {
  const r = separarStatus(`Vou pesquisar.${NUL}`);
  assert.equal(r.texto, "Vou pesquisar.");
  assert.equal(r.status, null, "envelope vazio não é status");
});

test("status é o ÚLTIMO — descreve o passo atual, não o histórico", () => {
  const bruto =
    marcarStatus("pesquisando passagem") + marcarStatus("pesquisando hotel") + "Pronto.";
  const r = separarStatus(bruto);
  assert.equal(r.status, "pesquisando hotel");
  assert.equal(r.texto, "Pronto.");
});

test("texto ANTES e DEPOIS da marca é preservado, na ordem", () => {
  const bruto = `Vou conferir os preços.${marcarStatus("pesquisando")}Achei: R$ 800.`;
  const r = separarStatus(bruto);
  assert.equal(r.texto, "Vou conferir os preços.Achei: R$ 800.");
  assert.equal(r.status, "pesquisando");
});

test("marcarStatus não deixa NUL vazar de dentro do texto", () => {
  // NUL no meio partiria o envelope e o resto da resposta viraria status.
  const m = marcarStatus(`pesquisando${NUL}preços`);
  assert.equal(m, `${NUL}pesquisando preços${NUL}`);
  const r = separarStatus(m + "ok");
  assert.equal(r.texto, "ok");
  assert.equal(r.status, "pesquisando preços");
});

test("o status conviver com o cartão não interfere no corte do [[", () => {
  // O cliente aplica separarStatus ANTES de extrairCartaoViagem; aqui se garante
  // que o texto entregue a ele chega sem resíduo de envelope.
  const bruto = `${marcarStatus("pesquisando")}Fechei assim.\n[[VIAGEM]]{"paradas":[]}[[/VIAGEM]]`;
  const r = separarStatus(bruto);
  assert.equal(r.texto.includes(NUL), false);
  assert.ok(r.texto.startsWith("Fechei assim."));
});
