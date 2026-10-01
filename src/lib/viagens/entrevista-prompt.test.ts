// O prompt da entrevista de viagem.
//
// Um prompt não tem como ser "testado" no sentido de conferir o que o modelo
// responde. O que se trava aqui é o CONTRATO: que as regras que não podem cair
// estão escritas, e que o contexto que o prompt carrega é o certo. Cada uma
// destas asserções corresponde a um defeito concreto — e a regra de "a IA não
// calcula" é a que sustenta o motor determinístico existir.

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPromptViagem,
  listaEnderecos,
  listaParametros,
  listaVizinhas,
  type BuildPromptViagemInput,
} from "./entrevista-prompt";
import { PARAMETROS_PADRAO } from "./custo/mapear";

const BASE: BuildPromptViagemInput = {
  contexto: {
    companyName: "Viva Eventos",
    setorNome: "Consultoria",
    categoryName: "Viagens e Estadias",
    year: 2027,
    titulo: "Implantação em Curitiba",
    roteiroAtual: [],
    origem: "Juiz de Fora",
    dataIda: null,
    pessoas: 2,
    pessoasPorQuarto: 2,
  },
  parametros: PARAMETROS_PADRAO,
  parametrosPadrao: false,
  vizinhas: [],
  enderecos: [],
};

function prompt(over: Partial<BuildPromptViagemInput> = {}): string {
  return buildPromptViagem({ ...BASE, ...over });
}

test("o prompt proíbe a IA de CALCULAR ou inventar valor", () => {
  // É a regra que sustenta o motor determinístico: valor vindo do modelo sai
  // plausível e ninguém o confere.
  const p = prompt();
  assert.match(p, /NÃO calcula/);
  assert.match(p, /Nunca escreva um valor que/i);
  assert.match(p, /deixe o campo VAZIO e informe a DISTÂNCIA/i);
});

test("o prompt proíbe total/custo dentro do cartão", () => {
  // Se o modelo mandar um total, o parser o ignora — mas pedir que não mande
  // evita a mensagem em que ele ANUNCIA um total que a tela não vai usar.
  assert.match(prompt(), /NUNCA inclua total, custo, soma ou subtotal/);
});

test("`null` é o vazio do cartão, nunca zero", () => {
  // Zero é um valor: entra na conta como se o trecho fosse de graça.
  assert.match(prompt(), /NÃO preencha com zero/);
});

test("as três coisas que mais mudam o custo estão no prompt", () => {
  const p = prompt();
  assert.match(p, /pessoas por quarto dobra ou divide a hospedagem/i);
  assert.match(p, /carro e van custam por VEÍCULO/i);
  assert.match(p, /conta os DIAS \(noites \+ 1\)/);
});

test("a finalidade é a única pergunta de reflexão, e é obrigatória", () => {
  // A entrevista é dirigida (levanta fatos), mas o diretor precisa do "para
  // que serve" para aprovar — e é o que deixa ver duas viagens com o mesmo fim.
  const p = prompt();
  assert.match(p, /PARA QUE SERVE a viagem/);
  assert.match(p, /ÚNICA pergunta de reflexão/);
  assert.match(p, /obrigatória/);
});

test("a IA PERGUNTA, não dá veredito nem corta por conta própria", () => {
  // Mesmo guarda-corpo do Planejamento, que protege a reversão de 09/09/2026.
  const p = prompt();
  assert.match(p, /não dá veredito sobre a viagem/);
  assert.match(p, /não propõe cortar pessoas, noites ou destinos/);
  assert.match(p, /Quem aprova é a/);
});

test("endereço: pode PROPOR, nunca inventar número ou CEP", () => {
  const p = prompt();
  assert.match(p, /NUNCA invente número/);
  assert.match(p, /peça o endereço/);
});

// ─── Juntar viagens ──────────────────────────────────────────────────────────

test("sem outra viagem no recorte, o bloco de juntar NEM APARECE", () => {
  // Pedir para comparar com uma lista vazia convidaria o modelo a inventar
  // uma viagem vizinha para ter o que sugerir.
  const p = prompt({ vizinhas: [] });
  assert.equal(/JUNTAR VIAGENS/.test(p), false);
  assert.equal(/OUTRAS VIAGENS JÁ ORÇADAS/.test(p), false);
});

test("com outra viagem, a IA é instruída a PERGUNTAR se dá para juntar", () => {
  const p = prompt({
    vizinhas: [
      { titulo: "Treinamento Curitiba", cidades: ["Curitiba"], dataIda: "2027-05-20", pessoas: 1 },
    ],
  });
  assert.match(p, /JUNTAR VIAGENS/);
  assert.match(p, /Treinamento Curitiba/);
  assert.match(p, /20 de maio de 2027/);
  assert.match(p, /É uma\nPERGUNTA|É uma PERGUNTA/);
  assert.match(p, /não mexe na outra viagem/);
});

// ─── O contexto que o prompt carrega ────────────────────────────────────────

test("roteiro já preenchido manda NÃO repetir a pergunta", () => {
  const p = prompt({
    contexto: { ...BASE.contexto, roteiroAtual: ["Curitiba: 2 noites, chega de avião"] },
  });
  assert.match(p, /não pergunte de novo o que já está aqui/);
  assert.match(p, /Curitiba: 2 noites/);
});

test("roteiro vazio diz para COMEÇAR por ele", () => {
  assert.match(prompt(), /ROTEIRO: ainda vazio/);
});

test("data ainda não definida aparece como tal, não como uma data chutada", () => {
  assert.match(prompt(), /data de ida: ainda não definida/);
  assert.match(
    prompt({ contexto: { ...BASE.contexto, dataIda: "2027-05-04" } }),
    /data de ida: 4 de maio de 2027/,
  );
});

test("empresa sem setor não ganha linha de setor em branco", () => {
  const p = prompt({ contexto: { ...BASE.contexto, setorNome: "" } });
  assert.match(p, /a empresa não orça por setor/);
  assert.equal(/- setor: *\n/.test(p), false);
});

test("parâmetro padrão é AVISADO como padrão", () => {
  // Sem isto a IA explicaria o valor como se a empresa o tivesse definido.
  assert.match(prompt({ parametrosPadrao: true }), /ainda não cadastrou parâmetros/);
  assert.equal(/ainda não cadastrou parâmetros/.test(prompt()), false);
});

test("os parâmetros vigentes vão no prompt, em reais", () => {
  const l = listaParametros({ ...PARAMETROS_PADRAO, rsPorKm: 1.8, hotelDiariaPadrao: 250 });
  assert.match(l, /R\$ 1,80 por km, POR VEÍCULO/);
  assert.match(l, /R\$ 250,00 por quarto por noite/);
});

test("as listas auxiliares devolvem vazio quando não há nada", () => {
  assert.equal(listaVizinhas([]), "");
  assert.equal(listaEnderecos([]), "");
});

test("endereço sem rua é mostrado como em branco, não omitido", () => {
  // Omitir faria a IA buscar de novo um lugar que alguém já cadastrou.
  const l = listaEnderecos([
    { cidade: "Curitiba", nome: "Viva Eventos Curitiba", endereco: null, tipo: "unidade" },
  ]);
  assert.match(l, /Viva Eventos Curitiba \(endereço em branco\)/);
});
