// O cartão da viagem.
//
// Dois defeitos é que estes testes impedem, e os dois são silenciosos:
//
//  1. cartão aceito PELA METADE — o gestor clica em preencher e o formulário
//     recebe um roteiro que não é o que a conversa combinou;
//  2. CUSTO vindo da IA — um total plausível que ninguém consegue reconstruir,
//     que é exatamente o que o motor determinístico existe para evitar.

import test from "node:test";
import assert from "node:assert/strict";

import { aplicarCartao, extrairCartaoViagem, parseCartaoViagem } from "./cartao";

const COMPLETO = JSON.stringify({
  titulo: "Implantação em Curitiba e Floripa",
  finalidade: "Treinar as equipes das duas unidades novas",
  origem: "Juiz de Fora",
  dataIda: "2027-05-04",
  pessoas: 2,
  pessoasPorQuarto: 2,
  transladoCustoTrajeto: 40,
  transladoTrajetos: 2,
  voltaModal: "aviao",
  voltaPrecoPessoa: 900,
  outros: [{ descricao: "Seguro viagem", valor: 120 }],
  paradas: [
    {
      cidade: "Curitiba",
      noites: 2,
      chegadaDe: "Juiz de Fora",
      chegadaModal: "aviao",
      chegadaPrecoPessoa: 800,
      diariaHotel: 300,
      localDestino: "Viva Eventos Curitiba",
      localTrajetosDia: 2,
      localCustoTrajeto: 35,
    },
    { cidade: "Florianópolis", noites: 1, chegadaModal: "ônibus", chegadaDistanciaKm: 300 },
  ],
});

test("o cartão completo atravessa sem perder pedaço", () => {
  const c = parseCartaoViagem(COMPLETO);
  assert.ok(c);
  assert.equal(c.origem, "Juiz de Fora");
  assert.equal(c.dataIda, "2027-05-04");
  assert.equal(c.pessoas, 2);
  assert.equal(c.pessoasPorQuarto, 2);
  assert.equal(c.transladoTrajetos, 2);
  assert.equal(c.voltaModal, "aviao");
  assert.equal(c.voltaPrecoPessoa, 900);
  assert.deepEqual(c.outros, [{ descricao: "Seguro viagem", valor: 120 }]);
  assert.equal(c.paradas.length, 2);
  assert.equal(c.paradas[0].localDestino, "Viva Eventos Curitiba");
  assert.equal(c.paradas[1].chegadaDistanciaKm, 300);
});

test("'ônibus' e 'Avião' com acento viram o modal do motor", () => {
  // É como o modelo escreve naturalmente; recusar o acento jogaria o trecho em
  // "outro", que o motor estima por uma tarifa diferente.
  const c = parseCartaoViagem(COMPLETO);
  assert.equal(c?.paradas[1].chegadaModal, "onibus");
  const d = parseCartaoViagem(
    JSON.stringify({ paradas: [{ cidade: "SP", chegadaModal: "Avião" }] }),
  );
  assert.equal(d?.paradas[0].chegadaModal, "aviao");
});

test("modal desconhecido cai em CARRO, não em undefined", () => {
  const c = parseCartaoViagem(
    JSON.stringify({ paradas: [{ cidade: "SP", chegadaModal: "teleférico" }] }),
  );
  assert.equal(c?.paradas[0].chegadaModal, "carro");
});

test("sem parada NENHUMA não há cartão", () => {
  // Um cartão só com cabeçalho preencheria data e pessoas e deixaria a tela
  // parecendo pronta, sem roteiro — pior do que cartão nenhum.
  assert.equal(parseCartaoViagem(JSON.stringify({ origem: "JF", pessoas: 2 })), null);
  assert.equal(parseCartaoViagem(JSON.stringify({ paradas: [] })), null);
  assert.equal(parseCartaoViagem(JSON.stringify({ paradas: [{ noites: 2 }] })), null);
});

