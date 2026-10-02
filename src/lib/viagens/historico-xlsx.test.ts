// A planilha do histórico de viagens.
//
// O que se trava: PESSOAS obrigatório (assumir 1 numa viagem de 4 multiplicaria a
// referência por quatro, calado), falha por linha, e a tolerância de formato que
// evita o retrabalho de reescrever a planilha à mão.

import test from "node:test";
import assert from "node:assert/strict";

import {
  lerDinheiro,
  lerModal,
  parseHistoricoXlsx,
  type HistoricoXlsxParse,
} from "./historico-xlsx";

const CAB = [
  "Cidade",
  "Mês",
  "Pessoas",
  "Noites",
  "Pessoas por quarto",
  "Modal",
  "Passagem",
  "Hospedagem",
  "Alimentação",
  "Observação",
];

function ok(data: unknown[][]): HistoricoXlsxParse {
  const r = parseHistoricoXlsx(data);
  if ("erro" in r) throw new Error(r.erro);
  return r.parse;
}

// ─── Dinheiro ───────────────────────────────────────────────────────────────

test("lê dinheiro em todos os formatos que uma planilha real traz", () => {
  for (const [v, esperado] of [
    [1180, 1180],
    ["1180", 1180],
    ["1.180,00", 1180],
    ["R$ 1.180,00", 1180],
    ["r$1180,50", 1180.5],
    ["1180.50", 1180.5],
    ["12.345,67", 12345.67],
  ] as Array<[unknown, number]>) {
    assert.equal(lerDinheiro(v), esperado, String(v));
  }
  for (const v of ["", "  ", "a combinar", null, undefined, "R$"]) {
    assert.equal(lerDinheiro(v), null, String(v));
  }
});

test("lê o modal escrito à mão; desconhecido fica null em vez de virar chute", () => {
  assert.equal(lerModal("Avião"), "aviao");
  assert.equal(lerModal("AÉREO"), "aviao");
  assert.equal(lerModal("ônibus"), "onibus");
  assert.equal(lerModal("carro próprio"), "carro");
  assert.equal(lerModal("Van"), "van");
  assert.equal(lerModal("trem"), null);
  assert.equal(lerModal(""), null);
});

// ─── O cabeçalho ────────────────────────────────────────────────────────────

test("acha o cabeçalho depois de título e linhas em branco", () => {
  const p = ok([
    ["Histórico de viagens 2026"],
    [],
    CAB,
    ["Recife", "maio", 2, 2, 2, "Avião", 4000, 640, 360, ""],
  ]);
  assert.equal(p.rows.length, 1);
  assert.equal(p.rows[0].linha, 4, "a linha reportada é a da planilha");
});

test("a ordem das colunas é livre", () => {
  const p = ok([
    ["Passagem", "Cidade", "Pessoas", "Noites"],
    [4000, "Recife", 2, 2],
  ]);
  assert.equal(p.rows[0].cidade, "Recife");
  assert.equal(p.rows[0].custoPassagem, 4000);
});

test("sem Cidade e Pessoas no cabeçalho, recusa o ARQUIVO e diz o que falta", () => {
  // Aceitar e depois recusar todas as linhas seria pior do que dizer logo.
  const r = parseHistoricoXlsx([["Destino", "Passagem"], ["Recife", 4000]]);
  assert.ok("erro" in r);
  assert.match((r as { erro: string }).erro, /Cidade e Pessoas/);
});

// ─── As linhas ──────────────────────────────────────────────────────────────

test("PESSOAS é obrigatório — assumir 1 multiplicaria a referência", () => {
  const p = ok([CAB, ["Recife", "maio", "", 2, 2, "Avião", 4000, 640, 360, ""]]);
  assert.equal(p.rows.length, 0);
  assert.match(p.problemas.join(" | "), /Linha 2 \(Recife\): sem o número de pessoas/);
});

test("linha sem cidade e linha sem custo nenhum são recusadas, com o motivo", () => {
  const p = ok([
    CAB,
    ["", "maio", 2, 2, 2, "Avião", 4000, 0, 0, ""],
    ["Natal", "maio", 2, 2, 2, "Avião", 0, 0, 0, ""],
  ]);
  assert.equal(p.rows.length, 0);
  assert.match(p.problemas.join(" | "), /Linha 2: sem cidade/);
  assert.match(p.problemas.join(" | "), /Linha 3 \(Natal\): sem nenhum custo/);
});

test("uma linha torta não custa as outras", () => {
  const p = ok([
    CAB,
    ["Recife", "maio", 2, 2, 2, "Avião", 4000, 640, 360, ""],
    ["", "", "", "", "", "", "", "", "", ""],
    ["Natal", 6, "", 1, 2, "Avião", 3000, 300, 120, ""],
    ["Curitiba", "março", 3, 2, 2, "Avião", 5400, 900, 540, "evento"],
  ]);
  assert.deepEqual(p.rows.map((r) => r.cidade), ["Recife", "Curitiba"]);
  assert.equal(p.problemas.length, 1, "só a de Natal");
});

test("linha totalmente vazia é separador, não problema", () => {
  const p = ok([CAB, [], ["Recife", "maio", 2, 2, 2, "Avião", 4000, 640, 360, ""], []]);
  assert.equal(p.rows.length, 1);
  assert.deepEqual(p.problemas, []);
});

test("hospedagem com ZERO noites avisa mas NÃO descarta a linha", () => {
  // A passagem dela continua valendo; só a diária fica de fora (não existe
  // diária por noite com zero noite).
  const p = ok([CAB, ["Barbacena", "março", 2, 0, 2, "Carro", 0, 300, 120, ""]]);
  assert.equal(p.rows.length, 1);
  assert.equal(p.rows[0].noites, 0);
  assert.match(p.problemas.join(" | "), /0 noites/);
});

test("mês aceita número e nome; ausente fica null", () => {
  const p = ok([
    CAB,
    ["Recife", "maio", 2, 2, 2, "Avião", 4000, 640, 360, ""],
    ["Natal", 9, 2, 2, 2, "Avião", 4000, 640, 360, ""],
    ["Belém", "", 2, 2, 2, "Avião", 4000, 640, 360, ""],
  ]);
  assert.deepEqual(p.rows.map((r) => r.mes), [5, 9, null]);
});

test("colunas opcionais ausentes não impedem a leitura", () => {
  // Planilha mínima: cidade, pessoas e um custo.
  const p = ok([["Cidade", "Pessoas", "Passagem"], ["Recife", 2, "R$ 4.000,00"]]);
  assert.equal(p.rows.length, 1);
  assert.equal(p.rows[0].noites, 0);
  assert.equal(p.rows[0].pessoasPorQuarto, null);
  assert.equal(p.rows[0].modal, null);
  assert.equal(p.rows[0].custoHospedagem, null);
});

test("custo zero é lido como NÃO INFORMADO, não como de graça", () => {
  const p = ok([CAB, ["Recife", "maio", 2, 2, 2, "Avião", 4000, 0, 0, ""]]);
  assert.equal(p.rows[0].custoPassagem, 4000);
  assert.equal(p.rows[0].custoHospedagem, null);
  assert.equal(p.rows[0].custoAlimentacao, null);
});

test("observação em branco vira null", () => {
  const p = ok([CAB, ["Recife", "maio", 2, 2, 2, "Avião", 4000, 640, 360, "   "]]);
  assert.equal(p.rows[0].observacao, null);
});
