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
  texto: "Curitiba em março, 2 noites, 3 pessoas.",
};

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

test("cadastro vazio diz que está vazio, em vez de uma lista em branco", () => {
  const p = montarPromptPlano({ ...BASE, tipos: [] });
  assert.match(p, /TIPOS DE VIAGEM cadastrados[^\n]*:\n {2}\(nenhum cadastrado\)/);
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

test("o SCHEMA não tem campo de dinheiro — nem se o modelo quisesse", () => {
  // O preço é cotado fora, pela Controladoria. Nada que a IA devolva aqui pode
  // virar valor.
  assert.doesNotMatch(SCHEMA_HINT_PLANO, /preco|price|valor|custo|total|diaria|faixa/i);
  assert.match(SCHEMA_HINT_PLANO, /"destino"/);
  assert.match(SCHEMA_HINT_PLANO, /"junto"/);
});

test("o prompt diz que o preço vem DEPOIS, cotado fora", () => {
  const p = montarPromptPlano(BASE);
  assert.match(p, /Não devolva preço, custo, total nem distância/);
  assert.match(p, /cotado depois, fora do sistema/);
});