test("parada sem cidade é DESCARTADA, e as outras continuam", () => {
  const c = parseCartaoViagem(
    JSON.stringify({ paradas: [{ cidade: "Curitiba" }, { noites: 3 }, { cidade: "Joinville" }] }),
  );
  assert.deepEqual(c?.paradas.map((p) => p.cidade), ["Curitiba", "Joinville"]);
});

test("NENHUM custo total da IA é lido — o número é do motor", () => {
  const c = parseCartaoViagem(
    JSON.stringify({
      custoTotal: 9999,
      total: 9999,
      custo: 9999,
      paradas: [{ cidade: "Curitiba" }],
    }),
  );
  assert.ok(c);
  assert.equal(JSON.stringify(c).includes("9999"), false, "nenhum total entrou no cartão");
});

test("data em outro formato é DESCARTADA, nunca adivinhada", () => {
  // "04/05/2027" é ambíguo entre dia/mês e mês/dia; chutar aqui colocaria a
  // viagem no mês errado do orçamento sem ninguém perceber.
  for (const d of ["04/05/2027", "2027-13-01", "2027-05-32", "maio de 2027", ""]) {
    const c = parseCartaoViagem(JSON.stringify({ dataIda: d, paradas: [{ cidade: "X" }] }));
    assert.equal(c?.dataIda, null, d);
  }
  assert.equal(
    parseCartaoViagem(JSON.stringify({ dataIda: "2027-05-04", paradas: [{ cidade: "X" }] }))
      ?.dataIda,
    "2027-05-04",
  );
});

test("valor negativo não entra — é dado inconsistente, não desconto", () => {
  const c = parseCartaoViagem(
    JSON.stringify({
      pessoas: -3,
      paradas: [{ cidade: "X", noites: -2, chegadaPrecoPessoa: -800, diariaHotel: 250 }],
      outros: [{ descricao: "Estorno", valor: -50 }],
    }),
  );
  assert.ok(c);
  assert.equal(c.pessoas, null);
  assert.equal(c.paradas[0].noites, 0);
  assert.equal(c.paradas[0].chegadaPrecoPessoa, null);
  assert.equal(c.paradas[0].diariaHotel, 250);
  assert.deepEqual(c.outros, []);
});

test("JSON quebrado não vira cartão nem explode", () => {
  for (const bruto of ["{", "", "não é json", "[1,2,3]", "null", '"texto"']) {
    assert.equal(parseCartaoViagem(bruto), null, bruto);
  }
});

// ─── A extração sobre o texto do streaming ──────────────────────────────────

test("o bloco INCOMPLETO do streaming não vira cartão, e nada pisca na tela", () => {
  const parcial = 'Fechei assim:\n[[VIAGEM]]{"paradas":[{"cidade":"Curi';
  const r = extrairCartaoViagem(parcial);
  assert.equal(r.cartao, null);
  assert.equal(r.texto, "Fechei assim:", "o marcador não aparece no texto exibido");
});

test("o cartão sai do texto, e o texto fica limpo", () => {
  const msg = `Então é isso.\n[[VIAGEM]]${COMPLETO}[[/VIAGEM]]`;
  const r = extrairCartaoViagem(msg);
  assert.equal(r.texto, "Então é isso.");
  assert.equal(r.cartao?.paradas.length, 2);
});

test("[[FECHAR]] convive com o cartão no fim da mensagem", () => {
  const msg = `Pronto.\n[[VIAGEM]]${COMPLETO}[[/VIAGEM]]\n[[FECHAR]]`;
  const r = extrairCartaoViagem(msg);
  assert.equal(r.podeFechar, true);
  assert.ok(r.cartao, "cortar no primeiro [[ sem extrair antes perderia o cartão");
  assert.equal(r.texto, "Pronto.");
});

test("mensagem sem marcador nenhum passa inteira", () => {
  const r = extrairCartaoViagem("Quantas pessoas vão nesta viagem?");
  assert.equal(r.texto, "Quantas pessoas vão nesta viagem?");
  assert.equal(r.cartao, null);
  assert.equal(r.podeFechar, false);
});

