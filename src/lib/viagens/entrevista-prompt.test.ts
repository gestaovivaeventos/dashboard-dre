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
    tipoNome: "Consultoria",
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
  assert.match(p, /NUNCA escreva um valor de passagem ou de hotel que você supôs/);
  assert.match(p, /Zero DITO é melhor do que um número inventado/);
  assert.match(p, /deixe o campo VAZIO/i);
  assert.match(p, /não há estimativa possível/i);
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

test("o gestor responde por CINCO coisas, mais data e finalidade", () => {
  // Pedido de 01/10/2026: "o usuário basicamente só fala pra onde vai, quantos
  // dias, quantas pessoas, se dividem quarto, se voltam direto". Todo o resto é
  // trabalho do agente.
  const p = prompt();
  assert.match(p, /CINCO COISAS, e só por elas/);
  assert.match(p, /para ONDE vai/);
  assert.match(p, /QUANTOS DIAS em cada destino/);
  assert.match(p, /QUANTAS PESSOAS/);
  assert.match(p, /DIVIDEM QUARTO/);
  assert.match(p, /VOLTAM DIRETO para a origem/);
  // A data não está na lista do pedido, mas é inescapável: sem ela a viagem não
  // cai em mês nenhum do orçamento. Vai no mesmo bloco, justificada.
  assert.match(p, /DATA DA IDA, que não é opcional/);
  assert.match(p, /é a única pergunta de conteúdo/);
});

test("é PROIBIDO devolver ao gestor o trabalho do agente", () => {
  // Cada item desta lista é uma pergunta que a primeira versão fazia e que
  // transformava a IA em formulário — o oposto do pedido.
  const p = prompt();
  assert.match(p, /É PROIBIDO perguntar ao gestor/);
  for (const proibido of [
    /preço de passagem, diária de hotel/,
    /distância entre cidades, aeroporto/,
    /como ir em cada trecho/,
    /quantos veículos, quantos trajetos/,
    /qualquer campo do formulário/,
  ]) {
    assert.match(p, proibido);
  }
  assert.match(p, /devolve ao gestor o trabalho que você existe para fazer/);
});

test("o agente CALCULA para comparar, mas o total oficial é do sistema", () => {
  // Sem esta distinção ele ou se recusa a comparar (e não otimiza nada) ou
  // anuncia um total que o motor vai contradizer ao salvar.
  const p = prompt();
  assert.match(p, /VOCÊ CALCULA PARA COMPARAR/);
  assert.match(p, /o custo OFICIAL é do sistema/);
  assert.match(p, /nunca ponha total nenhum dentro do cartão/);
});

test("é AGENTE, não entrevistador: pergunta de uma vez e preenche sozinho", () => {
  // Pedido de 01/10/2026. A regra do Planejamento ("uma pergunta por mensagem")
  // está explicitamente proibida aqui — ela transforma a IA em formulário, que é
  // justamente o que o usuário quer evitar.
  const p = prompt();
  assert.match(p, /ENTENDER → PESQUISAR → PROPOR/);
  assert.match(p, /nunca uma por mensagem/);
  assert.match(p, /são o RESULTADO da conversa: o gestor não os preenche/);
});

test("o agente tem de PESQUISAR antes de propor, e preencher o resto", () => {
  const p = prompt();
  assert.match(p, /ferramenta `buscar_precos`/);
  assert.match(p, /Use-a ANTES de propor/);
  // Completa sozinho o que o gestor não disse — dizendo que completou.
  assert.match(p, /dividem quarto por padrão/);
  assert.match(p, /um carro até 4 pessoas/);
  assert.match(p, /2 trajetos por dia/);
});

test("OTIMIZAR é parte do trabalho — comparar modal, aeroporto e ordem", () => {
  const p = prompt();
  assert.match(p, /OTIMIZAR é parte do trabalho/);
  assert.match(p, /carro × avião/);
  assert.match(p, /aeroporto vizinho/);
  assert.match(p, /ordem muda o custo/);
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

test("com outra viagem, o agente PROPÕE juntar, com a economia concreta", () => {
  const p = prompt({
    vizinhas: [
      { titulo: "Treinamento Curitiba", cidades: ["Curitiba"], dataIda: "2027-05-20", pessoas: 1 },
    ],
  });
  assert.match(p, /JUNTAR VIAGENS/);
  assert.match(p, /Treinamento Curitiba/);
  assert.match(p, /20 de maio de 2027/);
  // Virou PROPOSTA (01/10/2026): é a otimização que economiza mais.
  assert.match(p, /PROPONHA a viagem única/);
  assert.match(p, /é PROPOSTA, não decisão/);
  assert.match(p, /NÃO mexe na outra viagem/);
  assert.match(p, /precisa ser descartada por ele/);
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

test("só os DOIS parâmetros vão no prompt, e ele nega os outros", () => {
  const l = listaParametros({ rsPorKm: 1.8, diariaAlimentacao: 80 });
  assert.match(l, /R\$ 1,80 por km, POR VEÍCULO/);
  assert.match(l, /R\$ 80,00 por pessoa por DIA/);
  assert.match(l, /não têm parâmetro/);
  assert.match(l, /NUNCA invente um valor/);
  assert.equal(/por quarto por noite/.test(l), false, "não existe diária padrão de hotel");
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
