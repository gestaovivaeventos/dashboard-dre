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
  validadorEscreveEmTudo,
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

test("o fluxo completo anda: construção → validação → ajuste → publicado", () => {
  // "Concluir" já publica: eram dois botões para um ato só.
  let estado: CicloEstado = "em_construcao";
  for (const [transicao, esperado] of [
    ["enviar_validacao", "em_validacao"],
    ["concluir_validacao", "em_ajuste"],
    ["concluir", "publicado"],
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

test("voltar para edição vale de qualquer estado, menos do próprio", () => {
  // É a válvula do administrador: envio por engano, decisão revista. Sem ela um
  // clique errado em "Enviar" só se desfazia no banco.
  for (const de of ["em_validacao", "em_ajuste", "concluido", "publicado"] as const) {
    const r = aplicarTransicao(de, "reabrir", "admin");
    assert.ok(r.ok, de);
    assert.equal(r.estado, "em_construcao");
  }
  assert.ok(!aplicarTransicao("em_construcao", "reabrir", "admin").ok);
  assert.ok(!aplicarTransicao("em_validacao", "reabrir", "validador").ok, "só admin");
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

test("em construção TODO MUNDO monta — inclusive a diretoria", () => {
  // O diretor também tem setor próprio (Diretoria). O que separa os papéis na
  // construção não é poder escrever, é ONDE (o escopo de setor).
  for (const papel of ["construtor", "construtor_amplo", "validador", "admin"] as const) {
    assert.ok(podeEscreverNaFase("em_construcao", papel).pode, papel);
  }
});

test("o validador só decide sobre a empresa inteira DURANTE a validação", () => {
  assert.equal(validadorEscreveEmTudo("em_validacao"), true);
  for (const e of ["em_construcao", "em_ajuste", "concluido", "publicado"] as const) {
    assert.equal(validadorEscreveEmTudo(e), false, e);
  }
});

test("em validação o construtor fica SOMENTE LEITURA", () => {
  for (const papel of ["construtor", "construtor_amplo"] as const) {
    const r = podeEscreverNaFase("em_validacao", papel);
    assert.equal(r.pode, false, papel);
    assert.match(r.motivo ?? "", /somente leitura/i);
  }
});

test("o validador escreve na validação, na construção e no ajuste", () => {
  // Fora da validação ele é construtor do setor dele — e no retorno ajusta o
  // que ele mesmo pediu no próprio setor.
  for (const e of ["em_validacao", "em_construcao", "em_ajuste"] as const) {
    assert.ok(podeEscreverNaFase(e, "validador").pode, e);
  }
});

test("no retorno (ajuste) os construtores voltam a escrever", () => {
  for (const papel of ["construtor", "construtor_amplo"] as const) {
    assert.ok(podeEscreverNaFase("em_ajuste", papel).pode, papel);
  }
});

test("a versão final sai do concluir, que também publica", () => {
  assert.equal(versaoDaTransicao("concluir", 2), "final");
  assert.equal(versaoDaTransicao("publicar", 2), null, "publicar é só rede de segurança");
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
