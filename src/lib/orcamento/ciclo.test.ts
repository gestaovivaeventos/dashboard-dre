// Máquina de estados do ciclo do orçamento.
//
// Trava as três regras que se quebram por engano ao mexer numa tela:
//  1. quem pode disparar cada transição;
//  2. quem pode ESCREVER em cada fase (a trava que faz a validação valer);
//  3. qual versão é congelada em cada transição — e essa é a que não dá para
//     consertar depois, porque snapshot não se faz retroativamente.

import test from "node:test";
import assert from "node:assert/strict";

import {
  aplicarTransicao,
  incrementaRodada,
  podeEntregarSetor,
  podeEscreverNaFase,
  transicoesDisponiveis,
  versaoDaTransicao,
  type CicloEstado,
} from "./ciclo";

const ESTADOS: CicloEstado[] = [
  "em_construcao",
  "em_validacao",
  "em_ajuste",
  "concluido",
  "publicado",
];

// ─── Transições ──────────────────────────────────────────────────────────────

test("o fluxo completo anda: construção → validação → ajuste → concluído → publicado", () => {
  let estado: CicloEstado = "em_construcao";
  for (const [transicao, esperado] of [
    ["enviar_validacao", "em_validacao"],
    ["concluir_validacao", "em_ajuste"],
    ["concluir", "concluido"],
    ["publicar", "publicado"],
  ] as const) {
    const r = aplicarTransicao(estado, transicao, "admin");
    assert.ok(r.ok, `${transicao} de ${estado}`);
    assert.equal(r.estado, esperado);
    estado = r.estado;
  }
});

test("reenviar volta o ciclo para validação (2ª rodada)", () => {
  const r = aplicarTransicao("em_ajuste", "reenviar", "admin");
  assert.ok(r.ok);
  assert.equal(r.estado, "em_validacao");
});

test("transição fora de ordem é recusada com o motivo, não silenciosamente", () => {
  const r = aplicarTransicao("em_construcao", "publicar", "admin");
  assert.ok(!r.ok);
  assert.match(r.error, /Em construção/);
});

test("concluir validação é do validador E do admin; o resto é só do admin", () => {
  assert.ok(aplicarTransicao("em_validacao", "concluir_validacao", "validador").ok);
  assert.ok(aplicarTransicao("em_validacao", "concluir_validacao", "admin").ok);

  for (const papel of ["construtor", "construtor_amplo", "validador"] as const) {
    assert.ok(
      !aplicarTransicao("em_construcao", "enviar_validacao", papel).ok,
      `${papel} não envia para validação`,
    );
  }
  assert.ok(!aplicarTransicao("concluido", "publicar", "validador").ok);
});

test("construtor não tem transição nenhuma disponível, em nenhum estado", () => {
  // Quem constrói ENTREGA setor (outra ação); mover o ciclo é do admin.
  for (const estado of ESTADOS) {
    for (const papel of ["construtor", "construtor_amplo"] as const) {
      assert.deepEqual(transicoesDisponiveis(estado, papel), [], `${papel} em ${estado}`);
    }
  }
});

test("reabrir existe só a partir de concluído/publicado", () => {
  assert.ok(aplicarTransicao("concluido", "reabrir", "admin").ok);
  assert.ok(aplicarTransicao("publicado", "reabrir", "admin").ok);
  assert.ok(!aplicarTransicao("em_construcao", "reabrir", "admin").ok);
});

// ─── Rodada ──────────────────────────────────────────────────────────────────

test("só enviar e reenviar incrementam a rodada", () => {
  assert.equal(incrementaRodada("enviar_validacao"), true);
  assert.equal(incrementaRodada("reenviar"), true);
  for (const t of ["concluir_validacao", "concluir", "publicar", "reabrir"] as const) {
    assert.equal(incrementaRodada(t), false, t);
  }
});

// ─── Versões congeladas ──────────────────────────────────────────────────────

test("o 1º envio congela 'construcao'; um envio posterior, 'validacao'", () => {
  // A ponta esquerda do comparativo é o que os construtores montaram — só o
  // primeiro envio. Reenvio já passou pela diretoria.
  assert.equal(versaoDaTransicao("enviar_validacao", 0), "construcao");
  assert.equal(versaoDaTransicao("enviar_validacao", 1), "validacao");
  assert.equal(versaoDaTransicao("reenviar", 1), "validacao");
});

test("concluir congela a versão 'final' — a ponta direita do comparativo", () => {
  assert.equal(versaoDaTransicao("concluir", 2), "final");
});

test("publicar e reabrir não congelam versão", () => {
  // Publicar usa a 'final' que já existe; publicar duas vezes não muda registro.
  assert.equal(versaoDaTransicao("publicar", 1), null);
  assert.equal(versaoDaTransicao("reabrir", 1), null);
  assert.equal(versaoDaTransicao("concluir_validacao", 1), null);
});

// ─── A trava de escrita ──────────────────────────────────────────────────────

test("admin escreve em qualquer estado", () => {
  for (const estado of ESTADOS) {
    assert.ok(podeEscreverNaFase(estado, "admin").pode, estado);
  }
});

test("em validação o construtor fica SOMENTE LEITURA", () => {
  for (const papel of ["construtor", "construtor_amplo"] as const) {
    const r = podeEscreverNaFase("em_validacao", papel);
    assert.equal(r.pode, false, papel);
    assert.match(r.motivo ?? "", /somente leitura/i);
  }
});

test("em validação o validador escreve; em construção e em ajuste, não", () => {
  assert.ok(podeEscreverNaFase("em_validacao", "validador").pode);
  assert.equal(podeEscreverNaFase("em_construcao", "validador").pode, false);
  assert.equal(podeEscreverNaFase("em_ajuste", "validador").pode, false);
});

test("no retorno (ajuste) os construtores voltam a escrever", () => {
  for (const papel of ["construtor", "construtor_amplo"] as const) {
    assert.ok(podeEscreverNaFase("em_ajuste", papel).pode, papel);
  }
});

test("concluído e publicado não aceitam escrita de ninguém além do admin", () => {
  for (const estado of ["concluido", "publicado"] as const) {
    for (const papel of ["construtor", "construtor_amplo", "validador"] as const) {
      const r = podeEscreverNaFase(estado, papel);
      assert.equal(r.pode, false, `${papel} em ${estado}`);
      assert.ok((r.motivo ?? "").length > 0, "a recusa explica o motivo");
    }
  }
});

test("entregar setor só faz sentido enquanto se constrói", () => {
  assert.ok(podeEntregarSetor("em_construcao"));
  assert.ok(podeEntregarSetor("em_ajuste"));
  assert.ok(!podeEntregarSetor("em_validacao"));
  assert.ok(!podeEntregarSetor("concluido"));
  assert.ok(!podeEntregarSetor("publicado"));
});
