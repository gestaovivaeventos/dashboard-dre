// Quais telas do orçamento aparecem em cada empresa.
//
// O que estes testes travam é a SEMÂNTICA ADITIVA, que é a razão de a tabela
// guardar o oculto e não o visível. Invertê-la quebraria de duas formas que não
// dão erro em lugar nenhum: nenhuma empresa teria tela até alguém cadastrar
// todas, e método novo nasceria escondido em todas elas.

import test from "node:test";
import assert from "node:assert/strict";

import {
  ROTULO_DO_METODO,
  metodoVisivelNaEmpresa,
  metodosConfiguraveis,
  metodosDaEmpresa,
  ocultosDeLinhas,
  recusaPorDado,
} from "./metodos-visiveis";
import { METODOS } from "./metodos";
import { isWorkspaceTabBuilt } from "./workspace-tabs";

test("conjunto VAZIO = tudo aparece (ligar o recurso não muda nada)", () => {
  const vistos = metodosDaEmpresa(new Set());
  const comTela = METODOS.filter((m) => isWorkspaceTabBuilt(m.key)).map((m) => m.key);
  assert.deepEqual(vistos, comTela);
  assert.ok(vistos.includes("viagens"));
  assert.ok(vistos.includes("pessoal"));
});

test("o oculto sai, e só ele", () => {
  const vistos = metodosDaEmpresa(new Set(["viagens"]));
  assert.equal(vistos.includes("viagens"), false);
  assert.ok(vistos.includes("pessoal"));
  assert.ok(vistos.includes("planejamento_socios"));
});

test("método SEM TELA nunca aparece, nem sem estar oculto", () => {
  // Oferecê-lo na configuração seria uma caixa que não muda nada.
  const vistos = metodosDaEmpresa(new Set());
  assert.equal(vistos.includes("marketing_ve" as never), false);
  assert.equal(metodosConfiguraveis().includes("marketing_ve" as never), false);
});

test("esconder TODOS é permitido — a empresa pode não orçar por este módulo", () => {
  const todos = metodosConfiguraveis();
  assert.deepEqual(metodosDaEmpresa(new Set(todos)), []);
});

test("metodoVisivelNaEmpresa responde por chave, inclusive desconhecida", () => {
  const ocultos = new Set(["viagens"]);
  assert.equal(metodoVisivelNaEmpresa("viagens", ocultos), false);
  assert.equal(metodoVisivelNaEmpresa("pessoal", ocultos), true);
  // Chave que o código não conhece mais: não esconde nada (lista de exclusões).
  assert.equal(metodoVisivelNaEmpresa("metodo_que_sumiu", ocultos), true);
});

test("chave desconhecida na tabela não derruba nem esconde método existente", () => {
  // Resíduo de um método renomeado (viagens_ve → viagens) fica inofensivo.
  const vistos = metodosDaEmpresa(new Set(["viagens_ve", "lixo"]));
  assert.ok(vistos.includes("viagens"), "o resíduo não pode esconder o método atual");
});

test("ocultosDeLinhas é tolerante com o que vem do banco", () => {
  assert.deepEqual(
    Array.from(ocultosDeLinhas([{ metodo: "viagens" }, { metodo: "  pessoal  " }])).sort(),
    ["pessoal", "viagens"],
  );
  // Linha ruim é descartada, não vira chave vazia que esconderia "" (nada).
  assert.deepEqual(Array.from(ocultosDeLinhas([{ metodo: "" }, { metodo: 7 }, {}])), []);
  assert.deepEqual(Array.from(ocultosDeLinhas(null)), []);
  assert.deepEqual(Array.from(ocultosDeLinhas(undefined)), []);
});

test("a recusa NOMEIA o que existe, em vez de só negar", () => {
  // "não dá" manda o admin procurar o problema; o número diz o que fazer.
  const msg = recusaPorDado("Viagens", 3, ROTULO_DO_METODO.viagens);
  assert.match(msg, /3 viagens orçadas/);
  assert.match(msg, /não tira esse valor da Prévia nem do Budget/);
  assert.match(msg, /Remova o que foi orçado antes/);
});

test("a recusa CONCORDA em número e gênero", () => {
  // O plural do português não se deriva e o particípio concorda: a primeira
  // versão desta função escrevia "3 viagem orçados".
  assert.match(recusaPorDado("Viagens", 1, ROTULO_DO_METODO.viagens), /1 viagem orçada /);
  assert.match(recusaPorDado("Viagens", 2, ROTULO_DO_METODO.viagens), /2 viagens orçadas /);
  assert.match(recusaPorDado("Pessoal", 1, ROTULO_DO_METODO.pessoal), /1 colaborador orçado /);
  assert.match(recusaPorDado("Pessoal", 4, ROTULO_DO_METODO.pessoal), /4 colaboradores orçados /);
});

test("todo método com tela tem rótulo para a recusa", () => {
  // Sem o rótulo a mensagem sairia sem nome, e é o nome que diz o que fazer.
  for (const m of metodosConfiguraveis()) {
    assert.ok(ROTULO_DO_METODO[m], `método ${m} sem rótulo em ROTULO_DO_METODO`);
  }
});
