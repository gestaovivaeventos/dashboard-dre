// Prompt da entrevista de orçamento base zero: classe da despesa, materialidade
// (quem recebe o pacote completo) e o que entra no system prompt.

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSystemPrompt,
  classeDespesa,
  materialidade,
  realizadoContexto,
} from "./entrevista-prompt";
import type { MediaRealizado } from "./media-realizado";

const item = (valorMensal: number, extra: Partial<{ periodicidade: "mensal" | "anual"; mesInicio: number }> = {}) => ({
  descricao: `item ${valorMensal}`,
  valorMensal,
  periodicidade: extra.periodicidade ?? ("mensal" as const),
  mesInicio: extra.mesInicio ?? 1,
  mesFim: null,
});

// ─── Classe da despesa ───────────────────────────────────────────────────────

test("classe: estrutural para aluguel, impostos e contas de consumo", () => {
  assert.equal(classeDespesa("Aluguel", ""), "estrutural");
  assert.equal(classeDespesa("IPTU", ""), "estrutural");
  assert.equal(classeDespesa("Energia Elétrica", ""), "estrutural");
  assert.equal(classeDespesa("Pró-labore", ""), "estrutural");
});

test("classe: contratual para assinaturas e sistemas", () => {
  assert.equal(classeDespesa("Softwares e Assinaturas", ""), "contratual");
  assert.equal(classeDespesa("Telefonia e Internet", ""), "contratual");
});

test("classe: discricionária para consultoria e treinamento", () => {
  assert.equal(classeDespesa("Consultoria", ""), "discricionaria");
  assert.equal(classeDespesa("Treinamento e Desenvolvimento", ""), "discricionaria");
});

test("classe: variável para marketing e manutenção", () => {
  assert.equal(classeDespesa("Marketing e Publicidade", ""), "variavel");
  assert.equal(classeDespesa("Manutenção de Imobilizado", ""), "variavel");
});

test("classe: sem palavra conhecida devolve null (a IA classifica)", () => {
  assert.equal(classeDespesa("Outras Despesas", ""), null);
});

// ─── Materialidade ───────────────────────────────────────────────────────────

test("materialidade: os itens que somam 80% recebem pacote completo, a cauda vai rápido", () => {
  // 1000 + 500 = 75% do total de 2000; o 3º (300) fecha os 90% → ainda completo
  // porque antes dele o acumulado era 75% (< 80%). Os dois de 100 são cauda.
  const m = materialidade([item(100), item(1000), item(300), item(500), item(100)]);
  const porIndice = new Map(m.map((x) => [x.indice, x]));
  assert.equal(porIndice.get(1)?.profundidade, "completa");
  assert.equal(porIndice.get(3)?.profundidade, "completa");
  assert.equal(porIndice.get(2)?.profundidade, "completa");
  assert.equal(porIndice.get(0)?.profundidade, "rapida");
  assert.equal(porIndice.get(4)?.profundidade, "rapida");
  assert.ok(Math.abs((porIndice.get(1)?.peso ?? 0) - 0.5) < 1e-9);
});

test("materialidade: com até 3 itens todos recebem pacote completo", () => {
  const m = materialidade([item(1000), item(10), item(1)]);
  assert.ok(m.every((x) => x.profundidade === "completa"));
});

test("materialidade: item com 10% ou mais do total nunca vai para a cauda", () => {
  // 8500 sozinho já passa dos 80% (82,5%); o de 1100 (10,7%) entra pela regra
  // dos 10%, e cada 100 (1%) é cauda.
  const m = materialidade([item(8500), ...Array.from({ length: 7 }, () => item(100)), item(1100)]);
  const grande = m.find((x) => x.indice === 8);
  assert.equal(grande?.profundidade, "completa");
  assert.equal(m.find((x) => x.indice === 1)?.profundidade, "rapida");
});

test("materialidade: usa o total do ano (anual pesa uma vez, mensal doze)", () => {
  const m = materialidade([item(1200, { periodicidade: "anual" }), item(100)]);
  const a = m.find((x) => x.indice === 0)!;
  const b = m.find((x) => x.indice === 1)!;
  assert.equal(a.totalAno, 1200);
  assert.equal(b.totalAno, 1200);
  assert.ok(Math.abs(a.peso - 0.5) < 1e-9);
});

test("materialidade: lista vazia ou tudo zero não quebra", () => {
  assert.deepEqual(materialidade([]), []);
  const m = materialidade([item(0), item(0), item(0), item(0)]);
  assert.equal(m.length, 4);
  assert.ok(m.every((x) => x.peso === 0));
});

