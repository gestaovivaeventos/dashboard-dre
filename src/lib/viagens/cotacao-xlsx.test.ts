// A planilha de cotação, na volta.
//
// O que se trava aqui: o casamento por ID (nome colidiria em duas idas a São Paulo
// em março), "em branco ≠ zero" (conflar os dois faz "não cotei" entrar na conta
// como se fosse de graça) e a tolerância de formato que evita redigitar a planilha.

import test from "node:test";
import assert from "node:assert/strict";

import { lerData, lerDinheiro, parseCotacaoXlsx, type CotacaoXlsxParse } from "./cotacao-xlsx";

const CAB = [
  "ID (não apague)",
  "Origem",
  "Destino",
  "UF",
  "Mês",
  "Dias",
  "Pessoas",
  "Pessoas por quarto",
  "Quartos",
  "Modal",
  "Tipo",
  "Para que serve",
  "Passagem / deslocamento entre cidades",
  "Translado (casa ↔ terminal)",
  "Transporte local no destino",
  "Hospedagem",
  "Alimentação",
  "Outros custos",
  "Data-base da cotação",
  "Fonte / observação",
];

function linha(id: string, valores: unknown[], extras: unknown[] = []): unknown[] {
  return [id, "JF", "Recife", "PE", "maio", 3, 2, 2, 1, "aviao", "Consultoria", "Implantação", ...valores, ...extras];
}

function ok(data: unknown[][]): CotacaoXlsxParse {
  const r = parseCotacaoXlsx(data);
  if ("erro" in r) throw new Error(r.erro);
  return r.parse;
}

// ─── Formatos ───────────────────────────────────────────────────────────────

test("lê dinheiro em todos os formatos que uma planilha real traz", () => {
  for (const [v, esperado] of [
    [2400, 2400],
    ["2400", 2400],
    ["2.400,00", 2400],
    ["R$ 2.400,00", 2400],
    ["2400.50", 2400.5],
  ] as Array<[unknown, number]>) {
    assert.equal(lerDinheiro(v), esperado, String(v));
  }
  for (const v of ["", "  ", "a combinar", null, undefined]) {
    assert.equal(lerDinheiro(v), null, String(v));
  }
});

test("lê data ISO, brasileira e o serial do Excel", () => {
  assert.equal(lerData("2027-03-12"), "2027-03-12");
  assert.equal(lerData("12/03/2027"), "2027-03-12");
  assert.equal(lerData("1/3/2027"), "2027-03-01");
  // Serial do sistema de 1900 do Excel (dias desde 30/12/1899).
  assert.equal(lerData(46458), "2027-03-12");
  assert.equal(lerData(46448), "2027-03-02", "dez dias antes");
  assert.equal(lerData(""), null);
  assert.equal(lerData("qualquer coisa"), null);
});

// ─── O cabeçalho ────────────────────────────────────────────────────────────

test("acha o cabeçalho e casa os seis grupos pelos rótulos longos do sistema", () => {
  const p = ok([CAB, linha("v-1", [2400, 100, 80, 960, 360, 50], ["2027-03-12", "CVC"])]);
  assert.equal(p.rows.length, 1);
  assert.deepEqual(p.rows[0].valores, {
    passagem: 2400,
    translado: 100,
    transporte_local: 80,
    hospedagem: 960,
    alimentacao: 360,
    outros: 50,
  });
  assert.equal(p.rows[0].dataBase, "2027-03-12");
  assert.equal(p.rows[0].observacao, "CVC");
});

test("PASSAGEM não é confundida com TRANSPORTE LOCAL", () => {
  // "Transporte local no destino" contém "local", e "Passagem / deslocamento entre
  // cidades" contém "deslocamento": as pistas precisam separar os dois.
  const p = ok([
    ["ID", "Passagem", "Transporte local", "Hospedagem"],
    ["v-1", 1000, 50, 300],
  ]);
  assert.equal(p.rows[0].valores.passagem, 1000);
  assert.equal(p.rows[0].valores.transporte_local, 50);
  assert.equal(p.rows[0].valores.hospedagem, 300);
});

test("planilha mínima (ID + um grupo) é aceita", () => {
  const p = ok([["ID", "Hospedagem"], ["v-9", "1.200,00"]]);
  assert.equal(p.rows.length, 1);
  assert.equal(p.rows[0].valores.hospedagem, 1200);
  assert.equal(p.rows[0].valores.passagem, null, "grupo ausente fica nulo, não zero");
});

test("sem ID ou sem nenhuma coluna de valor, recusa o ARQUIVO e diz o que falta", () => {
  const semId = parseCotacaoXlsx([["Destino", "Passagem"], ["Recife", 100]]);
  assert.ok("erro" in semId);
  assert.match((semId as { erro: string }).erro, /coluna ID/);

  const semValor = parseCotacaoXlsx([["ID", "Destino"], ["v-1", "Recife"]]);
  assert.ok("erro" in semValor);
});

// ─── As linhas ──────────────────────────────────────────────────────────────

test("EM BRANCO é diferente de ZERO", () => {
  // Em branco = não cotei este grupo; zero = cotei e não há este custo.
  const p = ok([
    ["ID", "Passagem", "Hospedagem"],
    ["v-1", 1000, ""],
    ["v-2", 1000, 0],
  ]);
  assert.equal(p.rows[0].valores.hospedagem, null);
  assert.equal(p.rows[1].valores.hospedagem, 0);
});

test("linha com valores e SEM id é recusada, com o número da linha", () => {
  const p = ok([["ID", "Passagem"], ["", 1000]]);
  assert.equal(p.rows.length, 0);
  assert.match(p.problemas.join(" | "), /Linha 2: tem valores mas está sem o ID/);
});

test("linha totalmente vazia é separador, não problema", () => {
  const p = ok([["ID", "Passagem"], ["", ""], ["v-1", 100], []]);
  assert.equal(p.rows.length, 1);
  assert.deepEqual(p.problemas, []);
});

test("ID repetido é recusado — duas linhas para a mesma viagem é erro de planilha", () => {
  const p = ok([["ID", "Passagem"], ["v-1", 100], ["v-1", 200]]);
  assert.equal(p.rows.length, 1);
  assert.equal(p.rows[0].valores.passagem, 100);
  assert.match(p.problemas.join(" | "), /aparece mais de uma vez/);
});

test("valor NEGATIVO recusa a linha inteira", () => {
  const p = ok([["ID", "Passagem", "Hospedagem"], ["v-1", 1000, -50]]);
  assert.equal(p.rows.length, 0);
  assert.match(p.problemas.join(" | "), /negativo/);
});

test("valor ilegível vira problema e o grupo fica nulo — a linha ainda passa", () => {
  // Uma célula com "a combinar" não pode custar a passagem que está certa ao lado.
  const p = ok([["ID", "Passagem", "Hospedagem"], ["v-1", 1000, "a combinar"]]);
  assert.equal(p.rows.length, 1);
  assert.equal(p.rows[0].valores.passagem, 1000);
  assert.equal(p.rows[0].valores.hospedagem, null);
  assert.match(p.problemas.join(" | "), /ilegível/);
});

test("uma linha torta não custa as outras", () => {
  const p = ok([
    ["ID", "Passagem"],
    ["v-1", 1000],
    ["", 500],
    ["v-3", 2000],
  ]);
  assert.deepEqual(p.rows.map((r) => r.id), ["v-1", "v-3"]);
  assert.equal(p.problemas.length, 1);
});
