// A grade de viagens — a parte pura, depois de o custo sair do caminho.
//
// O que sobrou aqui descreve a viagem para alguém conseguir COTÁ-LA. Então o que
// se trava é: o rascunho grava frouxo (montar 50 linhas leva idas e vindas), o OK
// é rigoroso (dali a viagem sai da mão do gestor), e o que vai para o banco não
// perde nada que a cotação externa precise.

import test from "node:test";
import assert from "node:assert/strict";

import {
  PESSOAS_POR_QUARTO_PADRAO,
  faltaParaOkDaLinha,
  origemMaisUsada,
  paradaRowDaLinha,
  quartosDaLinha,
  resumirLote,
  tituloDaLinha,
  validarLinhaViagem,
  viagemRowDaLinha,
  type LinhaViagemInput,
} from "./grade";

function linha(p: Partial<LinhaViagemInput> = {}): LinhaViagemInput {
  return {
    origem: "Juiz de Fora",
    destino: "Recife",
    uf: "PE",
    mesIda: 5,
    noites: 3,
    pessoas: 2,
    pessoasPorQuarto: 2,
    tipoId: "t-1",
    modal: "aviao",
    finalidade: "Implantação da unidade",
    ...p,
  };
}

// ─── Gravar rascunho × dar OK ───────────────────────────────────────────────

test("o rascunho grava com destino e tipo — o resto pode faltar", () => {
  // Barrar a gravação a cada campo em branco obrigaria a preencher na ordem do
  // sistema, e são 50 linhas.
  assert.equal(validarLinhaViagem(linha({ mesIda: null, finalidade: null })), null);
  assert.match(validarLinhaViagem(linha({ destino: "  " }))!, /destino/);
  assert.match(validarLinhaViagem(linha({ tipoId: "" }))!, /tipo/);
});

test("o OK é mais rigoroso que o rascunho, e lê da MESMA fonte do fluxo", () => {
  assert.equal(faltaParaOkDaLinha(linha()), null);
  assert.match(faltaParaOkDaLinha(linha({ mesIda: null }))!, /mês/);
  assert.match(faltaParaOkDaLinha(linha({ finalidade: "" }))!, /para que serve/);
});

// ─── O que vai para o banco ─────────────────────────────────────────────────

test("o título carrega a UF — é o que distingue duas cidades homônimas", () => {
  assert.equal(tituloDaLinha(linha()), "Recife (PE)");
  assert.equal(tituloDaLinha(linha({ uf: null })), "Recife");
  assert.equal(tituloDaLinha(linha({ destino: "  ", uf: null })), "Viagem");
});

test("a linha da viagem leva só dados BÁSICOS, nenhum custo", () => {
  const row = viagemRowDaLinha(linha());
  assert.equal(row.mes_ida, 5);
  assert.equal(row.pessoas, 2);
  assert.equal(row.pessoas_por_quarto, 2);
  assert.equal(row.tipo_id, "t-1");
  assert.equal(row.finalidade, "Implantação da unidade");
  // O custo vem da cotação, não daqui.
  for (const chave of Object.keys(row)) {
    assert.doesNotMatch(chave, /custo|cot_|preco|valor/, chave);
  }
});

test("pessoas e ocupação têm piso 1, e ocupação ausente assume 2", () => {
  const row = viagemRowDaLinha(linha({ pessoas: 0, pessoasPorQuarto: null }));
  assert.equal(row.pessoas, 1);
  assert.equal(row.pessoas_por_quarto, PESSOAS_POR_QUARTO_PADRAO);
});

test("a parada leva cidade, UF e noites — e a UF sai normalizada", () => {
  const p = paradaRowDaLinha(linha({ uf: "pe" }));
  assert.equal(p.ordem, 1);
  assert.equal(p.cidade, "Recife");
  assert.equal(p.uf, "PE");
  assert.equal(p.noites, 3);
  assert.equal(p.chegada_de, "Juiz de Fora");
  assert.equal(p.chegada_modal, "aviao");
});

test("UF maior que dois caracteres é cortada, e vazia fica nula", () => {
  assert.equal(paradaRowDaLinha(linha({ uf: "Pernambuco" })).uf, "PE");
  assert.equal(paradaRowDaLinha(linha({ uf: "  " })).uf, null);
});

test("bate-volta grava zero noites, não nulo", () => {
  assert.equal(paradaRowDaLinha(linha({ noites: 0 })).noites, 0);
});

// ─── A partida, que é de cada LINHA ─────────────────────────────────────────

test("a partida vai para a viagem E para a parada, e vem da própria linha", () => {
  // Era um campo do cabeçalho da grade, valendo para as 50. Viagem casada desmente
  // isso: quem vai a Recife e de lá a Natal tem dois trechos com partidas
  // diferentes, e o cabeçalho mandava cotar o segundo saindo de casa.
  const l = linha({ origem: " Recife " });
  assert.equal(viagemRowDaLinha(l).origem, "Recife");
  assert.equal(paradaRowDaLinha(l).chegada_de, "Recife");
});

test("rascunho sem partida grava vazio; é o OK que a cobra", () => {
  // A coluna é NOT NULL, e barrar a gravação obrigaria a preencher na ordem do
  // sistema — são 50 linhas montadas em várias idas e vindas.
  assert.equal(validarLinhaViagem(linha({ origem: null })), null);
  assert.equal(viagemRowDaLinha(linha({ origem: null })).origem, "");
  assert.equal(paradaRowDaLinha(linha({ origem: null })).chegada_de, null);
  assert.match(faltaParaOkDaLinha(linha({ origem: null }))!, /parte/);
});

test("a partida que pré-preenche linha nova é a MAIS USADA, não a da primeira", () => {
  // Com viagem casada na grade, a primeira linha pode ser uma perna intermediária
  // (partindo de Recife): usá-la faria toda viagem nova nascer saindo da cidade
  // errada.
  const linhas = [
    { origem: "Recife" },
    { origem: "Juiz de Fora" },
    { origem: "juiz de fora" },
    { origem: null },
    { origem: "  " },
  ];
  assert.equal(origemMaisUsada(linhas), "Juiz de Fora");
  assert.equal(origemMaisUsada([]), "", "grade vazia não inventa cidade");
  assert.equal(origemMaisUsada([{ origem: null }]), "");
  assert.equal(
    origemMaisUsada([{ origem: "Belo Horizonte" }, { origem: "Recife" }]),
    "Belo Horizonte",
    "empate fica com a primeira vista",
  );
});

// ─── Quartos ────────────────────────────────────────────────────────────────

test("os quartos entram no .xls — quem cota precisa saber quantos reservar", () => {
  assert.equal(quartosDaLinha(linha({ pessoas: 4, pessoasPorQuarto: 2 })), 2);
  assert.equal(quartosDaLinha(linha({ pessoas: 4, pessoasPorQuarto: 1 })), 4);
  assert.equal(quartosDaLinha(linha({ pessoas: 3, pessoasPorQuarto: 2 })), 2, "arredonda acima");
  assert.equal(quartosDaLinha(linha({ pessoas: 2, pessoasPorQuarto: null })), 1, "padrão 2");
});

// ─── O lote ─────────────────────────────────────────────────────────────────

test("o resumo do lote separa gravadas de recusadas", () => {
  const r = resumirLote([
    { indice: 0, id: "a" },
    { indice: 1, erro: "sem destino" },
    { indice: 2, id: "c" },
  ]);
  assert.deepEqual(r, { gravadas: 2, comErro: 1 });
});

test("lote vazio não é erro", () => {
  assert.deepEqual(resumirLote([]), { gravadas: 0, comErro: 0 });
});