// ─── Realizado mês a mês ─────────────────────────────────────────────────────

const realizado = (meses: (number | null)[], media: number | null, total?: number): MediaRealizado => ({
  meses,
  total: total ?? meses.reduce<number>((a, b) => a + (b ?? 0), 0),
  mesesConsiderados: meses.filter((v) => v != null).length,
  media,
});

test("realizadoContexto: traz total, média, mês a mês e aponta meses fora da curva", () => {
  const meses = [1000, 1000, 3500, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000];
  const txt = realizadoContexto(realizado(meses, 1208.33));
  assert.match(txt, /total/i);
  assert.match(txt, /jan/i);
  assert.match(txt, /fora da curva/i);
  assert.match(txt, /mar/i);
});

test("realizadoContexto: sem mês fora da curva não inventa aviso", () => {
  const meses = Array<number | null>(12).fill(1000);
  const txt = realizadoContexto(realizado(meses, 1000));
  assert.doesNotMatch(txt, /fora da curva/i);
});

test("realizadoContexto: sem dados diz que não há realizado", () => {
  assert.match(realizadoContexto(undefined), /sem dados/i);
  assert.match(realizadoContexto(realizado(Array(12).fill(null), null, 0)), /sem gasto registrado/i);
});

// ─── System prompt ───────────────────────────────────────────────────────────

function promptBase(over: Partial<Parameters<typeof buildSystemPrompt>[0]> = {}) {
  return buildSystemPrompt({
    companyName: "Viva Teste",
    categoryName: "Softwares e Assinaturas",
    dreLineCode: "4.2",
    dreLineName: "Despesas administrativas",
    year: 2027,
    realizado: realizado(Array(12).fill(1000), 1000),
    itens: [item(600), item(300), item(50), item(30), item(20)],
    contextoAdmin: "",
    streaming: true,
    ...over,
  });
}

test("prompt: leva os quatro blocos e a pergunta de Drucker", () => {
  const p = promptBase();
  assert.match(p, /BLOCO 0/);
  assert.match(p, /BLOCO 1/);
  assert.match(p, /BLOCO 2/);
  assert.match(p, /BLOCO 3/);
  assert.match(p, /contrataria hoje/i);
  assert.match(p, /base zero/i);
});

test("prompt: marca a profundidade de cada item da base", () => {
  const p = promptBase();
  assert.match(p, /item 600.*pacote completo/);
  assert.match(p, /item 20.*conferência rápida/);
  assert.match(p, /\d+% do total/);
});

test("prompt: não repete a regra antiga de só perguntar se mantém", () => {
  const p = promptBase();
  assert.doesNotMatch(p, /NÃO pergunte o valor nem o mês/);
  assert.doesNotMatch(p, /a ÚNICA dúvida é se ele será MANTIDO/);
});

test("prompt: classe conhecida entra com a condução dela; desconhecida pede à IA para classificar", () => {
  const conhecida = promptBase({ categoryName: "Aluguel" });
  assert.match(conhecida, /CLASSE DA DESPESA: estrutural/i);
  assert.match(conhecida, /valor atualizado/i);
  const desconhecida = promptBase({ categoryName: "Outras Despesas" });
  assert.match(desconhecida, /classifique/i);
});

test("prompt: sem base a entrevista é aberta e sem lista de itens", () => {
  const p = promptBase({ itens: [] });
  assert.match(p, /NÃO tem itens pré-cadastrados/);
  assert.doesNotMatch(p, /ITENS DA BASE/);
});

test("prompt: contexto do admin e regra da categoria continuam entrando", () => {
  const p = promptBase({ categoryName: "Pró-labore", contextoAdmin: "Reajuste de 5% para todos." });
  assert.match(p, /CONTEXTO DO ADMINISTRADOR/);
  assert.match(p, /Reajuste de 5%/);
  assert.match(p, /SALÁRIO DOS SÓCIOS/);
});

test("prompt: rabo de streaming pede [[FECHAR]] e o de JSON pede a proposta", () => {
  assert.match(promptBase({ streaming: true }), /\[\[FECHAR\]\]/);
  const j = promptBase({ streaming: false });
  assert.match(j, /"proposta"/);
  assert.match(j, /justificativa/);
  assert.doesNotMatch(j, /\[\[FECHAR\]\]/);
});

test("prompt: mês a mês do realizado entra no cabeçalho", () => {
  const meses = [1000, 1000, 3500, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000];
  const p = promptBase({ realizado: realizado(meses, 1208.33) });
  assert.match(p, /fora da curva/i);
});
