import assert from "node:assert/strict";
import { test } from "node:test";

import { chaveNome, enquadrar, sugerirLinha, type DpLinhaSalarial } from "@/lib/dp/cargos";

test("chaveNome: caixa, acento, (a) e espaços não importam", () => {
  assert.equal(chaveNome("Consultor(a) de  Relacionamento Sênior II"), "consultor de relacionamento senior ii");
  assert.equal(chaveNome(" Analista  Comercial "), chaveNome("analista comercial"));
});

const linhas: DpLinhaSalarial[] = [
  { id: "n1", setor: "Comercial", cargo: "Analista Comercial", step: "Pleno I", salario: 4000 },
  { id: "n2", setor: "Comercial", cargo: "Analista Comercial", step: "Pleno III", salario: 5000 },
  { id: "n3", setor: "Operacional", cargo: "Motorista", step: "", salario: 2500 },
  { id: "n4", setor: "Marketing", cargo: "Designer", step: "I", salario: 3000 },
  { id: "n5", setor: "Eventos", cargo: "Designer", step: "I", salario: 3200 },
];

test("sugerirLinha: cargo + step no nome da Sólides", () => {
  assert.equal(sugerirLinha("Analista Comercial Pleno III", linhas), "n2");
  assert.equal(sugerirLinha("analista comercial pleno i", linhas), "n1");
});

test("sugerirLinha: só o cargo vale quando ele tem uma linha; ambíguo não sugere", () => {
  assert.equal(sugerirLinha("Motorista", linhas), "n3");
  assert.equal(sugerirLinha("Designer I", linhas), null); // o mesmo cargo+step em dois setores
  assert.equal(sugerirLinha("Gerente Geral", linhas), null);
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
