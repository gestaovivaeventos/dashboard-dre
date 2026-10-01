// A pergunta da busca de preços.
//
// Não se testa o que o modelo responde. O que se trava é o CONTRATO da pergunta,
// e cada asserção corresponde a um defeito que já custaria caro:
//
//  - pedir IDA E VOLTA quando o roteiro é por trecho de uma via (o valor entraria
//    dobrado, ou rateado pela metade inventando precisão);
//  - deixar o modelo ESTIMAR o que não achou — é justamente o que a remoção do
//    R$/km de passagem veio desfazer, e voltaria pela porta da busca;
//  - perder o identificador do trecho, sem o qual a resposta não casa com a linha
//    do roteiro e o preço vai para o trecho errado.

import test from "node:test";
import assert from "node:assert/strict";

import { mesAno, montarPerguntaPrecos, type TrechoParaCotar } from "./buscar";

const TRECHOS: TrechoParaCotar[] = [
  { id: "p1", de: "Juiz de Fora", para: "Curitiba", modal: "aviao" },
  { id: "p2", de: "Curitiba", para: "Florianópolis", modal: "onibus" },
  { id: "volta", de: "Florianópolis", para: "Juiz de Fora", modal: "aviao" },
];

const CIDADES = [
  { cidade: "Curitiba", noites: 2 },
  { cidade: "Florianópolis", noites: 1 },
];

function pergunta(over: Partial<Parameters<typeof montarPerguntaPrecos>[0]> = {}) {
  return montarPerguntaPrecos({
    trechos: TRECHOS,
    cidades: CIDADES,
    quando: "maio de 2027",
    ...over,
  });
}

test("pede IDA, uma via, e NEGA ida-e-volta", () => {
  // O roteiro é uma sequência de trechos de uma via. Um preço de ida-e-volta não
  // teria onde encaixar sem ser rateado pela metade, o que inventa precisão.
  const p = pergunta();
  assert.match(p, /preço de IDA \(uma via\)/);
  assert.match(p, /NÃO ida e volta/);
});

test("proíbe ESTIMAR o que não foi encontrado", () => {
  // É a regra que protege a remoção do R$/km: sem ela, o valor inventado voltaria
  // pela porta da busca, agora com aparência de pesquisa.
  const p = pergunta();
  assert.match(p, /diga explicitamente que NÃO/);
  assert.match(p, /Não estime, não interpole, não use média de outra rota/);
  assert.match(p, /ninguém consegue conferi-lo depois/);
});

test("cada trecho vai com o IDENTIFICADOR, e o prompt manda copiá-lo", () => {
  // Sem isso a resposta não casa com a linha do roteiro, e o preço de um trecho
  // acabaria no outro — erro que não dá erro.
  const p = pergunta();
  assert.match(p, /\[p1\] Juiz de Fora → Curitiba/);
  assert.match(p, /\[volta\] Florianópolis → Juiz de Fora/);
  assert.match(p, /use-o exatamente como está/);
});

test("avião e ônibus vão em blocos separados, com as fontes de cada um", () => {
  const p = pergunta();
  const iAereo = p.indexOf("PASSAGEM AÉREA");
  const iOnibus = p.indexOf("PASSAGEM DE ÔNIBUS");
  assert.ok(iAereo >= 0 && iOnibus > iAereo);
  // O ônibus está no bloco dele, não no aéreo.
  assert.ok(p.slice(iOnibus).includes("[p2]"));
  assert.equal(p.slice(iAereo, iOnibus).includes("[p2]"), false);
  assert.match(p, /ClickBus, Buser/);
  assert.match(p, /Voopter, Kayak/);
});

test("bloco de modal AUSENTE não aparece vazio", () => {
  // Um cabeçalho "PASSAGEM DE ÔNIBUS:" sem nenhum trecho convidaria o modelo a
  // pesquisar algo que ninguém pediu.
  const soAviao = pergunta({ trechos: [TRECHOS[0]] });
  assert.equal(/PASSAGEM DE ÔNIBUS/.test(soAviao), false);
  const semCidade = pergunta({ cidades: [] });
  assert.equal(/DIÁRIA DE HOTEL/.test(semCidade), false);
});

test("o hotel é pedido por cidade, com as noites", () => {
  const p = pergunta();
  assert.match(p, /Curitiba — 2 noite\(s\)/);
  assert.match(p, /por quarto/);
});

test("o MÊS da viagem vai na pergunta — é o que decide a tarifa", () => {
  const p = pergunta();
  assert.match(p, /em maio de 2027/);
  // E o limite é dito: data distante pode não ter tarifa publicada.
  assert.match(p, /ainda não houver tarifa publicada/);
  assert.match(p, /mês mais próximo comparável/);
});

test("sem data a pergunta não finge saber o mês", () => {
  const p = pergunta({ quando: null });
  assert.match(p, /não informado/);
});

test("mesAno devolve mês e ano, ou null", () => {
  assert.equal(mesAno("2027-05-04"), "maio de 2027");
  assert.equal(mesAno("2027-12-31"), "dezembro de 2027");
  assert.equal(mesAno("2027-13-01"), null);
  assert.equal(mesAno("04/05/2027"), null);
  assert.equal(mesAno(""), null);
  assert.equal(mesAno(null), null);
});
