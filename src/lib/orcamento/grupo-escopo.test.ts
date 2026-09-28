// A dedupe do escopo de grupo.
//
// Ela existe porque `upsert({ ignoreDuplicates: true })` NÃO funciona nesta
// tabela (sem primary key, e a chave é um índice por expressão), e a falha era
// silenciosa: replicar/copiar/importar funcionava na primeira vez e quebrava em
// todas as seguintes, levando junto os itens novos do lote.

import test from "node:test";
import assert from "node:assert/strict";

import { chaveEscopo, escoposFaltantes } from "./grupo-escopo";

const base = {
  grupo_id: "g1",
  company_id: "c1",
  year: 2027,
  category_code: "2.02.02",
  setor_id: "s1" as string | null,
};

test("a chave separa por grupo, categoria e setor", () => {
  assert.notEqual(chaveEscopo(base), chaveEscopo({ ...base, grupo_id: "g2" }));
  assert.notEqual(chaveEscopo(base), chaveEscopo({ ...base, category_code: "2.02.03" }));
  assert.notEqual(chaveEscopo(base), chaveEscopo({ ...base, setor_id: "s2" }));
});

test("setor nulo é UM valor, como o COALESCE do índice", () => {
  // Sem isto, dois escopos amplos do mesmo grupo passariam como distintos aqui
  // e colidiriam no banco — que é justamente o erro que estamos evitando.
  const amplo = { ...base, setor_id: null };
  assert.equal(chaveEscopo(amplo), chaveEscopo({ ...amplo }));
  assert.notEqual(chaveEscopo(amplo), chaveEscopo(base));
});

test("tira o que já existe no banco", () => {
  const faltam = escoposFaltantes(
    [base, { ...base, setor_id: "s2" }],
    [base],
  );
  assert.deepEqual(faltam.map((f) => f.setor_id), ["s2"]);
});

test("tira a repetição DENTRO do próprio lote", () => {
  // A replicação monta o produto (destinos × grupos) e a planilha pode trazer
  // a linha repetida: os dois geram duplicata no mesmo INSERT, que falharia
  // igual mesmo com o banco vazio.
  const faltam = escoposFaltantes([base, { ...base }, { ...base }], []);
  assert.equal(faltam.length, 1);
});

test("reexecutar não insere nada — é o que as telas prometem", () => {
  assert.deepEqual(escoposFaltantes([base], [base]), []);
});

test("o caso que quebrou: lote com item velho + item novo", () => {
  // Segunda replicação depois de criar um grupo novo. O antigo já está no
  // destino; o NOVO precisa passar. Antes, o lote inteiro morria com 23505 e o
  // grupo novo não chegava — "o botão não faz nada".
  const velho = base;
  const novo = { ...base, grupo_id: "g2" };
  const faltam = escoposFaltantes([velho, novo], [velho]);
  assert.deepEqual(faltam.map((f) => f.grupo_id), ["g2"]);
});

test("lote vazio é no-op", () => {
  assert.deepEqual(escoposFaltantes([], [base]), []);
});
