// Calibrar as faixas com a web.
//
// O que se trava aqui: a mediana (média deixaria uma rota caríssima arrastar o
// número que vinte linhas leem), o peso por CUSTO (não por contagem) e a unidade
// da faixa — dobrar o preço de ida faria toda viagem custar quatro vias.

import test from "node:test";
import assert from "node:assert/strict";

import {
  linhasDaFaixa,
  medianaDosPrecos,
  mesDominante,
  pesoDasFaixas,
  propostaDaFaixa,
  rotasDaFaixa,
  type FaixaParaCalibrar,
  type LinhaParaCalibrar,
} from "./calibragem";

const AEREA: FaixaParaCalibrar = {
  id: "f-ne",
  tipo: "passagem",
  nome: "Capital Nordeste",
  valor: 1000,
  modal: "aviao",
};
const HOTEL: FaixaParaCalibrar = {
  id: "h-cap",
  tipo: "hospedagem",
  nome: "Capital",
  valor: 300,
  modal: null,
};

function linha(p: Partial<LinhaParaCalibrar>): LinhaParaCalibrar {
  return {
    destino: "Recife",
    noites: 2,
    pessoas: 2,
    mesIda: 5,
    faixaPassagemId: "f-ne",
    faixaHospedagemId: "h-cap",
    custoTotal: 5000,
    ...p,
  };
}

// ─── A mediana ──────────────────────────────────────────────────────────────

test("mediana ímpar, par e com um ponto só", () => {
  assert.equal(medianaDosPrecos([100, 900, 300]), 300);
  assert.equal(medianaDosPrecos([100, 300]), 200, "dois pontos: a média dos dois");
  assert.equal(medianaDosPrecos([450]), 450);
  assert.equal(medianaDosPrecos([]), null);
});

test("a mediana ignora zero, negativo e NaN — e não deixa um outlier mandar", () => {
  // Rota com companhia única custa múltiplos das outras da mesma faixa.
  assert.equal(medianaDosPrecos([0, -5, Number.NaN, 400, 600, 9000]), 600);
});

// ─── Quem lê a faixa ────────────────────────────────────────────────────────

test("hospedagem ignora BATE-VOLTA; passagem não", () => {
  // Em viagem sem pernoite a faixa de hotel não pesa nada.
  const ls = [linha({ noites: 0 }), linha({ noites: 3 })];
  assert.equal(linhasDaFaixa(ls, HOTEL).length, 1);
  assert.equal(linhasDaFaixa(ls, AEREA).length, 2);
});

test("linha de outra faixa fica fora", () => {
  const ls = [linha({}), linha({ faixaPassagemId: "f-se" })];
  assert.equal(linhasDaFaixa(ls, AEREA).length, 1);
});

// ─── As rotas representativas ───────────────────────────────────────────────

test("as rotas vêm pelo CUSTO que carregam, não em ordem alfabética", () => {
  const ls = [
    linha({ destino: "Aracaju", custoTotal: 1000 }),
    linha({ destino: "Salvador", custoTotal: 9000 }),
    linha({ destino: "Recife", custoTotal: 5000 }),
  ];
  assert.deepEqual(rotasDaFaixa(ls, AEREA), ["Salvador", "Recife", "Aracaju"]);
});

test("a mesma cidade em quatro linhas entra UMA vez, somando o peso", () => {
  // Buscar o mesmo trecho quatro vezes gastaria a busca sem acrescentar ponto
  // nenhum à mediana.
  const ls = [
    linha({ destino: "Recife", custoTotal: 1000 }),
    linha({ destino: "Recife", custoTotal: 1000 }),
    linha({ destino: " Recife ", custoTotal: 1000 }),
    linha({ destino: "Salvador", custoTotal: 2500 }),
  ];
  assert.deepEqual(rotasDaFaixa(ls, AEREA), ["Recife", "Salvador"]);
});

test("o teto limita quantas rotas vão à busca", () => {
  const ls = Array.from({ length: 8 }, (_, i) =>
    linha({ destino: `Cidade ${i}`, custoTotal: 100 * (8 - i) }),
  );
  assert.deepEqual(rotasDaFaixa(ls, AEREA, 3), ["Cidade 0", "Cidade 1", "Cidade 2"]);
});

// ─── O mês da busca ─────────────────────────────────────────────────────────

test("o mês é o mais frequente; empate fica com o mais cedo", () => {
  const ls = [linha({ mesIda: 9 }), linha({ mesIda: 3 }), linha({ mesIda: 9 })];
  assert.equal(mesDominante(ls, AEREA), 9);
  assert.equal(mesDominante([linha({ mesIda: 9 }), linha({ mesIda: 3 })], AEREA), 3);
});

