// Regras da validação pela diretoria: gate por campo, trava e cancelamento.

import test from "node:test";
import assert from "node:assert/strict";

import {
  camposPermitidosLabel,
  camposRecusadosParaDiretoria,
  itemPropostaAtivo,
  marcarItemProposta,
  podeCancelarNoMetodo,
  podeEscreverNoItem,
} from "./validacao";

// ─── Gate por campo ──────────────────────────────────────────────────────────

test("em média a diretoria só troca o índice", () => {
  assert.deepEqual(camposRecusadosParaDiretoria("media", ["indice_key"]), []);
  assert.deepEqual(camposRecusadosParaDiretoria("media", ["media_valor"]), ["media_valor"]);
  assert.deepEqual(
    camposRecusadosParaDiretoria("media", ["indice_key", "media_valor", "manual"]),
    ["media_valor", "manual"],
  );
});

test("em valor fixo a diretoria troca índice e mês de reajuste", () => {
  assert.deepEqual(camposRecusadosParaDiretoria("valor_fixo", ["indice_key", "mes_reajuste"]), []);
  assert.deepEqual(camposRecusadosParaDiretoria("valor_fixo", ["valor_base"]), ["valor_base"]);
  assert.deepEqual(camposRecusadosParaDiretoria("valor_fixo", ["descricao"]), ["descricao"]);
});

test("em pessoal e planejamento a diretoria altera qualquer campo", () => {
  for (const m of ["pessoal", "planejamento_socios"] as const) {
    assert.deepEqual(camposRecusadosParaDiretoria(m, ["salario_atual", "cargo_atual"]), [], m);
  }
});

test("a mensagem de recusa diz o que ele PODE fazer", () => {
  assert.match(camposPermitidosLabel("media"), /índice/);
  assert.match(camposPermitidosLabel("valor_fixo"), /índice.*mês|mês.*índice/);
  assert.equal(camposPermitidosLabel("pessoal"), "todos");
});

test("cancelar existe só onde o item é escolha do gestor", () => {
  assert.equal(podeCancelarNoMetodo("pessoal"), true);
  assert.equal(podeCancelarNoMetodo("planejamento_socios"), true);
  assert.equal(podeCancelarNoMetodo("media"), false);
  assert.equal(podeCancelarNoMetodo("valor_fixo"), false);
});

// ─── A trava ─────────────────────────────────────────────────────────────────

test("item travado bloqueia o construtor, com instrução do que fazer", () => {
  for (const papel of ["construtor", "construtor_amplo"] as const) {
    const r = podeEscreverNoItem(papel, { diretoria_travado: true });
    assert.equal(r.pode, false, papel);
    assert.match(r.motivo ?? "", /Pedir libera/);
  }
});

test("item NÃO travado é do construtor", () => {
  assert.ok(podeEscreverNoItem("construtor", { diretoria_travado: false }).pode);
  assert.ok(podeEscreverNoItem("construtor", {}).pode);
  assert.ok(podeEscreverNoItem("construtor", null).pode);
});

test("a trava não alcança quem travou nem o admin", () => {
  assert.ok(podeEscreverNoItem("validador", { diretoria_travado: true }).pode);
  assert.ok(podeEscreverNoItem("admin", { diretoria_travado: true }).pode);
});

// ─── Item cancelado na proposta (jsonb) ──────────────────────────────────────

test("item sem marca é ativo; com cancelado=true, não", () => {
  assert.equal(itemPropostaAtivo({}), true);
  assert.equal(itemPropostaAtivo({ cancelado: false }), true);
  assert.equal(itemPropostaAtivo(null), true);
  assert.equal(itemPropostaAtivo({ cancelado: true }), false);
});

test("marcar cancela só o item do índice, preservando os demais", () => {
  const itens = [
    { descricao: "Google Ads", valorMensal: 1000 },
    { descricao: "Trello", valorMensal: 200 },
  ];
  const r = marcarItemProposta(itens, 1, "Trello", {
    cancelado: true,
    motivo: "não renovar",
    por: "u1",
  });
  assert.equal(r.error, undefined);
  assert.equal(r.itens[0].cancelado, undefined, "o outro item fica intacto");
  assert.equal(r.itens[1].cancelado, true);
  assert.equal(r.itens[1].cancelado_motivo, "não renovar");
  assert.equal(r.itens[1].valorMensal, 200, "o valor não é perdido — cancelar é marca");
});

test("descrição divergente RECUSA em vez de cancelar o item errado", () => {
  // A trava contra corrida: a lista mudou desde que a tela carregou.
  const itens = [{ descricao: "Google Ads" }, { descricao: "Trello" }];
  const r = marcarItemProposta(itens, 1, "Google Analytics", { cancelado: true });
  assert.match(r.error ?? "", /mudou desde/);
  assert.equal(r.itens[1].cancelado, undefined, "nada foi marcado");
});

test("índice fora da lista recusa", () => {
  const r = marcarItemProposta([{ descricao: "A" }], 5, "A", { cancelado: true });
  assert.match(r.error ?? "", /não encontrado/i);
});

test("reativar remove as marcas, devolvendo o item original", () => {
  const cancelado = [
    { descricao: "Trello", valorMensal: 200, cancelado: true, cancelado_motivo: "x", cancelado_por: "u1" },
  ];
  const r = marcarItemProposta(cancelado, 0, "Trello", { cancelado: false });
  assert.equal(r.error, undefined);
  assert.deepEqual(r.itens[0], { descricao: "Trello", valorMensal: 200 });
});
