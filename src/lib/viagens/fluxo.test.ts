// O fluxo da viagem.
//
// Cada asserção corresponde a uma forma de o fluxo prender alguém ou deixar duas
// pessoas escrevendo no mesmo lugar — que são os dois defeitos que uma máquina de
// estados existe para evitar. O caso do CICLO (empresa presa sem saída pela tela)
// está travado aqui como "todo estado tem volta".

import test from "node:test";
import assert from "node:assert/strict";

import {
  ESTADOS_VIAGEM,
  GRUPOS_COTACAO,
  TRANSICOES,
  acoesDisponiveis,
  adminPodeEditarBasico,
  alvosDoLote,
  contarPorEstado,
  destinoDaAcao,
  diretoriaPodeDecidir,
  entraNaExportacao,
  estadoAposValores,
  faltaParaOk,
  gestorPodeEditar,
  normalizarEstado,
  podeLancarValores,
  retratoDaCotacao,
  roteiroMudouDepoisDaCotacao,
  temCotacao,
  totalCotado,
  type DadosBasicos,
  type EstadoViagem,
} from "./fluxo";

function basicos(p: Partial<DadosBasicos> = {}): DadosBasicos {
  return {
    destino: "Recife",
    uf: "PE",
    mesIda: 5,
    noites: 3,
    pessoas: 2,
    pessoasPorQuarto: 2,
    modal: "aviao",
    finalidade: "Implantação da unidade nova",
    tipoId: "t-1",
    ...p,
  };
}

// ─── A integridade da máquina ───────────────────────────────────────────────

test("TODO estado tem caminho de volta — foi a lição do CICLO", () => {
  // O ciclo foi removido em 24/09/2026 por prender empresa num estado sem saída
  // pela tela. Aqui: de qualquer estado alcançado, o admin consegue recuar.
  for (const estado of ESTADOS_VIAGEM) {
    if (estado === "rascunho") continue; // é o início, não há de onde voltar
    const saidas = acoesDisponiveis(estado, "admin");
    assert.ok(saidas.length > 0, `${estado} não tem nenhuma ação de admin`);
  }
  assert.equal(destinoDaAcao("em_cotacao", "reabrir"), "aguardando_cotacao");
  assert.equal(destinoDaAcao("em_aprovacao", "voltar"), "cotada");
});

test("nenhuma transição aponta para estado inexistente", () => {
  for (const t of TRANSICOES) {
    assert.ok(ESTADOS_VIAGEM.includes(t.de), t.de);
    assert.ok(ESTADOS_VIAGEM.includes(t.para), t.para);
  }
});

test("o gestor só dispara OK e Editar; o resto é do admin", () => {
  assert.deepEqual(acoesDisponiveis("rascunho", "gestor"), ["ok"]);
  assert.deepEqual(acoesDisponiveis("aguardando_cotacao", "gestor"), ["editar"]);
  assert.deepEqual(acoesDisponiveis("em_cotacao", "gestor"), [], "fechada é do admin");
  assert.deepEqual(acoesDisponiveis("cotada", "gestor"), []);
  assert.deepEqual(acoesDisponiveis("em_aprovacao", "gestor"), []);
});

test("o admin faz o que o gestor faz, mais o resto", () => {
  assert.deepEqual(acoesDisponiveis("aguardando_cotacao", "admin").sort(), ["editar", "fechar"]);
  assert.deepEqual(acoesDisponiveis("cotada", "admin"), ["seguir"]);
});

test("ação que não existe no estado devolve null", () => {
  assert.equal(destinoDaAcao("rascunho", "fechar"), null);
  assert.equal(destinoDaAcao("cotada", "ok"), null);
});

test("estado antigo é convertido, nunca descartado", () => {
  // `enviada` era "o gestor terminou" no desenho anterior.
  assert.equal(normalizarEstado("enviada"), "aguardando_cotacao");
  assert.equal(normalizarEstado("rascunho"), "rascunho");
  assert.equal(normalizarEstado("em_cotacao"), "em_cotacao");
  assert.equal(normalizarEstado(null), "rascunho");
  assert.equal(normalizarEstado("qualquer_coisa"), "rascunho");
});

// ─── Quem edita o quê ───────────────────────────────────────────────────────

