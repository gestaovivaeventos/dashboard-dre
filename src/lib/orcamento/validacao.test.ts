// Regras da validação pela diretoria: gate por campo, trava e cancelamento.

import test from "node:test";
import assert from "node:assert/strict";

import {
  camposPermitidosLabel,
  camposRecusadosParaDiretoria,
  chaveDoAlvo,
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

// ─── Chave do alvo (o visto linha a linha) ────────────────────────────

test("a chave usa o id em todos os métodos, inclusive no planejamento", () => {
  // O planejamento usava `categoria:setor:descrição` enquanto o item vivia num
  // jsonb sem id. Agora é linha de tabela: a chave é o id, como nos outros.
  assert.equal(chaveDoAlvo("planejamento_socios", { id: "d1" }), "ps:d1");
  assert.equal(chaveDoAlvo("pessoal", { id: "c1" }), "colab:c1");
  assert.equal(chaveDoAlvo("media", { id: "m1" }), "media:m1");
  assert.equal(chaveDoAlvo("valor_fixo", { id: "v1" }), "vf:v1");
});

test("a chave do planejamento ignora descri\u00e7\u00e3o e setor", () => {
  // Renomear a despesa ou mov\u00ea-la de setor n\u00e3o pode fazer o visto pular de item.
  const a = chaveDoAlvo("planejamento_socios", { id: "d1", descricao: "Figma", setorId: "s1" });
  const b = chaveDoAlvo("planejamento_socios", { id: "d1", descricao: "Figma Pro", setorId: "s2" });
  assert.equal(a, b);
});

test("ids diferentes nunca colidem", () => {
  assert.notEqual(
    chaveDoAlvo("planejamento_socios", { id: "d1" }),
    chaveDoAlvo("planejamento_socios", { id: "d2" }),
  );
});
