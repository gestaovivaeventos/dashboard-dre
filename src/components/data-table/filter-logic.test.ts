import test from "node:test";
import assert from "node:assert/strict";

import {
  allShownSelected,
  materialize,
  noneShownSelected,
  normalize,
  passesValueFilter,
  setAllShown,
  toggleValue,
} from "./filter-logic";

const TODOS = ["Conta corrente", "Caixa físico", "Aplicação", "Cartão de crédito"];

/** Set → array ordenado. Array.from (não spread) por causa do target do tsconfig. */
function sorted(set: Set<string> | null): string[] {
  assert.notEqual(set, null, "esperava um conjunto, veio 'sem filtro'");
  return Array.from(set as Set<string>).sort();
}

test("sem filtro deixa tudo passar", () => {
  assert.equal(passesValueFilter("Aplicação", null), true);
  assert.equal(passesValueFilter("Aplicação", undefined), true);
});

test("Set VAZIO não deixa nada passar — é diferente de sem filtro", () => {
  // O bug que isto tranca: tratar vazio como "sem filtro" faz o primeiro
  // clique em "(Selecionar tudo)" não mudar nada na tela.
  assert.equal(passesValueFilter("Aplicação", new Set()), false);
});

test("Set com itens passa só os escolhidos", () => {
  const set = new Set(["Conta corrente", "Caixa físico"]);
  assert.equal(passesValueFilter("Conta corrente", set), true);
  assert.equal(passesValueFilter("Aplicação", set), false);
});

test("desmarcar um valor partindo de 'sem filtro' marca todos os outros", () => {
  assert.deepEqual(sorted(toggleValue(null, "Aplicação", TODOS)), [
    "Caixa físico",
    "Cartão de crédito",
    "Conta corrente",
  ]);
});

test("remarcar o último valor volta a 'sem filtro' (o chip some)", () => {
  const semAplicacao = toggleValue(null, "Aplicação", TODOS);
  assert.equal(toggleValue(semAplicacao, "Aplicação", TODOS), null);
});

test("'Desmarcar todos' esvazia e a tabela fica vazia", () => {
  const next = setAllShown(null, TODOS, TODOS, false);
  assert.notEqual(next, null, "esvaziar não pode virar 'sem filtro'");
  assert.equal((next as Set<string>).size, 0);
});

test("'Marcar todos' com tudo desmarcado volta a 'sem filtro'", () => {
  assert.equal(setAllShown(new Set(), TODOS, TODOS, true), null);
});

test("'Marcar todos' opera só sobre o resultado da busca", () => {
  // Usuário buscou "ca" e marcou tudo que apareceu, partindo do vazio.
  const busca = ["Caixa físico", "Cartão de crédito"];
  assert.deepEqual(sorted(setAllShown(new Set(), busca, TODOS, true)), [
    "Caixa físico",
    "Cartão de crédito",
  ]);
});

test("'Desmarcar todos' tira só o que a busca mostra, preservando o resto", () => {
  const atual = new Set(["Conta corrente", "Caixa físico", "Aplicação"]);
  assert.deepEqual(sorted(setAllShown(atual, ["Caixa físico"], TODOS, false)), [
    "Aplicação",
    "Conta corrente",
  ]);
});

test("estado dos botões: marcado/desmarcado", () => {
  assert.equal(noneShownSelected(new Set(), TODOS), true);
  assert.equal(noneShownSelected(null, TODOS), false, "sem filtro = tudo marcado");
  assert.equal(noneShownSelected(new Set(["Caixa físico"]), ["Aplicação"]), true);
  assert.equal(noneShownSelected(null, []), false, "busca sem resultado não conta");
});

test("estado da caixa '(Selecionar tudo)'", () => {
  assert.equal(allShownSelected(null, TODOS), true, "sem filtro = todos marcados");
  assert.equal(allShownSelected(new Set(), TODOS), false);
  assert.equal(allShownSelected(new Set(["Caixa físico"]), ["Caixa físico"]), true);
  assert.equal(allShownSelected(new Set(["Caixa físico"]), TODOS), false);
  assert.equal(allShownSelected(null, []), false, "busca sem resultado não fica marcada");
});

test("materialize trata 'sem filtro' como todos marcados", () => {
  assert.deepEqual(Array.from(materialize(null, TODOS)).sort(), Array.from(TODOS).sort());
  assert.deepEqual(Array.from(materialize(new Set(["Aplicação"]), TODOS)), ["Aplicação"]);
});

test("normalize devolve null só quando tudo está marcado", () => {
  assert.equal(normalize(new Set(TODOS), TODOS), null);
  assert.notEqual(normalize(new Set(["Aplicação"]), TODOS), null);
  assert.notEqual(normalize(new Set(), TODOS), null);
});

test("desmarcar um a um até zerar NUNCA volta a 'tudo marcado'", () => {
  // Cenário do seletor de empresas do Caixa: quem tira a última da lista quis
  // ficar sem nenhuma. Voltar para "todas" aqui faria a próxima varredura
  // rodar nas 26 empresas em vez de parar — o oposto do clique.
  const empresas = ["ABD", "Terrazzo", "Feat"];
  let atual: Set<string> | null = null;
  for (const e of empresas) atual = toggleValue(atual, e, empresas);
  assert.notEqual(atual, null, "zerar não pode ser lido como 'todas'");
  assert.equal((atual as Set<string>).size, 0);
});

test("o filtro padrão do Caixa sobrevive a marcar e desmarcar um tipo", () => {
  // Cenário real da tela: abre com os 3 tipos líquidos marcados; o usuário
  // adiciona Aplicação para ver o total com investimentos e depois tira.
  const padrao = ["Conta corrente", "Caixa físico", "Conta de pagamento"];
  const todos = padrao.concat(["Aplicação", "Cartão de crédito"]);
  const comAplicacao = toggleValue(new Set(padrao), "Aplicação", todos);
  assert.equal((comAplicacao as Set<string>).has("Aplicação"), true);
  assert.deepEqual(sorted(toggleValue(comAplicacao, "Aplicação", todos)), padrao.slice().sort());
});