test("o gestor edita antes do fecho, e NUNCA depois", () => {
  assert.equal(gestorPodeEditar("rascunho", "pendente"), true);
  assert.equal(gestorPodeEditar("aguardando_cotacao", "pendente"), true);
  assert.equal(gestorPodeEditar("em_cotacao", "pendente"), false, "fechada é do admin");
  assert.equal(gestorPodeEditar("cotada", "pendente"), false);
  assert.equal(gestorPodeEditar("em_aprovacao", "pendente"), false);
});

test("REVISAR desbloqueia o gestor em qualquer estado — é o pedido", () => {
  // "caso ele peça alguma modificação, a linha desbloqueia para o gestor mexer
  // nas informações básicas e ele clica em ok".
  for (const estado of ESTADOS_VIAGEM) {
    assert.equal(gestorPodeEditar(estado, "revisar"), true, estado);
  }
});

test("REPROVADO não desbloqueia — é diferente de 'mude isso'", () => {
  for (const estado of ESTADOS_VIAGEM) {
    assert.equal(gestorPodeEditar(estado, "reprovado"), false, estado);
  }
  assert.equal(gestorPodeEditar("rascunho", "aprovado"), false, "aprovado também trava");
});

test("o admin NÃO mexe no rascunho do gestor", () => {
  // Deixá-lo editar antes do fecho criaria dois escrevendo no mesmo lugar sem
  // ninguém saber.
  assert.equal(adminPodeEditarBasico("rascunho"), false);
  assert.equal(adminPodeEditarBasico("aguardando_cotacao"), false);
  assert.equal(adminPodeEditarBasico("em_cotacao"), true);
  assert.equal(adminPodeEditarBasico("em_aprovacao"), true);
});

test("valores só depois do fecho", () => {
  assert.equal(podeLancarValores("rascunho"), false);
  assert.equal(podeLancarValores("aguardando_cotacao"), false);
  assert.equal(podeLancarValores("em_cotacao"), true);
  assert.equal(podeLancarValores("cotada"), true);
  assert.equal(podeLancarValores("em_aprovacao"), true);
});

test("a diretoria decide SÓ em_aprovacao — decidir antes é decidir sobre zero", () => {
  for (const estado of ESTADOS_VIAGEM) {
    assert.equal(diretoriaPodeDecidir(estado), estado === "em_aprovacao", estado);
  }
});

// ─── A exportação ───────────────────────────────────────────────────────────

test("o .xls leva SÓ as fechadas", () => {
  // Se saísse do que tem apenas o OK do gestor, ele editaria depois e a
  // Controladoria cotaria um dado que mudou — sem nada avisar.
  for (const estado of ESTADOS_VIAGEM) {
    assert.equal(entraNaExportacao(estado), estado === "em_cotacao", estado);
  }
});

// ─── O OK ───────────────────────────────────────────────────────────────────

test("o OK exige o mínimo para alguém conseguir COTAR", () => {
  assert.equal(faltaParaOk(basicos()), null);
  assert.match(faltaParaOk(basicos({ destino: "  " }))!, /destino/);
  assert.match(faltaParaOk(basicos({ mesIda: null }))!, /mês/);
  assert.match(faltaParaOk(basicos({ pessoas: 0 }))!, /pessoas/);
  assert.match(faltaParaOk(basicos({ tipoId: null }))!, /tipo/);
});

test("a FINALIDADE é obrigatória, e o texto diz por quê", () => {
  // É o que o diretor lê para aprovar; sem ela ele decide sobre um número sem
  // saber para que serve.
  const falta = faltaParaOk(basicos({ finalidade: "" }));
  assert.match(falta!, /para que serve/);
  assert.match(falta!, /diretoria/);
});

test("devolve a PRIMEIRA falta, não a lista", () => {
  // Cinco erros de uma vez em 50 linhas não se leem.
  const falta = faltaParaOk(basicos({ destino: "", mesIda: null, finalidade: "" }));
  assert.match(falta!, /destino/);
});

test("UF e modal são opcionais para o OK", () => {
  assert.equal(faltaParaOk(basicos({ uf: null, modal: null })), null);
});

test("bate-volta passa: zero noites é valor legítimo", () => {
  assert.equal(faltaParaOk(basicos({ noites: 0 })), null);
});

// ─── Os valores ─────────────────────────────────────────────────────────────

