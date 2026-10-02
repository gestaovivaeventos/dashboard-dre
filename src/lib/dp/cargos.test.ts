import assert from "node:assert/strict";
import { test } from "node:test";

import { chaveNome, enquadrar, sugerirNivel, type DpEstruturaCargo } from "@/lib/dp/cargos";

test("chaveNome: caixa, acento, (a) e espaços não importam", () => {
  assert.equal(chaveNome("Consultor(a) de  Relacionamento Sênior II"), "consultor de relacionamento senior ii");
  assert.equal(chaveNome(" Analista  Comercial "), chaveNome("analista comercial"));
});

const estrutura: DpEstruturaCargo[] = [
  { cargoId: "c1", cargoNome: "Analista Comercial", niveis: [{ id: "n1", nome: "Pleno I", salario: 4000 }, { id: "n2", nome: "Pleno III", salario: 5000 }] },
  { cargoId: "c2", cargoNome: "Motorista", niveis: [{ id: "n3", nome: "Único", salario: 2500 }] },
  { cargoId: "c3", cargoNome: "Designer", niveis: [{ id: "n4", nome: "I", salario: 3000 }, { id: "n5", nome: "II", salario: 3500 }] },
];

test("sugerirNivel: cargo + nível no nome da Sólides", () => {
  assert.equal(sugerirNivel("Analista Comercial Pleno III", estrutura), "n2");
  assert.equal(sugerirNivel("analista comercial pleno i", estrutura), "n1");
});

test("sugerirNivel: nome do cargo só vale quando há um nível", () => {
  assert.equal(sugerirNivel("Motorista", estrutura), "n3");
  assert.equal(sugerirNivel("Designer", estrutura), null);
  assert.equal(sugerirNivel("Gerente Geral", estrutura), null);
});

test("enquadrar: tolerância de arredondamento, abaixo/acima e os casos sem dado", () => {
  assert.equal(enquadrar({ temEmpresa: true, salario: 5000.4, salarioNivel: 5000 }).status, "no_nivel");
  const abaixo = enquadrar({ temEmpresa: true, salario: 4500, salarioNivel: 5000 });
  assert.deepEqual(abaixo, { status: "abaixo", diferenca: -500, percentual: -10 });
  assert.equal(enquadrar({ temEmpresa: true, salario: 6000, salarioNivel: 5000 }).percentual, 20);
  assert.equal(enquadrar({ temEmpresa: true, salario: null, salarioNivel: 5000 }).status, "sem_salario");
  assert.equal(enquadrar({ temEmpresa: true, salario: 5000, salarioNivel: null }).status, "sem_vinculo");
  assert.equal(enquadrar({ temEmpresa: false, salario: 5000, salarioNivel: 5000 }).status, "sem_empresa");
});
