// A contagem da faixa da prévia do setor, recortada no método da tela.
//
// Dois erros são possíveis aqui e os dois já aconteceram de verdade: contar o
// mesmo colaborador uma vez por linha da DRE (salário, encargos, benefícios…),
// e contar os OUTROS métodos do setor como se fossem da tela aberta. É isso que
// estes testes travam.

import test from "node:test";
import assert from "node:assert/strict";

import { contarPorMetodo, ROTULO_POR_METODO, sufixo } from "./previa-setor-contagem";
import type { PreviaSetorCategoria } from "./actions/planejamento-categoria";
import type { ValidacaoEstado } from "./validacao-diretoria";

function item(alvoId: string, estado: ValidacaoEstado = "pendente", alvoTipo = "colaborador") {
  return {
    nome: alvoId,
    detalhe: null,
    total: 100,
    alvoTipo: alvoTipo as PreviaSetorCategoria["grupos"][number]["itens"][number]["alvoTipo"],
    alvoId,
    setorId: "s1",
    estado,
    comentario: null,
  };
}

function categoria(
  nome: string,
  metodo: string,
  itens: ReturnType<typeof item>[],
): PreviaSetorCategoria {
  return {
    categoria: nome,
    metodo,
    metodoLabel: metodo,
    total: 0,
    totalAprovado: 0,
    atual: false,
    grupos: [{ nome: "Sem grupo", grupoId: null, total: 0, totalAprovado: 0, itens }],
  };
}

/** O caso real: a pessoa em 3 linhas da folha + outros métodos no mesmo setor. */
function setorBase(): PreviaSetorCategoria[] {
  return [
    categoria("Salários", "pessoal", [item("ana", "aprovado"), item("bia"), item("caio")]),
    categoria("Encargos", "pessoal", [item("ana", "aprovado"), item("bia"), item("caio")]),
    categoria("Benefícios", "pessoal", [item("ana", "aprovado"), item("bia")]),
    categoria("Marketing", "planejamento_socios", [
      item("d1", "aprovado", "planejamento_item"),
      item("d2", "aprovado", "planejamento_item"),
      item("d3", "reprovado", "planejamento_item"),
    ]),
    categoria("Água", "media", [item("m1", "aprovado", "media_linha")]),
  ];
}

test("o pessoal conta PESSOAS, não linhas da DRE", () => {
  const c = contarPorMetodo(setorBase(), "pessoal");
  assert.equal(c.total, 3); // ana, bia, caio
  assert.equal(c.aprovados, 1);
  assert.equal(c.pendentes, 2);
});

test("o pessoal NÃO conta planejamento, média nem valor fixo", () => {
  // Era o defeito: a faixa mostrava "10 aprovadas" somando 3 colaboradores
  // com 7 despesas do Planejamento.
  const c = contarPorMetodo(setorBase(), "pessoal");
  assert.equal(c.aprovados, 1, "os 3 aprovados dos outros métodos não entram");
  assert.equal(c.reprovados, 0, "o reprovado do Planejamento não entra");
});

test("sem método, conta o setor inteiro — ainda sem repetir alvo", () => {
  const c = contarPorMetodo(setorBase());
  assert.equal(c.total, 7); // 3 pessoas + 3 despesas + 1 média
  assert.equal(c.aprovados, 4); // ana + d1 + d2 + m1
  assert.equal(c.reprovados, 1);
});

test("cada método vê só o que é seu", () => {
  const cats = setorBase();
  assert.equal(contarPorMetodo(cats, "planejamento_socios").total, 3);
  assert.equal(contarPorMetodo(cats, "media").total, 1);
  assert.equal(contarPorMetodo(cats, "valor_fixo").total, 0);
});

test("item sem alvo não é decidível e não entra na contagem", () => {
  const cats = [
    categoria("Água", "media", [
      { ...item("x"), alvoTipo: undefined, alvoId: undefined },
      item("y"),
    ] as ReturnType<typeof item>[]),
  ];
  assert.equal(contarPorMetodo(cats, "media").total, 1);
});

test("mesmo id em tipos diferentes são alvos diferentes", () => {
  const cats = [
    categoria("Salários", "pessoal", [item("x")]),
    categoria("Marketing", "planejamento_socios", [item("x", "pendente", "planejamento_item")]),
  ];
  assert.equal(contarPorMetodo(cats).total, 2);
});

test("setor sem nada devolve zeros", () => {
  const c = contarPorMetodo([], "pessoal");
  assert.deepEqual(c, { pendentes: 0, aprovados: 0, reprovados: 0, revisar: 0, total: 0 });
});

test("o particípio concorda com o substantivo do método", () => {
  assert.equal(`aprovad${sufixo(ROTULO_POR_METODO.pessoal)}`, "aprovados"); // colaboradores
  assert.equal(`aprovad${sufixo(ROTULO_POR_METODO.planejamento_socios)}`, "aprovadas"); // despesas
  assert.equal(`aprovad${sufixo(undefined)}`, "aprovadas"); // sem recorte: "despesas" implícito
});
