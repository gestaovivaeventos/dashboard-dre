// Grupos de despesa: a ordem que as três telas (cadastro, montagem, Prévia)
// precisam compartilhar, e a normalização que impede grupo duplicado.

import test from "node:test";
import assert from "node:assert/strict";

import {
  SEM_GRUPO_LABEL,
  agruparPorGrupo,
  compararNomes,
  grupoTemEscopo,
  gruposDisponiveis,
  normalizarNomeGrupo,
} from "./grupos";

const item = (grupoId: string | null, grupoNome: string | null, nome: string) => ({
  grupoId,
  grupoNome,
  nome,
});

test("ordena alfabeticamente ignorando acento e caixa", () => {
  const grupos = agruparPorGrupo([
    item("c", "Ônibus", "x"),
    item("a", "água", "y"),
    item("b", "Design", "z"),
  ]);
  assert.deepEqual(
    grupos.map((g) => g.nome),
    ["água", "Design", "Ônibus"],
  );
});

test("o balde 'Sem grupo' vai por último, não na letra S", () => {
  const grupos = agruparPorGrupo([
    item(null, null, "sem dono"),
    item("t", "Treinamento", "curso"),
    item("a", "Assinaturas", "figma"),
  ]);
  assert.deepEqual(
    grupos.map((g) => g.nome),
    ["Assinaturas", "Treinamento", SEM_GRUPO_LABEL],
  );
});

test("agrupa por id, não por nome", () => {
  // Dois grupos distintos que foram renomeados para o mesmo texto continuam
  // separados — o que a despesa aponta é o id.
  const grupos = agruparPorGrupo([
    item("a", "Mídia", "google"),
    item("b", "Mídia", "meta"),
    item("a", "Mídia", "linkedin"),
  ]);
  assert.equal(grupos.length, 2);
  assert.deepEqual(
    grupos.find((g) => g.grupoId === "a")?.itens.map((i) => i.nome),
    ["google", "linkedin"],
  );
});

test("grupo com nome vazio não vira 'Sem grupo' silencioso", () => {
  // Nome em branco com id preenchido é dado estranho, mas o item continua
  // pertencendo àquele grupo — o balde é só para grupoId nulo.
  const grupos = agruparPorGrupo([item("a", "   ", "x"), item(null, null, "y")]);
  assert.equal(grupos.length, 2);
  assert.equal(grupos[0].grupoId, "a");
  assert.equal(grupos[1].grupoId, null);
});

test("preserva a ordem de entrada dentro do grupo", () => {
  const grupos = agruparPorGrupo([
    item("a", "Assinaturas", "figma"),
    item("a", "Assinaturas", "adobe"),
  ]);
  assert.deepEqual(grupos[0].itens.map((i) => i.nome), ["figma", "adobe"]);
});

test("normaliza espaço para o índice único não deixar passar duplicata", () => {
  assert.equal(normalizarNomeGrupo("  Design  "), "Design");
  assert.equal(normalizarNomeGrupo("Mídia   paga"), "Mídia paga");
  assert.equal(normalizarNomeGrupo(""), "");
});

test("compararNomes é estável para nomes iguais a menos de acento", () => {
  assert.equal(compararNomes("agua", "água"), 0);
});

// ─── Escopo por setor × categoria ────────────────────────────────────────────

const g = (id: string) => ({ id, name: id });
const esc = (grupoId: string, setorId: string | null, categoryCode: string) => ({
  grupoId,
  setorId,
  categoryCode,
});

test("grupo SEM escopo vale em todo lugar", () => {
  // É o que torna a introdução do escopo aditiva: nada do que já existia some.
  const r = gruposDisponiveis([g("a")], [], { categoryCode: "2.01", setorIds: ["s1"] });
  assert.deepEqual(r.map((x) => x.id), ["a"]);
});

test("grupo com escopo só aparece na categoria dele", () => {
  const escopos = [esc("a", "s1", "2.01")];
  assert.equal(
    gruposDisponiveis([g("a")], escopos, { categoryCode: "2.01", setorIds: ["s1"] }).length,
    1,
  );
  assert.equal(
    gruposDisponiveis([g("a")], escopos, { categoryCode: "2.02", setorIds: ["s1"] }).length,
    0,
  );
});

test("grupo preso a um setor não vaza para outro", () => {
  const escopos = [esc("a", "s1", "2.01")];
  assert.equal(
    gruposDisponiveis([g("a")], escopos, { categoryCode: "2.01", setorIds: ["s2"] }).length,
    0,
  );
});

test("vários setores compilam: é a UNIÃO, e o grupo continua um só", () => {
  // O pedido do dono do projeto: olhando todos os setores, aparecem os grupos
  // de todos, compilados. Como o grupo é UM id usado em vários escopos, ele
  // aparece uma vez — não uma por setor.
  const escopos = [esc("a", "s1", "2.01"), esc("a", "s2", "2.01"), esc("b", "s2", "2.01")];
  const r = gruposDisponiveis([g("a"), g("b")], escopos, {
    categoryCode: "2.01",
    setorIds: ["s1", "s2"],
  });
  assert.deepEqual(r.map((x) => x.id), ["a", "b"]);
  assert.equal(r.filter((x) => x.id === "a").length, 1, "sem repetir por setor");
});

test("escopo sem setor vale para qualquer setor daquela categoria", () => {
  const escopos = [esc("a", null, "2.01")];
  for (const setor of ["s1", "s9", null]) {
    assert.equal(
      gruposDisponiveis([g("a")], escopos, { categoryCode: "2.01", setorIds: [setor] }).length,
      1,
      String(setor),
    );
  }
});

test("empresa sem setor casa com escopo sem setor, não com escopo de setor", () => {
  assert.equal(
    gruposDisponiveis([g("a")], [esc("a", "s1", "2.01")], {
      categoryCode: "2.01",
      setorIds: [null],
    }).length,
    0,
  );
});

test("um escopo basta: o grupo aparece se QUALQUER um casar", () => {
  const escopos = [esc("a", "s1", "2.09"), esc("a", "s2", "2.01")];
  assert.equal(
    gruposDisponiveis([g("a")], escopos, { categoryCode: "2.01", setorIds: ["s2"] }).length,
    1,
  );
});

test("grupoTemEscopo distingue o amplo do restrito", () => {
  assert.equal(grupoTemEscopo([esc("a", "s1", "2.01")], "a"), true);
  assert.equal(grupoTemEscopo([esc("a", "s1", "2.01")], "b"), false);
});
