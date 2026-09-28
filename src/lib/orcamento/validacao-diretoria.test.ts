// Regras da validação da diretoria.
//
// São quatro estados e duas perguntas — o que entra no número e quem edita —,
// e é justamente por serem poucas que elas precisam estar travadas: cada uma
// vale em dois lugares (servidor e tela), e se os dois divergirem a tela deixa
// digitar o que o servidor recusa.

import test from "node:test";
import assert from "node:assert/strict";

import {
  chaveMedia,
  contarEstados,
  contarValidacoes,
  decisaoVencida,
  entraNoNumero,
  estadoDoItem,
  gestorPodeEditar,
  motivoDaTrava,
  podeDecidir,
} from "./validacao-diretoria";

const dec = (status: "aprovado" | "reprovado" | "revisar", decididoEm: string) => ({
  status,
  decididoEm,
});

// ─── O que entra no número ───────────────────────────────────────────────────

test("SÓ o aprovado compõe o número da empresa", () => {
  assert.equal(entraNoNumero("aprovado"), true);
  assert.equal(entraNoNumero("pendente"), false);
  assert.equal(entraNoNumero("reprovado"), false);
  assert.equal(entraNoNumero("revisar"), false);
});

// ─── Quem edita ──────────────────────────────────────────────────────────────

test("o gestor edita o pendente e o que voltou para revisar", () => {
  assert.equal(gestorPodeEditar("pendente"), true);
  assert.equal(gestorPodeEditar("revisar"), true);
});

test("decisão tomada tira o item das mãos do gestor", () => {
  assert.equal(gestorPodeEditar("aprovado"), false);
  assert.equal(gestorPodeEditar("reprovado"), false);
  assert.match(motivoDaTrava("aprovado") ?? "", /aprovado/i);
  assert.match(motivoDaTrava("reprovado") ?? "", /reprovado/i);
  assert.equal(motivoDaTrava("pendente"), null);
  assert.equal(motivoDaTrava("revisar"), null);
});

test("quem decide é a diretoria e o admin", () => {
  assert.equal(podeDecidir("validador"), true);
  assert.equal(podeDecidir("admin"), true);
  assert.equal(podeDecidir("construtor"), false);
  assert.equal(podeDecidir("construtor_amplo"), false);
});

// ─── Vencimento por edição ───────────────────────────────────────────────────

test("item alterado DEPOIS da decisão a vence", () => {
  // É o que dispensa hook nas 15 actions de escrita.
  assert.equal(decisaoVencida("2027-01-10T10:00:00Z", "2027-01-10T10:00:01Z"), true);
});

test("item alterado ANTES da decisão não a vence", () => {
  assert.equal(decisaoVencida("2027-01-10T10:00:00Z", "2027-01-09T23:59:00Z"), false);
});

test("empate conta como válida — é artefato de relógio, não edição", () => {
  assert.equal(decisaoVencida("2027-01-10T10:00:00Z", "2027-01-10T10:00:00Z"), false);
});

test("data ausente ou inválida nunca vence a decisão", () => {
  // Falhar para o lado de MANTER o aprovado: derrubar o número da empresa por
  // causa de um campo nulo seria pior do que um visto velho de um dia.
  assert.equal(decisaoVencida(null, "2027-01-10T10:00:00Z"), false);
  assert.equal(decisaoVencida("2027-01-10T10:00:00Z", null), false);
  assert.equal(decisaoVencida("nada", "2027-01-10T10:00:00Z"), false);
});

test("decisão vencida faz o item voltar a PENDENTE", () => {
  const e = estadoDoItem(dec("aprovado", "2027-01-10T10:00:00Z"), "2027-01-11T08:00:00Z");
  assert.equal(e, "pendente");
  assert.equal(entraNoNumero(e), false, "sai do número da empresa");
  assert.equal(gestorPodeEditar(e), true, "e volta para as mãos do gestor");
});

