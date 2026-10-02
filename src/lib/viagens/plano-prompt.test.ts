// O prompt do intake do plano do ano.
//
// O que se trava aqui são as duas regras que, se caírem, produzem número errado
// em silêncio: mês chutado (o custo cai no mês da partida) e preço vindo do
// modelo (ninguém confere um valor plausível).

import test from "node:test";
import assert from "node:assert/strict";

import { SCHEMA_HINT_PLANO, SYSTEM_PLANO, montarPromptPlano } from "./plano-prompt";

const BASE = {
  year: 2027,
  origem: "Juiz de Fora",
  tipos: [{ nome: "Consultoria" }, { nome: "Treinamento" }],
  faixasPassagem: [
    { nome: "Capital Sudeste", valor: 900, modal: "aviao" },
    { nome: "Capital Nordeste", valor: 1600, modal: "aviao" },
  ],
  faixasHospedagem: [{ nome: "Capital", valor: 320 }, { nome: "Interior", valor: 180 }],
  texto: "Curitiba em março, 2 noites, 3 pessoas.",
};

test("os cadastros vão com NOME e VALOR — é o valor que torna a escolha possível", () => {
  // Só pelo nome, um destino do Nordeste cairia na faixa do Sudeste sem nada
  // denunciar: a IA não sabe o que a etiqueta representa.
  const p = montarPromptPlano(BASE);
  assert.match(p, /Capital Nordeste \(R\$ 1600, aviao\)/);
  assert.match(p, /Capital \(R\$ 320\)/);
  assert.match(p, /- Consultoria/);
});

test("o texto do gestor vai VERBATIM, no fim", () => {
  const p = montarPromptPlano({ ...BASE, texto: "  Recife em maio  " });
  assert.match(p, /PLANO, como o gestor o escreveu:\nRecife em maio$/);
});

test("proíbe CHUTAR o mês, com todas as letras", () => {
  // Mês errado joga a viagem inteira para outro mês do orçamento, calado.
  const p = montarPromptPlano(BASE);
  assert.match(p, /devolva null/);
  assert.match(p, /nunca escolha um mês por ela/);
});

test("proíbe preço, custo e distância", () => {
  const p = montarPromptPlano(BASE);
  assert.match(p, /Não devolva preço, custo, total nem distância/);
});

test("o SCHEMA não tem campo de dinheiro — nem se o modelo quisesse", () => {
  assert.doesNotMatch(SCHEMA_HINT_PLANO, /preco|price|valor|custo|total|diaria/i);
  assert.match(SCHEMA_HINT_PLANO, /"destino"/);
  assert.match(SCHEMA_HINT_PLANO, /"junto"/);
});

test("cadastro vazio diz que está vazio, em vez de uma lista em branco", () => {
  const p = montarPromptPlano({ ...BASE, tipos: [], faixasPassagem: [] });
  assert.match(p, /TIPOS DE VIAGEM cadastrados[^\n]*:\n {2}\(nenhum cadastrado\)/);
});

test("faixa com valor zero sai sem o valor — zero não ajuda a escolher", () => {
  const p = montarPromptPlano({ ...BASE, faixasHospedagem: [{ nome: "Capital", valor: 0 }] });
  assert.match(p, /- Capital\n/);
  assert.doesNotMatch(p, /R\$ 0/);
});

test("origem vazia é dita, não some da frase", () => {
  const p = montarPromptPlano({ ...BASE, origem: "" });
  assert.match(p, /parte de \(origem não informada\)/);
});

test("manda emitir uma linha por cidade na ida multi-destino", () => {
  assert.match(montarPromptPlano(BASE), /UMA LINHA POR CIDADE com a mesma/);
});

test("o system proíbe texto fora do JSON", () => {
  assert.match(SYSTEM_PLANO, /SOMENTE com JSON/);
});

test("a faixa de passagem é dita SÓ IDA — é o que o motor cobra", () => {
  // O motor lança o trecho de volta à parte. Dizer "ida e volta" faria a IA
  // escolher a faixa pela ordem de grandeza errada.
  const p = montarPromptPlano(BASE);
  assert.match(p, /FAIXAS DE PASSAGEM cadastradas \(o valor é por pessoa, SÓ IDA/);
});