test("o custo da viagem é a SOMA dos grupos, e nada mais", () => {
  const v = { passagem: 2400, hospedagem: 960, alimentacao: 360 };
  assert.equal(totalCotado(v), 3720);
  assert.equal(temCotacao(v), true);
});

test("grupo nulo, ausente ou NaN não entra na soma", () => {
  assert.equal(totalCotado({ passagem: 1000, hospedagem: null }), 1000);
  assert.equal(totalCotado({ passagem: Number.NaN }), 0);
  assert.equal(totalCotado({}), 0);
  assert.equal(temCotacao({}), false);
  assert.equal(temCotacao({ passagem: 0 }), false, "zero não é cotação");
});

test("a soma arredonda a centavo", () => {
  assert.equal(totalCotado({ passagem: 10.005, hospedagem: 0.001 }), 10.01);
});

test("os grupos da cotação são os do motor — nem mais, nem menos", () => {
  // É por eles que a linha abre em árvore e que a Prévia já soma.
  assert.deepEqual([...GRUPOS_COTACAO], [
    "passagem",
    "translado",
    "transporte_local",
    "hospedagem",
    "alimentacao",
    "outros",
  ]);
});

test("cotada é DERIVADO do valor, não um botão", () => {
  assert.equal(estadoAposValores("em_cotacao", { passagem: 100 }), "cotada");
  assert.equal(estadoAposValores("cotada", {}), "em_cotacao", "zerar devolve");
  assert.equal(estadoAposValores("cotada", { passagem: 0 }), "em_cotacao");
});

test("corrigir valor na diretoria NÃO tira a viagem da fila dela", () => {
  // Quem avisa que o número mudou é a decisão vencida pela edição, que já é regra
  // do módulo — não um estado que volta.
  assert.equal(estadoAposValores("em_aprovacao", { passagem: 500 }), "em_aprovacao");
  assert.equal(estadoAposValores("em_aprovacao", {}), "em_aprovacao");
});

test("lançar valor em estado que não aceita não muda o estado", () => {
  assert.equal(estadoAposValores("rascunho", { passagem: 100 }), "rascunho");
  assert.equal(estadoAposValores("aguardando_cotacao", { passagem: 100 }), "aguardando_cotacao");
});

// ─── Roteiro alterado depois da cotação ─────────────────────────────────────

test("roteiro alterado DEPOIS da cotação é marcado, e os valores ficam", () => {
  // Mesmo padrão do "extrato mudou depois do envio" do VB: o sistema não decide
  // por você, mostra que a base mudou.
  assert.equal(
    roteiroMudouDepoisDaCotacao("2026-10-06T12:00:00.000Z", "2026-10-05T12:00:00.000Z"),
    true,
  );
  assert.equal(
    roteiroMudouDepoisDaCotacao("2026-10-04T12:00:00.000Z", "2026-10-05T12:00:00.000Z"),
    false,
  );
});

test("empate de relógio não conta como alteração", () => {
  const t = "2026-10-06T12:00:00.000Z";
  assert.equal(roteiroMudouDepoisDaCotacao(t, t), false);
});

test("sem cotação ou sem alteração, nada a avisar", () => {
  assert.equal(roteiroMudouDepoisDaCotacao(null, "2026-10-05T12:00:00.000Z"), false);
  assert.equal(roteiroMudouDepoisDaCotacao("2026-10-05T12:00:00.000Z", null), false);
  assert.equal(roteiroMudouDepoisDaCotacao("nao e data", "2026-10-05T12:00:00.000Z"), false);
});

// ─── A leitura do conjunto ──────────────────────────────────────────────────

test("a contagem por estado cobre os cinco, com zero onde não há", () => {
  const c = contarPorEstado([
    { estado: "rascunho" as EstadoViagem },
    { estado: "em_cotacao" as EstadoViagem },
    { estado: "em_cotacao" as EstadoViagem },
  ]);
  assert.equal(c.rascunho, 1);
  assert.equal(c.em_cotacao, 2);
  assert.equal(c.cotada, 0, "zero aparece, não fica ausente");
  assert.equal(c.em_aprovacao, 0);
});

