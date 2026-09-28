// O casamento por NOME é o que sustenta a atribuição de setor do Orçamento.
// Ele vale em três pontos (gravar, resolver o escopo, diagnosticar a tela
// vazia) e divergir em qualquer um deles dá escopo silenciosamente errado —
// que é o defeito mais caro deste módulo, porque não levanta erro nenhum.

import test from "node:test";
import assert from "node:assert/strict";

import {
  chaveSetorNome,
  nomesUnicos,
  setoresDoAnoAtribuidos,
} from "./setor-atribuicao";

test("a chave ignora caixa e espaços das pontas", () => {
  // É a MESMA normalização de cloneSetores, que casa nomes entre anos — se as
  // duas divergirem, o setor clonado deixa de ser o setor atribuído.
  assert.equal(chaveSetorNome("  Marketing "), "marketing");
  assert.equal(chaveSetorNome("MARKETING"), chaveSetorNome("marketing"));
});

test("a chave NÃO ignora acento", () => {
  // "Gestão" e "Gestao" são cadastros diferentes que merecem correção no
  // cadastro, não fusão silenciosa aqui.
  assert.notEqual(chaveSetorNome("Gestão"), chaveSetorNome("Gestao"));
});

test("casa os setores do ano pelos nomes atribuídos", () => {
  const ids = setoresDoAnoAtribuidos(
    ["Marketing", "financeiro cash out"],
    [
      { id: "a", name: "Marketing" },
      { id: "b", name: "Financeiro Cash Out" },
      { id: "c", name: "Atendimento" },
    ],
  );
  assert.deepEqual(ids.sort(), ["a", "b"]);
});

test("setor sem ponte com o Compras é atribuível — é o ponto da mudança", () => {
  // O modelo anterior casava por `ctrl_sector_id`, e metade dos setores desta
  // base não tem ponte: eles eram inatingíveis.
  const ids = setoresDoAnoAtribuidos(
    ["Não atribuído"],
    [{ id: "z", name: "Não atribuído" }],
  );
  assert.deepEqual(ids, ["z"]);
});

test("nome atribuído que não existe no ano some, sem erro", () => {
  // Caso normal de setor ainda não clonado para o ano novo. Falhar para o lado
  // de esconder é deliberado; quem explica é o aviso de escopo vazio.
  assert.deepEqual(setoresDoAnoAtribuidos(["Vendas"], [{ id: "a", name: "Marketing" }]), []);
});

test("sem atribuição nenhuma, nenhum setor", () => {
  assert.deepEqual(setoresDoAnoAtribuidos([], [{ id: "a", name: "Marketing" }]), []);
});

test("nomesUnicos junta o mesmo setor repetido por ano", () => {
  // A tela soma os nomes de todos os anos da empresa; sem isto o seletor
  // mostraria "Marketing" uma vez por ano clonado.
  assert.deepEqual(nomesUnicos(["Marketing", "marketing ", "Vendas", "MARKETING"]), [
    "Marketing",
    "Vendas",
  ]);
});

test("nomesUnicos descarta vazio", () => {
  assert.deepEqual(nomesUnicos(["", "   ", "Marketing"]), ["Marketing"]);
});
