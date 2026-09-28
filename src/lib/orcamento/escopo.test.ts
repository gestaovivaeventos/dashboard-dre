// Por que o orçamento aparece vazio.
//
// Cada motivo aponta para um cadastro DIFERENTE, e mandar alguém para a tela
// errada é pior do que não avisar — é o que estes testes travam. A ordem das
// perguntas também é regra: o aviso tem de nomear a PRIMEIRA coisa que precisa
// acontecer, não a última.

import test from "node:test";
import assert from "node:assert/strict";

import { ACAO_ADMIN_TEXTO, diagnosticarEscopo, type EscopoFatos } from "./escopo";

/** Cenário completo e saudável; cada teste estraga um elo. */
const ok: EscopoFatos = {
  papel: "construtor",
  orcaPorSetor: true,
  setoresAtribuidos: 2,
  setoresDaEmpresa: 5,
  setoresComPonte: 5,
  setoresAlcancados: 2,
};

test("alcançando setor, não há nada a dizer", () => {
  assert.equal(diagnosticarEscopo(ok).motivo, "ok");
  assert.equal(diagnosticarEscopo(ok).gravidade, "ok");
});

test("admin nunca cai em escopo vazio — ele não é recortado", () => {
  const d = diagnosticarEscopo({ ...ok, papel: "admin", setoresAlcancados: 0 });
  assert.equal(d.motivo, "ok");
});

// ─── Cada elo quebrado aponta para o seu conserto ────────────────────────────

test("sem setor atribuído NESTA empresa manda para a tela de Usuários", () => {
  const d = diagnosticarEscopo({ ...ok, setoresAtribuidos: 0, setoresAlcancados: 0 });
  assert.equal(d.motivo, "sem_setor_no_usuario");
  assert.equal(d.acaoAdmin, "usuarios");
});

test("o aviso diz que a atribuição é POR EMPRESA", () => {
  // Sem isso a pessoa conclui que está sem setor em lugar nenhum e vai
  // conferir o Compras, onde o setor dela está lá — e o chamado vira
  // "o sistema perdeu meu setor".
  const d = diagnosticarEscopo({ ...ok, setoresAtribuidos: 0, setoresAlcancados: 0 });
  assert.equal(d.motivo, "sem_setor_no_usuario");
  assert.match(d.detalhe, /POR EMPRESA/);
});

test("empresa sem setor no ano manda para Configuração › Setores", () => {
  const d = diagnosticarEscopo({
    ...ok,
    setoresDaEmpresa: 0,
    setoresComPonte: 0,
    setoresAlcancados: 0,
  });
  assert.equal(d.motivo, "empresa_sem_setor");
  assert.equal(d.acaoAdmin, "setores");
});

test("ponte vazia com o Compras manda para Configuração › Setores", () => {
  const d = diagnosticarEscopo({ ...ok, setoresComPonte: 0, setoresAlcancados: 0 });
  assert.equal(d.motivo, "ponte_vazia");
  assert.equal(d.acaoAdmin, "setores");
  // O número entra na frase: "nenhum dos 5" é o que faz o admin procurar.
  assert.match(d.detalhe, /5 setores/);
});

test("tudo cadastrado e ainda assim vazio = os setores são de outra pessoa", () => {
  // O único motivo que NÃO é defeito de cadastro — e por isso não promete
  // conserto, só diz a quem pedir.
  const d = diagnosticarEscopo({ ...ok, setoresAlcancados: 0 });
  assert.equal(d.motivo, "fora_da_responsabilidade");
});

test("todo motivo com conserto tem a frase do conserto", () => {
  // É o que garante que a tela nunca diga "está vazio" sem dizer a quem pedir.
  const quebrados: EscopoFatos[] = [
    { ...ok, setoresAtribuidos: 0, setoresAlcancados: 0 },
    { ...ok, setoresDaEmpresa: 0, setoresComPonte: 0, setoresAlcancados: 0 },
    { ...ok, setoresComPonte: 0, setoresAlcancados: 0 },
    { ...ok, setoresAlcancados: 0 },
  ];
  for (const f of quebrados) {
    const d = diagnosticarEscopo(f);
    assert.notEqual(d.acaoAdmin, null, d.motivo);
    assert.ok(ACAO_ADMIN_TEXTO[d.acaoAdmin!].length > 0, d.motivo);
  }
});

test("empresa que orça só por categoria não é cadastro faltando", () => {
  const d = diagnosticarEscopo({ ...ok, orcaPorSetor: false, setoresAlcancados: 0 });
  assert.equal(d.motivo, "empresa_sem_recorte");
  assert.equal(d.acaoAdmin, null);
  assert.match(d.detalhe, /Não é um cadastro faltando/);
});

test("a empresa sem recorte vem ANTES do cadastro do usuário", () => {
  // Sem recorte por setor não há o que vincular: mandar a pessoa pedir setor
  // no próprio usuário não resolveria nada.
  const d = diagnosticarEscopo({
    ...ok,
    orcaPorSetor: false,
    setoresAtribuidos: 0,
    setoresAlcancados: 0,
  });
  assert.equal(d.motivo, "empresa_sem_recorte");
});

test("o cadastro do usuário vem antes do da empresa", () => {
  // Os dois quebrados: o aviso nomeia o elo mais próximo dele primeiro.
  const d = diagnosticarEscopo({
    ...ok,
    setoresAtribuidos: 0,
    setoresDaEmpresa: 0,
    setoresComPonte: 0,
    setoresAlcancados: 0,
  });
  assert.equal(d.motivo, "sem_setor_no_usuario");
});

// ─── Gravidade: quem vê a tela vazia e quem só não consegue editar ───────────

test("Gerente (só os setores dele) fica BLOQUEADO — a tela some", () => {
  const d = diagnosticarEscopo({ ...ok, papel: "construtor", setoresAlcancados: 0 });
  assert.equal(d.gravidade, "bloqueio");
  assert.match(d.detalhe, /vazias para você/);
});

test("Gerente Sócio e diretor leem a empresa inteira: é AVISO, não bloqueio", () => {
  for (const papel of ["construtor_amplo", "validador"] as const) {
    const d = diagnosticarEscopo({ ...ok, papel, setoresAlcancados: 0 });
    assert.equal(d.gravidade, "aviso", papel);
    assert.match(d.detalhe, /não editar nada/);
  }
});