test("o lote alcança só as linhas em que a ação existe", () => {
  const linhas = [
    { id: "a", estado: "aguardando_cotacao" as EstadoViagem },
    { id: "b", estado: "rascunho" as EstadoViagem },
    { id: "c", estado: "aguardando_cotacao" as EstadoViagem },
    { id: "d", estado: "em_aprovacao" as EstadoViagem },
  ];
  assert.deepEqual(
    alvosDoLote(linhas, "fechar", "admin").map((l) => l.id),
    ["a", "c"],
  );
  assert.deepEqual(alvosDoLote(linhas, "fechar", "gestor"), [], "fechar é do admin");
  assert.deepEqual(
    alvosDoLote(linhas, "ok", "gestor").map((l) => l.id),
    ["b"],
  );
});

// ─── O retrato ──────────────────────────────────────────────────────────────

const LABELS = {
  passagem: "Passagem",
  translado: "Translado",
  transporte_local: "Transporte local",
  hospedagem: "Hospedagem",
  alimentacao: "Alimentação",
  outros: "Outros",
};

test("o retrato põe o custo INTEIRO no mês da partida", () => {
  // A DRE é caixa: passagem e hotel são pagos antes de viajar. Ratear por noite
  // jogaria para fevereiro dinheiro que saiu em janeiro.
  const r = retratoDaCotacao({
    valores: { passagem: 2400, hospedagem: 960 },
    mesIda: 3,
    cotadoEm: "2026-10-06T12:00:00.000Z",
    dataBase: "2027-03-12",
    observacao: null,
    labels: LABELS,
  });
  assert.equal(r.custo_total, 3360);
  assert.equal(r.meses.length, 12);
  assert.equal(r.meses[2], 3360, "março");
  assert.equal(r.meses.reduce((a, b) => a + b, 0), 3360, "não aparece em outro mês");
});

test("só os grupos COM valor entram na árvore", () => {
  const r = retratoDaCotacao({
    valores: { passagem: 1000, hospedagem: 0, alimentacao: null },
    mesIda: 1,
    cotadoEm: null,
    dataBase: null,
    observacao: null,
    labels: LABELS,
  });
  assert.deepEqual(r.grupos.map((g) => g.grupo), ["passagem"]);
  assert.equal(r.grupos[0].total, 1000);
});

test("a premissa diz QUANDO e para que data a cotação foi feita", () => {
  // Sem isso, seis meses adiante ninguém sabe se a tarifa era de alta ou baixa.
  const r = retratoDaCotacao({
    valores: { passagem: 2400 },
    mesIda: 3,
    cotadoEm: "2026-10-06T12:00:00.000Z",
    dataBase: "2027-03-12",
    observacao: "cotação CVC",
    labels: LABELS,
  });
  const texto = r.premissas.join(" | ");
  assert.match(texto, /COTADOS pela Controladoria em 06\/10\/2026/);
  assert.match(texto, /data-base 12\/03\/2027/);
  assert.match(texto, /Fonte da cotação: cotação CVC/);
  assert.match(texto, /Não há estimativa do sistema/);
});

test("sem cotação, a premissa diz que falta PREÇO, não cadastro", () => {
  const r = retratoDaCotacao({
    valores: {},
    mesIda: 3,
    cotadoEm: null,
    dataBase: null,
    observacao: null,
    labels: LABELS,
  });
  assert.equal(r.custo_total, 0);
  assert.deepEqual(r.grupos, []);
  assert.match(r.premissas.join(" "), /AGUARDANDO COTAÇÃO/);
  assert.match(r.premissas.join(" "), /falta é o preço/);
});

test("sem mês, a premissa avisa que o custo não cai em mês nenhum", () => {
  const r = retratoDaCotacao({
    valores: { passagem: 100 },
    mesIda: null,
    cotadoEm: null,
    dataBase: null,
    observacao: null,
    labels: LABELS,
  });
  assert.equal(r.meses.reduce((a, b) => a + b, 0), 0);
  assert.match(r.premissas.join(" "), /não cai em mês nenhum/);
});

test("roteiro alterado depois da cotação vira premissa ALTA", () => {
  const r = retratoDaCotacao({
    valores: { passagem: 100 },
    mesIda: 1,
    cotadoEm: "2026-10-05T12:00:00.000Z",
    dataBase: null,
    observacao: null,
    labels: LABELS,
    roteiroMudou: true,
  });
  assert.match(r.premissas.join(" "), /alterado DEPOIS da cotação/);
});
