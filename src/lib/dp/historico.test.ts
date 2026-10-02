import assert from "node:assert/strict";
import { test } from "node:test";

import { descreverEvento, diffColaborador, eventosDaSincronizacao, type DpSnapshot } from "@/lib/dp/historico";
import type { DpColaboradorBase, DpColaboradorFicha } from "@/lib/dp/solides/parse";

const base: DpColaboradorBase = {
  solides_id: 1, nome: "Fulana", cpf: "12345678901", email: "f@x.com",
  unidade_id: 10, unidade_nome: "SPOT", departamento_id: 20, departamento_nome: "TI",
  cargo_id: 30, cargo_nome: "Analista", tipo_contrato: "CLT", data_admissao: "2024-01-02",
  gestor_solides_id: 40, gestor_nome: "Gestora", solides_atualizado_em: "2026-09-29", data_nascimento: "1990-03-12",
};
const ficha: DpColaboradorFicha = {
  salario: 3000, data_desligamento: null,
  endereco: { cep: "36010000", logradouro: "Rua A", numero: "1", complemento: null, bairro: null, cidade: "JF", uf: "MG" },
  experiencia_fim: null, experiencia_duracao: null,
  dependentes: [{ nome: "Filho", cpf: null, nascimento: "2015-01-01", parentesco: "Filho" }],
  beneficios_solides: [],
};
const snap: DpSnapshot = { ...base, ...ficha, ativo: true, ficha_versao: 2 };

test("campo novo não é comparado na 1ª leitura dele (ficha_versao antiga)", () => {
  const antigo: DpSnapshot = { ...snap, ficha_versao: 1, data_nascimento: null, dependentes: [], experiencia_fim: null };
  assert.deepEqual(diffColaborador(antigo, base, ficha), []);
});

test("a partir da 2ª leitura, mudança de dependente vira movimentação; reordenar não", () => {
  const dois = [
    { nome: "Ana", cpf: null, nascimento: null, parentesco: "Filha" },
    { nome: "Filho", cpf: null, nascimento: "2015-01-01", parentesco: "Filho" },
  ];
  const ev = diffColaborador(snap, base, { ...ficha, dependentes: dois });
  assert.equal(ev.length, 1);
  assert.equal(descreverEvento(ev[0]), "Dependentes: Filho → Ana, Filho");
  assert.deepEqual(diffColaborador({ ...snap, dependentes: dois }, base, { ...ficha, dependentes: [...dois] }), []);
});

test("nada mudou → nenhum evento (salário 3000 e 3000.00 são iguais)", () => {
  assert.deepEqual(diffColaborador(snap, { ...base }, { ...ficha, salario: 3000.0 }), []);
});

test("renomear a unidade na Sólides não é movimentação; trocar de unidade é", () => {
  assert.deepEqual(diffColaborador(snap, { ...base, unidade_nome: "SPOT LTDA" }, ficha), []);
  const ev = diffColaborador(snap, { ...base, unidade_id: 11, unidade_nome: "EXPRESS" }, ficha);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].campo, "unidade");
  assert.equal(descreverEvento(ev[0]), "Unidade: SPOT → EXPRESS");
});

test("ficha não lida: salário/endereço NÃO são comparados", () => {
  assert.deepEqual(diffColaborador(snap, base, null), []);
  const ev = diffColaborador(snap, base, { ...ficha, salario: 3500 });
  assert.equal(descreverEvento(ev[0]), "Salário: R$\u00a03.000,00 → R$\u00a03.500,00");
});

test("primeira carga não gera evento; depois dela, entrada / reativação / desligamento", () => {
  assert.deepEqual(eventosDaSincronizacao({ antes: new Map(), lista: [base], fichas: [ficha], sumiram: [] }), []);

  const antes = new Map<number, DpSnapshot>([[1, { ...snap, ativo: false }], [2, { ...snap, solides_id: 2, ativo: true }]]);
  const novo = { ...base, solides_id: 3, data_admissao: "2026-10-01" };
  const ev = eventosDaSincronizacao({
    antes,
    lista: [base, novo],
    fichas: [ficha, null],
    sumiram: [{ solidesId: 2, ficha: { ...ficha, data_desligamento: "2026-09-30" } }],
  });
  assert.deepEqual(ev.map((e) => [e.solides_id, e.tipo]), [[1, "reativacao"], [3, "entrada"], [2, "desligamento"]]);
  assert.equal(descreverEvento(ev[2]), "Saiu da lista de ativos da Sólides (desligamento em 30/09/2026)");
});
