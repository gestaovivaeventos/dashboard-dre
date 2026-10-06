// Destino sem histórico: a pendência e o valor informado pela Controladoria.
//
// O que se trava aqui é a regra do dono do projeto: a viagem NÃO é bloqueada, o
// sistema NÃO estima, e o aviso diz o que falta e quem resolve. Cada asserção
// corresponde a um jeito de o aviso deixar de aparecer — que é o único defeito que
// importa neste módulo.

import test from "node:test";
import assert from "node:assert/strict";

import {
  avisoDoPendente,
  destinosPendentes,
  hospedagemInformada,
  indexarInformadas,
  passagemInformada,
  type LinhaParaPendencia,
  type ReferenciaInformada,
} from "./referencia-destino";
import { referenciasPorDestino, type ViagemRealizada } from "./historico";

function informada(p: Partial<ReferenciaInformada> = {}): ReferenciaInformada {
  return {
    cidade: "Belém",
    passagemPorPessoa: 1200,
    diariaPorQuarto: 300,
    modal: "aviao",
    observacao: null,
    informadoEm: "2026-10-02T12:00:00.000Z",
    ...p,
  };
}

function linha(p: Partial<LinhaParaPendencia> = {}): LinhaParaPendencia {
  return { destino: "Belém", noites: 2, modal: "aviao", ...p };
}

function realizada(p: Partial<ViagemRealizada> = {}): ViagemRealizada {
  return {
    cidade: "Recife",
    mes: 5,
    pessoas: 2,
    noites: 2,
    pessoasPorQuarto: 2,
    diarias: null,
    modal: "aviao",
    custoPassagem: 4000,
    custoHospedagem: 640,
    custoAlimentacao: 360,
    custoTransporteLocal: null,
    ...p,
  };
}

const SEM_HISTORICO = new Map<string, never>();

// ─── O valor informado ──────────────────────────────────────────────────────

test("o índice ignora acento e caixa — e cidade em branco fica fora", () => {
  const m = indexarInformadas([informada({ cidade: "São Luís" }), informada({ cidade: "  " })]);
  assert.equal(m.size, 1);
  assert.ok(m.get("sao luis"));
});

test("a referência informada vai ao motor com origem própria", () => {
  // A premissa usa verbo diferente de histórico: quem valida precisa distinguir
  // número observado de número que alguém informou.
  const p = passagemInformada(informada({ cidade: "Belém", passagemPorPessoa: 1200 }));
  assert.equal(p!.valor, 1200);
  assert.equal(p!.origem, "informada");
  assert.match(p!.nome, /informado pela Controladoria para Belém/);
});

test("a observação entra no rótulo — é o que permite conferir depois", () => {
  const p = passagemInformada(informada({ observacao: "cotação CVC 02/10" }));
  assert.match(p!.nome, /cotação CVC 02\/10/);
});

test("metade não informada devolve null, nunca zero", () => {
  // Zero entraria na conta como se a passagem fosse de graça.
  assert.equal(passagemInformada(informada({ passagemPorPessoa: null })), null);
  assert.equal(passagemInformada(informada({ passagemPorPessoa: 0 })), null);
  assert.equal(hospedagemInformada(informada({ diariaPorQuarto: null })), null);
  assert.equal(passagemInformada(undefined), null);
  assert.ok(hospedagemInformada(informada({ passagemPorPessoa: null })), "a outra metade vale");
});

// ─── A pendência ────────────────────────────────────────────────────────────

test("destino SEM nada é pendente nas duas metades", () => {
  const p = destinosPendentes([linha()], SEM_HISTORICO, new Map());
  assert.equal(p.length, 1);
  assert.equal(p[0].cidade, "Belém");
  assert.equal(p[0].faltaPassagem, true);
  assert.equal(p[0].faltaHospedagem, true);
});

test("destino com HISTÓRICO completo não é pendente", () => {
  const refs = referenciasPorDestino([realizada({ cidade: "Recife" })]);
  const p = destinosPendentes([linha({ destino: "Recife" })], refs, new Map());
  assert.deepEqual(p, []);
});

test("destino com valor INFORMADO completo não é pendente", () => {
  const p = destinosPendentes(
    [linha({ destino: "Belém" })],
    SEM_HISTORICO,
    indexarInformadas([informada({ cidade: "Belém" })]),
  );
  assert.deepEqual(p, []);
});