// ─── Aplicar o cartão ao rascunho ───────────────────────────────────────────
// A regra que estes testes protegem: a leitura é SUGESTÃO. O defeito que eles
// impedem é o pior desta tela — a IA apagar um preço que o gestor digitou,
// baixando o orçamento em silêncio.

const RASCUNHO = {
  titulo: "Viagem a Curitiba",
  finalidade: "Treinar a equipe",
  origem: "Juiz de Fora",
  dataIda: "2027-05-04",
  pessoas: 2,
  pessoasPorQuarto: 2,
  transladoCustoTrajeto: 40,
  transladoTrajetos: 2,
  voltaModal: "aviao",
  voltaPrecoPessoa: 900,
  voltaDistanciaKm: null,
  voltaPrecoTotal: null,
  voltaPedagios: null,
  voltaVeiculos: null,
  outros: [{ descricao: "Seguro", valor: 120 }],
  paradas: [{ cidade: "Curitiba", noites: 2 }],
};

function cartao(json: Record<string, unknown>) {
  const c = parseCartaoViagem(JSON.stringify({ paradas: [{ cidade: "X" }], ...json }));
  assert.ok(c);
  return c;
}

test("campo que o cartão NÃO trouxe preserva o que está na tela", () => {
  // A IA deixa vazio o que não sabe. Sobrescrever com vazio apagaria o preço
  // que o gestor acabou de digitar — e o custo cairia sem ninguém ver.
  const r = aplicarCartao(RASCUNHO, cartao({}));
  assert.equal(r.titulo, "Viagem a Curitiba");
  assert.equal(r.finalidade, "Treinar a equipe");
  assert.equal(r.origem, "Juiz de Fora");
  assert.equal(r.dataIda, "2027-05-04");
  assert.equal(r.pessoas, 2);
  assert.equal(r.transladoCustoTrajeto, 40);
  assert.equal(r.voltaPrecoPessoa, 900);
  assert.deepEqual(r.outros, [{ descricao: "Seguro", valor: 120 }]);
});

test("campo que o cartão trouxe VENCE", () => {
  const r = aplicarCartao(
    RASCUNHO,
    cartao({ titulo: "Nova", origem: "Belo Horizonte", pessoas: 4, dataIda: "2027-06-01" }),
  );
  assert.equal(r.titulo, "Nova");
  assert.equal(r.origem, "Belo Horizonte");
  assert.equal(r.pessoas, 4);
  assert.equal(r.dataIda, "2027-06-01");
});

test("as PARADAS são substituídas — o cartão traz o roteiro inteiro", () => {
  // Mesclar parada por parada daria um roteiro que não é nem o antigo nem o
  // proposto, e ninguém saberia de onde ele veio.
  const r = aplicarCartao(
    RASCUNHO,
    cartao({ paradas: [{ cidade: "Florianópolis", noites: 1 }, { cidade: "Joinville" }] }),
  );
  assert.deepEqual(r.paradas.map((p) => p.cidade), ["Florianópolis", "Joinville"]);
});

test("`outros` vazio no cartão NÃO apaga os avulsos digitados", () => {
  const r = aplicarCartao(RASCUNHO, cartao({ outros: [] }));
  assert.deepEqual(r.outros, [{ descricao: "Seguro", valor: 120 }]);
});

test("o cartão não consegue REMOVER a volta — e isso é assumido", () => {
  // "sem volta" e "não sei" chegam os dois como null, indistinguíveis. Manter é
  // o lado seguro; quem tira a volta é o gestor no formulário.
  const r = aplicarCartao(RASCUNHO, cartao({ voltaModal: null }));
  assert.equal(r.voltaModal, "aviao");
});

test("aplicar não muta o rascunho original", () => {
  const antes = JSON.stringify(RASCUNHO);
  aplicarCartao(RASCUNHO, cartao({ titulo: "Outra", paradas: [{ cidade: "Z" }] }));
  assert.equal(JSON.stringify(RASCUNHO), antes);
});
