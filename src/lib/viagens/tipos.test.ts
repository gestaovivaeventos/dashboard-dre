// Tipo de viagem × categoria da DRE.
//
// Os dois defeitos silenciosos que estes testes impedem:
//
//  1. oferecer um tipo SEM categoria mapeada — a viagem seria orçada e não
//     entraria em conta nenhuma da DRE, saindo da Prévia como órfã;
//  2. deixar invisível que remapear um tipo NÃO reclassifica o que já foi
//     orçado. A categoria é um retrato (tem de ser: a `source` da finalização a
//     inclui), e `desalinhadas` é o que obriga a tela a dizer isso.

import test from "node:test";
import assert from "node:assert/strict";

import {
  categoriaDoTipo,
  categoriasDoDePara,
  desalinhadas,
  ordenarTipos,
  tiposForaDoMetodo,
  tiposOferecidos,
  tiposSemCategoria,
  type TipoViagem,
} from "./tipos";

const TIPOS: TipoViagem[] = [
  { id: "t1", nome: "Treinamento", categoryCode: "2.01.98", ativo: true },
  { id: "t2", nome: "Consultoria", categoryCode: "2.01.91", ativo: true },
  { id: "t3", nome: "Visita a cliente", categoryCode: null, ativo: true },
  { id: "t4", nome: "Evento (descontinuado)", categoryCode: "2.01.94", ativo: false },
];

test("tipo SEM categoria mapeada NÃO é oferecido no cadastro da viagem", () => {
  // É a regra principal: uma viagem com tipo não mapeado não cai em conta nenhuma
  // da DRE, e quem a cadastrou não teria como descobrir por quê.
  const oferecidos = tiposOferecidos(TIPOS).map((t) => t.nome);
  assert.equal(oferecidos.includes("Visita a cliente"), false);
});

test("tipo INATIVO não é oferecido — desativar é para parar de oferecer", () => {
  assert.equal(
    tiposOferecidos(TIPOS).some((t) => t.id === "t4"),
    false,
  );
});

test("os oferecidos vêm em ordem alfabética pt-BR", () => {
  assert.deepEqual(tiposOferecidos(TIPOS).map((t) => t.nome), ["Consultoria", "Treinamento"]);
});

test("a ordenação respeita acento do português", () => {
  const nomes = ordenarTipos([
    { nome: "Évento" },
    { nome: "Auditoria" },
    { nome: "Implantação" },
  ]).map((t) => t.nome);
  assert.deepEqual(nomes, ["Auditoria", "Évento", "Implantação"]);
});

test("categoriaDoTipo resolve, e não chuta", () => {
  assert.equal(categoriaDoTipo(TIPOS, "t1"), "2.01.98");
  assert.equal(categoriaDoTipo(TIPOS, "t3"), null, "tipo sem mapeamento");
  assert.equal(categoriaDoTipo(TIPOS, "inexistente"), null);
  assert.equal(categoriaDoTipo(TIPOS, null), null);
  assert.equal(categoriaDoTipo(TIPOS, ""), null);
});

test("tiposSemCategoria alimenta o aviso do de-para", () => {
  // Estado legítimo (cadastra o vocabulário, mapeia depois) com consequência:
  // sem o aviso o admin concluiria que a tela de viagens quebrou.
  assert.deepEqual(tiposSemCategoria(TIPOS).map((t) => t.id), ["t3"]);
  // Inativo sem categoria não entra: ele não seria oferecido de todo modo.
  assert.deepEqual(
    tiposSemCategoria([{ id: "x", nome: "X", categoryCode: null, ativo: false }]),
    [],
  );
});

// ─── Remapear não reclassifica o que já foi orçado ──────────────────────────

const VIAGENS = [
  { id: "v1", titulo: "Curitiba", tipoId: "t1", categoryCode: "2.01.98" },
  { id: "v2", titulo: "Floripa", tipoId: "t1", categoryCode: "2.01.70" },
  { id: "v3", titulo: "Rascunho", tipoId: "t1", categoryCode: null },
  { id: "v4", titulo: "Sem tipo", tipoId: null, categoryCode: "2.01.98" },
];

test("desalinhada é a viagem cujo retrato não é mais o de-para de hoje", () => {
  const d = desalinhadas(VIAGENS, TIPOS);
  assert.deepEqual(d.map((x) => x.id), ["v2"]);
  assert.equal(d[0].categoriaDaViagem, "2.01.70");
  assert.equal(d[0].categoriaDoTipo, "2.01.98");
  assert.equal(d[0].tipoNome, "Treinamento");
});

test("viagem SEM categoria gravada não está desalinhada — está incompleta", () => {
  assert.equal(
    desalinhadas(VIAGENS, TIPOS).some((x) => x.id === "v3"),
    false,
  );
});

test("viagem sem tipo fica fora da conta", () => {
  assert.equal(
    desalinhadas(VIAGENS, TIPOS).some((x) => x.id === "v4"),
    false,
  );
});

test("tipo APAGADO do cadastro não torna a viagem desalinhada", () => {
  // Não há de-para novo com que comparar; a viagem conserva a categoria dela.
  const d = desalinhadas([{ id: "v9", titulo: "Z", tipoId: "sumiu", categoryCode: "2.01.98" }], TIPOS);
  assert.deepEqual(d, []);
});

test("tipo que PERDEU o mapeamento não torna a viagem desalinhada", () => {
  // Desmapear não é remapear: não existe categoria nova para onde ela deveria ir.
  const d = desalinhadas([{ id: "v9", titulo: "Z", tipoId: "t3", categoryCode: "2.01.98" }], TIPOS);
  assert.deepEqual(d, []);
});

test("nada desalinhado devolve lista vazia, não undefined", () => {
  assert.deepEqual(desalinhadas([], TIPOS), []);
  assert.deepEqual(desalinhadas(VIAGENS, []), []);
});

// ─── A ponte com "Método por categoria" ─────────────────────────────────────

test("categoriasDoDePara lista só as dos tipos ATIVOS, sem repetir", () => {
  const cats = categoriasDoDePara([
    ...TIPOS,
    { id: "t5", nome: "Outro treinamento", categoryCode: "2.01.98", ativo: true },
  ]);
  assert.deepEqual(cats, ["2.01.91", "2.01.98"], "a inativa 2.01.94 fica fora, e não há repetida");
});

test("tipo apontando para categoria NÃO orçada por Viagens é acusado", () => {
  // Os dois cadastros convivem: o de-para diz onde a viagem cai, a marcação de
  // método é o que faz a Prévia ler aquela categoria por esta via. Um tipo fora
  // do método produz viagem que não entra em número nenhum.
  const fora = tiposForaDoMetodo(TIPOS, ["2.01.98"]);
  assert.deepEqual(fora.map((t) => t.nome), ["Consultoria"]);
  assert.deepEqual(tiposForaDoMetodo(TIPOS, ["2.01.98", "2.01.91"]), []);
});
