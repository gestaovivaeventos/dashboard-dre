// A linha "Resultado do Exercício" do Fluxo de Caixa lê UMA conta do DRE. Se o
// code apontar para uma conta que o plano da empresa não tem, a linha sai zero
// — foi o que aconteceu com a Spot (e a Express) até 07/10/2026.

import test from "node:test";
import assert from "node:assert/strict";

import { RESULTADO_EXERCICIO_CODE_POR_EMPRESA, resultadoExercicioCodeFor } from "./resultado-exercicio";

const SGX = "8ddc1c4a-42d6-473a-b17d-1eeae821d18d";
const SPOT = "682e2a01-9f45-4cdf-839e-2ae17dac028d";
const EXPRESS = "36e5e164-f5ca-4498-9771-ab0999b977d6";
const OUTRA = "00000000-0000-0000-0000-000000000001";

test("Spot e Express usam o code 15 — o plano delas não tem code 11", () => {
  assert.equal(resultadoExercicioCodeFor([SPOT]), "15");
  assert.equal(resultadoExercicioCodeFor([EXPRESS]), "15");
});

test("SGX continua no 15 (Resultado 4), como antes", () => {
  assert.equal(resultadoExercicioCodeFor([SGX]), "15");
});

test("empresa sem exceção usa o padrão 11", () => {
  assert.equal(resultadoExercicioCodeFor([OUTRA]), "11");
  assert.equal(resultadoExercicioCodeFor([]), "11");
});

test("consolidado Spot + Express fica no 15 (planos idênticos)", () => {
  assert.equal(resultadoExercicioCodeFor([SPOT, EXPRESS]), "15");
});

test("consolidado que mistura códigos diferentes cai no padrão", () => {
  assert.equal(resultadoExercicioCodeFor([SPOT, OUTRA]), "11");
  assert.equal(resultadoExercicioCodeFor([SGX, OUTRA]), "11");
});

test("cada empresa aparece uma vez só na lista", () => {
  const ids = RESULTADO_EXERCICIO_CODE_POR_EMPRESA.map((r) => r.companyId);
  assert.equal(new Set(ids).size, ids.length);
});
