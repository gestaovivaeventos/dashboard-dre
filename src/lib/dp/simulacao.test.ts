import assert from "node:assert/strict";
import { test } from "node:test";

import { custoMensal, simularCenario, vinculoDeCusto, type DpPessoaSim } from "@/lib/dp/simulacao";
import { encargosPadrao } from "@/lib/orcamento/encargos";

const normal = encargosPadrao("lucro_real"); // 35,8%
const simples = encargosPadrao("simples_nacional"); // 8%

test("custoMensal CLT: salário × (1+enc) × (1 + 1/12 + 1/36)", () => {
  const c = custoMensal(3600, "clt", normal);
  assert.equal(c.encargos, 1288.8);
  assert.equal(c.decimo, 407.4); // 3600/12 × 1,358
  assert.equal(c.ferias, 135.8); // 3600/36 × 1,358
  assert.equal(c.total, 5432);
  assert.equal(custoMensal(3600, "clt", simples).total, 4320); // 3600 × 1,08 × 1,1111
});

test("custoMensal sem encargos: só o salário", () => {
  assert.deepEqual(custoMensal(10000, "sem_encargos", normal), { salario: 10000, encargos: 0, decimo: 0, ferias: 0, total: 10000 });
});

test("vinculoDeCusto: sem tipo conta como CLT e é marcado como presumido", () => {
  assert.deepEqual(vinculoDeCusto("CLT"), { vinculo: "clt", presumido: false });
  assert.deepEqual(vinculoDeCusto(null), { vinculo: "clt", presumido: true });
  assert.deepEqual(vinculoDeCusto("Sócio"), { vinculo: "sem_encargos", presumido: false });
  assert.deepEqual(vinculoDeCusto("Estagiário"), { vinculo: "sem_encargos", presumido: false });
});

const pessoas: DpPessoaSim[] = [
  { id: "a", nome: "Ana", departamento: "TI", tipoContrato: "CLT", salario: 3600, salarioTabela: 4000 },
  { id: "b", nome: "Bia", departamento: "TI", tipoContrato: "CLT", salario: 5000, salarioTabela: 4500 },
  { id: "c", nome: "Caio", departamento: "RH", tipoContrato: "Sócio", salario: 10000, salarioTabela: null },
  { id: "d", nome: "Duda", departamento: "RH", tipoContrato: "CLT", salario: null, salarioTabela: 3000 },
];

test("cenário vazio: custo atual = simulado, sem salário fica de fora e é contado", () => {
  const r = simularCenario({ pessoas, itens: [], encargos: normal, mesVigencia: 1 });
  assert.equal(r.custoAtual, r.custoSimulado);
  assert.equal(r.deltaMensal, 0);
  assert.equal(r.semSalario, 1);
});

test("enquadrar: sobe só quem está ABAIXO da tabela; ninguém desce", () => {
  const r = simularCenario({ pessoas, itens: [{ id: "e", tipo: "enquadrar" }], encargos: normal, mesVigencia: 1 });
  assert.equal(r.porItem[0].pessoas, 1);
  assert.deepEqual(r.afetados.map((p) => [p.id, p.salarioSimulado]), [["a", 4000]]);
  assert.equal(r.deltaMensal, r2(custoMensal(4000, "clt", normal).total - custoMensal(3600, "clt", normal).total));
});

test("itens em ordem: promoção e depois aumento de 10% no departamento incide sobre o promovido", () => {
  const r = simularCenario({
    pessoas,
    itens: [
      { id: "p", tipo: "promocao", pessoaId: "a", novoSalario: 4000 },
      { id: "x", tipo: "aumento", percentual: 10, alvo: "departamento", departamento: "TI" },
    ],
    encargos: normal,
    mesVigencia: 10,
  });
  assert.deepEqual(r.afetados.map((p) => [p.id, p.salarioSimulado]), [["a", 4400], ["b", 5500]]);
  assert.equal(r.porItem[1].pessoas, 2);
  assert.equal(r.mesesAteDezembro, 3);
  assert.equal(r.deltaAteDezembro, r2(r.deltaMensal * 3));
  assert.equal(r.deltaDozeMeses, r2(r.deltaMensal * 12));
});

test("contratação: entra com custo atual zero; sócio não leva encargo", () => {
  const r = simularCenario({
    pessoas,
    itens: [{ id: "h", tipo: "contratacao", quantidade: 2, salario: 3000, vinculo: "clt", rotulo: "Analista" }],
    encargos: simples,
    mesVigencia: 1,
  });
  assert.equal(r.afetados.length, 2);
  assert.equal(r.afetados[0].custoAtual, 0);
  assert.equal(r.deltaMensal, r2(2 * custoMensal(3000, "clt", simples).total));
});

function r2(v: number) {
  return Math.round(v * 100) / 100;
}