test("sem decisão o item é pendente", () => {
  assert.equal(estadoDoItem(null, "2027-01-10T10:00:00Z"), "pendente");
  assert.equal(estadoDoItem(undefined, null), "pendente");
});

test("decisão viva é respeitada", () => {
  assert.equal(
    estadoDoItem(dec("reprovado", "2027-02-01T10:00:00Z"), "2027-01-10T10:00:00Z"),
    "reprovado",
  );
});

// ─── Contadores dos cards ────────────────────────────────────────────────────

test("conta cada estado e soma o total", () => {
  const c = contarValidacoes([
    { atualizadoEm: "2027-01-01T00:00:00Z", validacao: dec("aprovado", "2027-02-01T00:00:00Z") },
    { atualizadoEm: "2027-01-01T00:00:00Z", validacao: dec("aprovado", "2027-02-01T00:00:00Z") },
    { atualizadoEm: "2027-01-01T00:00:00Z", validacao: dec("reprovado", "2027-02-01T00:00:00Z") },
    { atualizadoEm: "2027-01-01T00:00:00Z", validacao: dec("revisar", "2027-02-01T00:00:00Z") },
    { atualizadoEm: "2027-01-01T00:00:00Z", validacao: null },
  ]);
  assert.deepEqual(c, { pendentes: 1, aprovados: 2, reprovados: 1, revisar: 1, total: 5 });
});

test("decisão vencida entra como pendente no contador do diretor", () => {
  // Sem isto, o diretor não veria que voltou trabalho para ele.
  const c = contarValidacoes([
    { atualizadoEm: "2027-03-01T00:00:00Z", validacao: dec("aprovado", "2027-02-01T00:00:00Z") },
  ]);
  assert.equal(c.pendentes, 1);
  assert.equal(c.aprovados, 0);
});

test("lista vazia zera tudo", () => {
  assert.deepEqual(contarValidacoes([]), {
    pendentes: 0,
    aprovados: 0,
    reprovados: 0,
    revisar: 0,
    total: 0,
  });
});

test("contarEstados conta o que a Prévia já resolveu", () => {
  // A Prévia resolve o estado de cada item ao montá-la (inclusive o
  // vencimento). Recontar a partir das decisões cruas ali faria os dois
  // números discordarem: a tela diria "3 a verificar" com 4 itens pendentes.
  assert.deepEqual(contarEstados(["aprovado", "pendente", "pendente", "revisar", "reprovado"]), {
    pendentes: 2,
    aprovados: 1,
    reprovados: 1,
    revisar: 1,
    total: 5,
  });
  assert.deepEqual(contarEstados([]), {
    pendentes: 0,
    aprovados: 0,
    reprovados: 0,
    revisar: 0,
    total: 0,
  });
});

test("as duas contagens concordam quando partem do mesmo insumo", () => {
  // É a invariante que permite o card (que conta pelas decisões) e a prévia
  // do setor (que conta pelos estados já resolvidos) mostrarem o mesmo número.
  const itens = [
    { atualizadoEm: "2027-01-01T00:00:00Z", validacao: dec("aprovado", "2027-02-01T00:00:00Z") },
    { atualizadoEm: "2027-03-01T00:00:00Z", validacao: dec("aprovado", "2027-02-01T00:00:00Z") },
    { atualizadoEm: null, validacao: null },
    { atualizadoEm: "2027-01-01T00:00:00Z", validacao: dec("revisar", "2027-02-01T00:00:00Z") },
  ];
  assert.deepEqual(
    contarEstados(itens.map((i) => estadoDoItem(i.validacao, i.atualizadoEm))),
    contarValidacoes(itens),
  );
});

// ─── Chave da média ──────────────────────────────────────────────────────────

test("a média é chaveada por categoria × setor, porque pode não ter linha", () => {
  assert.equal(chaveMedia("2.01", "s1"), "2.01|s1");
  assert.equal(chaveMedia("2.01", null), "2.01|");
  assert.notEqual(chaveMedia("2.01", "s1"), chaveMedia("2.01", "s2"));
});