test("nenhum mês definido devolve null — janeiro por padrão calibraria pelo mês mais caro", () => {
  assert.equal(mesDominante([linha({ mesIda: null })], AEREA), null);
  assert.equal(mesDominante([], AEREA), null);
});

// ─── O Pareto sobre as faixas ───────────────────────────────────────────────

test("a faixa que carrega o grosso é prioritária; a de 1% não", () => {
  const pesados = [90_000, 6_000, 2_000, 1_000, 1_000];
  const faixas: FaixaParaCalibrar[] = pesados.map((_, i) => ({
    ...AEREA,
    id: `f-${i}`,
    nome: `Faixa ${i}`,
  }));
  const ls = pesados.map((c, i) => linha({ faixaPassagemId: `f-${i}`, custoTotal: c }));
  const pesos = pesoDasFaixas(ls, faixas);
  const porId = new Map(pesos.map((p) => [p.id, p] as const));
  assert.equal(porId.get("f-0")!.prioritaria, true);
  assert.equal(porId.get("f-4")!.prioritaria, false, "1% do total não vale uma busca");
  assert.equal(Math.round(porId.get("f-0")!.peso * 100), 90);
});

test("com ATÉ TRÊS faixas, todas valem a busca", () => {
  // Herdado do Pareto do Planejamento, de propósito: com três, escolher duas não
  // economiza nada que importe, e a faixa de fora seria justamente a que o
  // administrador nunca revisaria.
  const faixas: FaixaParaCalibrar[] = [
    AEREA,
    { ...AEREA, id: "f-se", nome: "Capital Sudeste" },
    { ...AEREA, id: "f-int", nome: "Interior" },
  ];
  const ls = [
    linha({ faixaPassagemId: "f-ne", custoTotal: 90_000 }),
    linha({ faixaPassagemId: "f-se", custoTotal: 9_000 }),
    linha({ faixaPassagemId: "f-int", custoTotal: 1_000 }),
  ];
  assert.equal(
    pesoDasFaixas(ls, faixas).every((p) => p.prioritaria),
    true,
  );
});

test("faixa SEM linha nenhuma nunca é prioritária — não há o que calibrar", () => {
  const faixas: FaixaParaCalibrar[] = [AEREA, { ...AEREA, id: "f-vazia", nome: "Vazia" }];
  const pesos = pesoDasFaixas([linha({})], faixas);
  const vazia = pesos.find((p) => p.id === "f-vazia")!;
  assert.equal(vazia.linhas, 0);
  assert.equal(vazia.total, 0);
  assert.equal(vazia.prioritaria, false);
});

test("grade vazia não divide por zero", () => {
  const pesos = pesoDasFaixas([], [AEREA]);
  assert.equal(pesos[0].peso, 0);
  assert.equal(pesos[0].prioritaria, false);
});

// ─── A proposta ─────────────────────────────────────────────────────────────

test("a proposta é a mediana das amostras, na MESMA unidade da faixa", () => {
  // A faixa de passagem é por pessoa e SÓ IDA; a busca também pede ida. Dobrar
  // aqui faria toda viagem custar quatro vias.
  const p = propostaDaFaixa(AEREA, [
    { cidade: "Recife", valor: 800, fonte: "Voopter" },
    { cidade: "Salvador", valor: 1200, fonte: "Kayak" },
    { cidade: "Natal", valor: 1000, fonte: null },
  ]);
  assert.equal(p.valor, 1000);
  assert.equal(p.valorAtual, 1000);
  assert.equal(p.variacao, 0);
  assert.equal(p.amostras.length, 3);
});

test("sem amostra, o valor é null — e não zero", () => {
  // Zero sobrescreveria a faixa curada com "de graça".
  const p = propostaDaFaixa(AEREA, []);
  assert.equal(p.valor, null);
  assert.equal(p.variacao, null);
});

test("faixa em ZERO não tem variação definida", () => {
  const p = propostaDaFaixa({ ...AEREA, valor: 0 }, [{ cidade: "Recife", valor: 900, fonte: null }]);
  assert.equal(p.valor, 900);
  assert.equal(p.variacao, null, "infinito não é informação");
});

test("a variação diz o tamanho da mudança", () => {
  const p = propostaDaFaixa(AEREA, [{ cidade: "Recife", valor: 1500, fonte: null }]);
  assert.equal(p.variacao, 0.5);
});

test("as fontes são deduplicadas e sem vazio", () => {
  const p = propostaDaFaixa(AEREA, [{ cidade: "Recife", valor: 900, fonte: null }], [
    "voopter.com",
    "voopter.com",
    "",
    "kayak.com",
  ]);
  assert.deepEqual(p.fontes, ["voopter.com", "kayak.com"]);
});
