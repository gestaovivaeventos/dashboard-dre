// Cartão de despesa: o protocolo entre a IA e a tela da entrevista.
//
// O parser roda sobre texto PARCIAL (o cliente lê o stream token a token), e é
// por isso que quase todo teste aqui é sobre o que acontece com um bloco
// incompleto ou malformado. Um cartão que aparece cedo demais, pela metade,
// vira despesa errada no orçamento — e a validação da diretoria é item a item.

import test from "node:test";
import assert from "node:assert/strict";

import {
  MARCADOR_DESPESA_ABRE,
  MARCADOR_DESPESA_FECHA,
} from "./entrevista-prompt";
import { extrairCartaoDespesa, parseCartaoDespesa, serieItem } from "./planejamento-calc";

const bloco = (json: string) => `${MARCADOR_DESPESA_ABRE}${json}${MARCADOR_DESPESA_FECHA}`;

const CARTAO_OK = JSON.stringify({
  descricao: "Figma",
  grupo: "Design",
  valor: 350,
  periodicidade: "mensal",
  mesInicio: 3,
  mesFim: null,
  fornecedor: "Figma Inc",
  origem: "base",
});

test("extrai o cartão e tira o marcador do texto exibido", () => {
  const r = extrairCartaoDespesa(`Fechando então: Figma, R$ 350/mês.\n${bloco(CARTAO_OK)}`);
  assert.equal(r.texto, "Fechando então: Figma, R$ 350/mês.");
  assert.equal(r.cartao?.descricao, "Figma");
  assert.equal(r.cartao?.grupo, "Design");
  assert.equal(r.cartao?.valor, 350);
  assert.equal(r.cartao?.mesInicio, 3);
  assert.equal(r.cartao?.origem, "base");
  assert.equal(r.podeFechar, false);
});

test("bloco pela metade (streaming) não produz cartão e não vaza o marcador", () => {
  const parcial = `Fechando então: Figma.\n${MARCADOR_DESPESA_ABRE}{"descricao":"Fig`;
  const r = extrairCartaoDespesa(parcial);
  assert.equal(r.cartao, null);
  assert.equal(r.texto, "Fechando então: Figma.");
});

test("JSON inválido dentro do bloco não derruba nada", () => {
  const r = extrairCartaoDespesa(`Texto.\n${bloco("{isso não é json}")}`);
  assert.equal(r.cartao, null);
  assert.equal(r.texto, "Texto.");
});

test("sem nome ou sem valor não vira cartão", () => {
  assert.equal(parseCartaoDespesa(JSON.stringify({ descricao: "", valor: 10 })), null);
  assert.equal(parseCartaoDespesa(JSON.stringify({ descricao: "X" })), null);
  assert.equal(parseCartaoDespesa(JSON.stringify({ descricao: "X", valor: -5 })), null);
});

test("valor zero é aceito: despesa que o gestor zerou continua sendo decisão", () => {
  assert.equal(parseCartaoDespesa(JSON.stringify({ descricao: "X", valor: 0 }))?.valor, 0);
});

test("periodicidade desconhecida cai em mensal", () => {
  const c = parseCartaoDespesa(JSON.stringify({ descricao: "X", valor: 10, periodicidade: "quinzenal" }));
  assert.equal(c?.periodicidade, "mensal");
});

test("mês fora de 1..12 volta ao padrão", () => {
  const c = parseCartaoDespesa(JSON.stringify({ descricao: "X", valor: 10, mesInicio: 0, mesFim: 99 }));
  assert.equal(c?.mesInicio, 1);
  assert.equal(c?.mesFim, null);
});

test("anual ignora mesFim — ele não significa nada e seria ruído na tela", () => {
  const c = parseCartaoDespesa(
    JSON.stringify({ descricao: "X", valor: 1200, periodicidade: "anual", mesInicio: 6, mesFim: 9 }),
  );
  assert.equal(c?.mesFim, null);
  assert.deepEqual(serieItem(c!.valor, c!.mesInicio, c!.periodicidade, c!.mesFim), [
    0, 0, 0, 0, 0, 1200, 0, 0, 0, 0, 0, 0,
  ]);
});

test("mesFim anterior ao início vira 'até dezembro', não uma despesa de zero mês", () => {
  const c = parseCartaoDespesa(
    JSON.stringify({ descricao: "X", valor: 100, mesInicio: 8, mesFim: 3 }),
  );
  assert.equal(c?.mesFim, null);
  // Sem a correção, serieItem devolveria 12 zeros e a despesa somaria nada.
  const total = serieItem(c!.valor, c!.mesInicio, c!.periodicidade, c!.mesFim).reduce(
    (a, b) => a + b,
    0,
  );
  assert.equal(total, 500);
});

test("grupo e fornecedor em branco viram null", () => {
  const c = parseCartaoDespesa(
    JSON.stringify({ descricao: "X", valor: 10, grupo: "   ", fornecedor: "" }),
  );
  assert.equal(c?.grupo, null);
  assert.equal(c?.fornecedor, null);
});

test("origem só aceita 'base'; qualquer outra coisa é 'nova'", () => {
  assert.equal(parseCartaoDespesa(JSON.stringify({ descricao: "X", valor: 1, origem: "base" }))?.origem, "base");
  assert.equal(parseCartaoDespesa(JSON.stringify({ descricao: "X", valor: 1, origem: "mantido" }))?.origem, "nova");
  assert.equal(parseCartaoDespesa(JSON.stringify({ descricao: "X", valor: 1 }))?.origem, "nova");
});

test("cartão e [[FECHAR]] são lidos de forma independente", () => {
  const r = extrairCartaoDespesa(`Terminei.\n[[FECHAR]]`);
  assert.equal(r.podeFechar, true);
  assert.equal(r.cartao, null);
  assert.equal(r.texto, "Terminei.");
});

test("texto sem marcador nenhum passa intacto", () => {
  const r = extrairCartaoDespesa("Quanto você prevê gastar com isso em 2027?");
  assert.equal(r.texto, "Quanto você prevê gastar com isso em 2027?");
  assert.equal(r.cartao, null);
  assert.equal(r.podeFechar, false);
});

test("os dois trechos de uma mudança de valor no meio do ano se encaixam", () => {
  // O cartão tem UM valor; reajuste no meio do ano vira duas despesas, e o
  // prompt manda a IA quebrar assim. Se o encaixe falhasse, um mês ficaria sem
  // valor (buraco) ou contaria duas vezes (sobreposição) — em silêncio, porque
  // a Prévia só soma.
  const jan_mai = serieItem(50, 1, "mensal", 5);
  const jun_dez = serieItem(60, 6, "mensal", null);

  const soma = jan_mai.map((v, i) => v + jun_dez[i]);
  assert.ok(soma.every((v) => v > 0), "nenhum mês fica sem valor");
  assert.deepEqual(soma, [50, 50, 50, 50, 50, 60, 60, 60, 60, 60, 60, 60]);

  // E nenhum mês recebe os dois.
  jan_mai.forEach((v, i) => {
    assert.ok(v === 0 || jun_dez[i] === 0, `mês ${i + 1} contado duas vezes`);
  });

  assert.equal(
    soma.reduce((a, b) => a + b, 0),
    50 * 5 + 60 * 7,
  );
});
