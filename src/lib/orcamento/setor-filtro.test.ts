// Semântica do filtro de setor e o agrupamento da visão "Todos os setores".
//
// Os três estados (quadro único, consolidado e um setor) convivem, e o `null`
// do banco só cobre um deles — é por isso que existe o sentinela.

import test from "node:test";
import assert from "node:assert/strict";

import {
  SEM_SETOR_LABEL,
  SETOR_TODOS,
  agruparPorSetor,
  isTodosSetores,
  setorEspecifico,
} from "./setor-filtro";

test("o sentinela distingue consolidado de quadro único", () => {
  assert.equal(isTodosSetores(SETOR_TODOS), true);
  assert.equal(isTodosSetores(null), false, "quadro único NÃO é consolidado");
  assert.equal(isTodosSetores("s1"), false);
});

test("setorEspecifico devolve null no consolidado e no quadro único", () => {
  assert.equal(setorEspecifico(SETOR_TODOS), null);
  assert.equal(setorEspecifico(null), null);
  assert.equal(setorEspecifico("s1"), "s1");
});

// ─── Agrupamento ─────────────────────────────────────────────────────────────

const setores = [
  { id: "s1", name: "Marketing" },
  { id: "s2", name: "Administrativo" },
];
const p = (id: string, setorId: string | null) => ({ id, setorId });

test("agrupa por setor em ordem alfabética", () => {
  const r = agruparPorSetor([p("a", "s1"), p("b", "s2")], setores);
  assert.deepEqual(r.map((g) => g.nome), ["Administrativo", "Marketing"]);
});

test("'Sem setor' vai por último, não na letra S", () => {
  const r = agruparPorSetor([p("a", null), p("b", "s1")], setores);
  assert.deepEqual(r.map((g) => g.nome), ["Marketing", SEM_SETOR_LABEL]);
});

test("mantém junto quem está no mesmo setor, na ordem de entrada", () => {
  const r = agruparPorSetor([p("a", "s1"), p("b", "s2"), p("c", "s1")], setores);
  const marketing = r.find((g) => g.setorId === "s1");
  assert.deepEqual(marketing?.itens.map((i) => i.id), ["a", "c"]);
});

test("setor fora do cadastro não some da tela", () => {
  // Setor inativado depois de alguém ser alocado nele: descartar as linhas
  // faria o consolidado mostrar menos gente do que existe, sem avisar.
  const r = agruparPorSetor([p("a", "s9")], setores);
  assert.equal(r.length, 1);
  assert.equal(r[0].setorId, "s9");
  assert.match(r[0].nome, /sem cadastro/i);
});

test("lista vazia devolve nenhum grupo", () => {
  assert.deepEqual(agruparPorSetor([], setores), []);
});