test("a metade que existe some da pendência; só a que falta fica", () => {
  // Dá para saber a diária de uma cidade e não a passagem. Cobrar as duas seria
  // pedir à Controladoria trabalho que ela já fez.
  const p = destinosPendentes(
    [linha()],
    SEM_HISTORICO,
    indexarInformadas([informada({ passagemPorPessoa: null })]),
  );
  assert.equal(p[0].faltaPassagem, true);
  assert.equal(p[0].faltaHospedagem, false);
});

test("CARRO e VAN não ficam pendentes de passagem — lá vale km × R$/km", () => {
  for (const modal of ["carro", "van"]) {
    const p = destinosPendentes([linha({ modal, noites: 0 })], SEM_HISTORICO, new Map());
    assert.deepEqual(p, [], modal);
  }
});

test("BATE-VOLTA não fica pendente de diária", () => {
  // Sem pernoite não há diária a cobrar. Com a passagem informada, nada falta — e
  // destino sem nada faltando NÃO entra na lista, senão a Controladoria receberia
  // uma fila de pedidos já resolvidos.
  assert.deepEqual(
    destinosPendentes(
      [linha({ noites: 0 })],
      SEM_HISTORICO,
      indexarInformadas([informada({ diariaPorQuarto: null })]),
    ),
    [],
  );
  // Sem a passagem, aí sim: pendente só da passagem.
  const p = destinosPendentes([linha({ noites: 0 })], SEM_HISTORICO, new Map());
  assert.equal(p.length, 1);
  assert.equal(p[0].faltaPassagem, true);
  assert.equal(p[0].faltaHospedagem, false);
});

test("linha com PREÇO PRÓPRIO digitado não gera pendência", () => {
  // Quem tem a cotação em mão já resolveu.
  const p = destinosPendentes(
    [linha({ noites: 0, temPrecoProprio: true })],
    SEM_HISTORICO,
    new Map(),
  );
  assert.deepEqual(p, []);
});

test("conta as viagens do destino e põe o mais usado primeiro", () => {
  // É o destino que, preenchido, move mais o orçamento.
  const p = destinosPendentes(
    [
      linha({ destino: "Belém" }),
      linha({ destino: "Porto Velho" }),
      linha({ destino: "belem" }),
      linha({ destino: "Belém" }),
    ],
    SEM_HISTORICO,
    new Map(),
  );
  assert.equal(p.length, 2);
  assert.equal(p[0].cidade, "Belém");
  assert.equal(p[0].viagens, 3, "a grafia diferente conta no mesmo destino");
  assert.equal(p[1].cidade, "Porto Velho");
});

test("destino em branco é ignorado", () => {
  assert.deepEqual(destinosPendentes([linha({ destino: "   " })], SEM_HISTORICO, new Map()), []);
});

test("uma viagem pendente e outra resolvida no MESMO destino mantêm a pendência", () => {
  // A de carro não precisa de passagem, a de avião precisa — e é a que manda.
  const p = destinosPendentes(
    [linha({ modal: "carro", noites: 0 }), linha({ modal: "aviao", noites: 0 })],
    SEM_HISTORICO,
    new Map(),
  );
  assert.equal(p.length, 1);
  assert.equal(p[0].faltaPassagem, true);
});

// ─── O aviso ────────────────────────────────────────────────────────────────

test("o aviso nomeia o que falta E quem resolve", () => {
  // "Sem dados" sozinho devolve o problema a quem não pode resolvê-lo: quem monta a
  // grade não define preço de passagem.
  const [p] = destinosPendentes([linha()], SEM_HISTORICO, new Map());
  const texto = avisoDoPendente(p);
  assert.match(texto, /Belém não tem histórico/);
  assert.match(texto, /passagem e diária/);
  assert.match(texto, /pode ser cadastrada normalmente/);
  assert.match(texto, /Controladoria/);
});

test("o aviso diz só a metade que falta", () => {
  const [p] = destinosPendentes(
    [linha()],
    SEM_HISTORICO,
    indexarInformadas([informada({ diariaPorQuarto: null })]),
  );
  assert.match(avisoDoPendente(p), /falta diária/);
});
