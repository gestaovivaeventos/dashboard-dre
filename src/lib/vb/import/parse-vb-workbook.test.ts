import assert from "node:assert/strict";
import { test } from "node:test";

import * as XLSX from "xlsx";

import { isoDateToExcelSerial } from "@/lib/vb/import/excel-date";
import { parseVbWorkbook } from "@/lib/vb/import/parse-vb-workbook";

const HEADER = ["DATA", "DATA", "DIAS", "DESCRIÇÃO", "ENTRADA", "SAÍDA", "RENDIMENTO", "SALDO", "TX "];

interface RowSpec {
  a?: string | number | null; // data início (ISO) ou serial cru
  b?: string | number | null; // data fim / data lançada
  c?: number | null;          // DIAS
  d?: string | null;          // descrição
  e?: number | null;          // entrada
  f?: number | null;          // saída
  g?: number | null;          // rendimento
  gFormula?: string;          // fórmula de G (sem "=")
  gError?: boolean;           // G = #REF!
  h?: number | null;          // saldo da planilha
  i?: number | null;          // taxa
}

function serial(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  return typeof v === "number" ? v : isoDateToExcelSerial(v);
}

function creditorSheet(name: string, rows: RowSpec[]): XLSX.WorkSheet {
  const aoa: unknown[][] = [[name], [], [], HEADER];
  for (const r of rows) {
    aoa.push([serial(r.a), serial(r.b), r.c ?? null, r.d ?? null, r.e ?? null, r.f ?? null, r.gError ? null : r.g ?? null, r.h ?? null, r.i ?? null]);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  rows.forEach((r, idx) => {
    const ref = `G${5 + idx}`;
    if (r.gError) ws[ref] = { t: "e", v: 0x17, w: "#REF!" };
    else if (r.gFormula && r.g != null) ws[ref] = { t: "n", v: r.g, f: r.gFormula };
  });
  return ws;
}

function workbook(sheets: Array<{ name: string; ws: XLSX.WorkSheet; hidden?: boolean }>): Uint8Array {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) XLSX.utils.book_append_sheet(wb, s.ws, s.name);
  wb.Workbook = { Sheets: sheets.map((s) => ({ name: s.name, Hidden: s.hidden ? 1 : 0 })) };
  return new Uint8Array(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

const PEDRO: RowSpec[] = [
  { a: "2017-08-07", b: "2017-08-07", c: 0, d: "APORTE", e: 40000, g: 0, h: 40000 },
  { a: "2017-08-08", b: "2018-05-01", c: 266, d: "RENDIMENTO", g: 3613.8951, gFormula: "FV(J6,C6,0,-H5)-H5", h: 43613.8951, i: 0.01 },
  { a: "2018-05-02", b: "2020-07-30", c: 0, d: "RESGATE", f: 37000, g: 0, h: 6613.8951, i: 0.0038 },
  { a: "2026-01-02", b: "2026-03-31", c: 88, d: "RENDIMENTO", g: 221.5652, gFormula: "H7*I8", h: 6835.4603, i: 0.0335 },
];

test("reconhece aba de credor, ignora as outras e aponta a vazia", () => {
  const data = workbook([
    { name: "Resumo", ws: XLSX.utils.aoa_to_sheet([["Saldo", 1]]) },
    { name: "Pedro P", ws: creditorSheet("Pedro P", PEDRO) },
    { name: "Mylliano", ws: creditorSheet("Mylliano", []) },
  ]);
  const parsed = parseVbWorkbook(data);
  assert.deepEqual(parsed.ignoredSheets, ["Resumo"]);
  assert.deepEqual(parsed.emptySheets, ["Mylliano"]);
  assert.equal(parsed.creditors.length, 1);
  assert.equal(parsed.creditors[0].name, "Pedro P");
  assert.equal(parsed.creditors[0].sheetName, "Pedro P");
  assert.equal(parsed.creditors[0].hidden, false);
});

test("linhas viram lançamentos com sinal, período, taxa e método", () => {
  const [pedro] = parseVbWorkbook(workbook([{ name: "Pedro P", ws: creditorSheet("Pedro P", PEDRO) }])).creditors;
  const [aporte, rend1, resgate, rend2] = pedro.entries;

  assert.equal(pedro.entries.length, 4);
  assert.deepEqual(
    { kind: aporte.kind, amount: aporte.amount, date: aporte.entryDate, sort: aporte.sortOrder, row: aporte.sourceRow },
    { kind: "entrada", amount: 40000, date: "2017-08-07", sort: 51, row: 5 },
  );
  assert.deepEqual(
    { kind: rend1.kind, amount: rend1.amount, start: rend1.periodStart, end: rend1.periodEnd, days: rend1.days, rate: rend1.rate, basis: rend1.rateBasis, sort: rend1.sortOrder },
    { kind: "rendimento", amount: 3613.9, start: "2017-08-08", end: "2018-05-01", days: 266, rate: 0.01, basis: "mensal", sort: 60 },
  );
  assert.deepEqual({ kind: resgate.kind, amount: resgate.amount }, { kind: "saida", amount: -37000 });
  assert.equal(rend2.rateBasis, "periodo");
  assert.equal(rend2.amount, 221.57);
  assert.equal(rend1.description, "RENDIMENTO");
  assert.equal(aporte.sheetBalance, 40000);
  assert.deepEqual(aporte.flags, []);
});

test("saldo da planilha × saldo somado", () => {
  const [pedro] = parseVbWorkbook(workbook([{ name: "Pedro P", ws: creditorSheet("Pedro P", PEDRO) }])).creditors;
  assert.equal(pedro.sheetFinalBalance, 6835.4603);
  assert.equal(pedro.computedFinalBalance, 6835.47);
  assert.equal(pedro.diff, 0.01);
  assert.equal(pedro.blockingCount, 0);
  assert.equal(pedro.warningCount, 0);
});

test("movimento e rendimento na mesma linha → dois lançamentos, rendimento primeiro", () => {
  const rows: RowSpec[] = [
    { a: "2020-09-01", b: "2020-09-01", d: "APORTE", e: 30000, h: 30000 },
    { a: "2020-09-02", b: "2020-10-20", c: 48, d: "DEPOSITO CONTA BB", f: 5000, g: 1398.4047, gFormula: "FV(J6,C6,0,-H5)-H5", h: 26398.4047, i: 0.0038 },
  ];
  const [c] = parseVbWorkbook(workbook([{ name: "Renato", ws: creditorSheet("Renato", rows) }])).creditors;
  assert.equal(c.entries.length, 3);
  assert.deepEqual(c.entries.map((e) => [e.kind, e.sortOrder]), [["entrada", 51], ["rendimento", 60], ["saida", 62]]);
  assert.equal(c.entries[1].sheetBalance, null);
  assert.equal(c.entries[2].sheetBalance, 26398.4047);
  assert.equal(c.entries[1].description, "DEPOSITO CONTA BB");
});

test("data B inválida usa A; as duas inválidas → data_invalida (bloqueante) com a data anterior", () => {
  const rows: RowSpec[] = [
    { a: "2024-06-11", b: "2024-06-11", d: "APORTE", e: 100, h: 100 },
    { a: 1, b: "2024-07-01", d: "PLR", e: 50, h: 150 },          // A = 01/01/1900, B válida
    { a: 1, b: null, d: "SAQUE", f: 20, h: 130 },                // nenhuma válida
  ];
  const [c] = parseVbWorkbook(workbook([{ name: "Maria Ap", ws: creditorSheet("Maria Ap", rows) }])).creditors;
  assert.equal(c.entries[1].entryDate, "2024-07-01");
  assert.deepEqual(c.entries[1].flags, []);
  assert.equal(c.entries[2].entryDate, "2024-07-01");
  assert.deepEqual(c.entries[2].flags, ["data_invalida"]);
  assert.equal(c.blockingCount, 1);
});

test("período do rendimento: A inválida ou A > B → inferido do lançamento anterior", () => {
  const rows: RowSpec[] = [
    { a: "2021-06-01", b: "2021-06-30", d: "RENDIMENTO", g: 10, gFormula: "FV(J5,C5,0,-H4)-H4", h: 10, i: 0.005 },
    { a: 1, b: "2021-07-31", c: 30, d: "RENDIMENTO", g: 10, h: 20, i: 0.005 },
    { a: "2021-09-01", b: "2021-08-15", c: -17, d: "RENDIMENTO", g: -5, h: 15, i: 0.005 },
  ];
  const [c] = parseVbWorkbook(workbook([{ name: "Mirai", ws: creditorSheet("Mirai", rows) }])).creditors;
  assert.deepEqual([c.entries[1].periodStart, c.entries[1].periodEnd, c.entries[1].days], ["2021-07-01", "2021-07-31", 30]);
  assert.deepEqual(c.entries[1].flags, ["periodo_inferido"]);
  // A > B: começa no dia seguinte ao anterior (01/08), termina em 15/08
  assert.deepEqual([c.entries[2].periodStart, c.entries[2].periodEnd, c.entries[2].days], ["2021-08-01", "2021-08-15", 14]);
  assert.ok(c.entries[2].flags.includes("periodo_inferido"));
  assert.ok(c.entries[2].flags.includes("dias_divergentes"));
  assert.equal(c.entries[2].rateBasis, "ajuste"); // sem fórmula
});

test("avisos: conferir, sem descrição, entrada e saída juntas, fora de ordem; rendimento zero é pulado", () => {
  const rows: RowSpec[] = [
    { a: "2023-02-23", b: "2023-02-23", d: "VENDA APTO CONFERIR VALOR", e: 915000, h: 915000 },
    { a: "2023-02-24", b: "2023-02-24", e: 10, f: 5, h: 915005 },
    { a: "2023-02-25", b: "2023-03-01", c: 5, d: "RENDIMENTO", g: 0.001, h: 915005 },
    { a: "2023-03-02", b: "2023-03-02", d: "OK", h: 915005 },
    { a: "2023-02-20", b: "2023-02-20", d: "ATRASADO", e: 1, h: 915006 },
  ];
  const [c] = parseVbWorkbook(workbook([{ name: "Renato", ws: creditorSheet("Renato", rows) }])).creditors;
  assert.deepEqual(c.entries[0].flags, ["conferir"]);
  assert.deepEqual(c.entries[1].flags, ["entrada_e_saida", "sem_descricao"]);
  assert.equal(c.entries[1].description, "(sem descrição)");
  assert.deepEqual(c.entries[2].flags, ["entrada_e_saida", "sem_descricao"]);
  assert.deepEqual(c.entries[3].flags, ["fora_de_ordem"]);
  assert.equal(c.entries.length, 4);
  assert.deepEqual(c.skippedRows, [
    { row: 7, reason: "rendimento_zero" },
    { row: 8, reason: "linha_sem_valor" },
  ]);
  assert.equal(c.warningCount, 4);
});

test("célula de erro (#REF!) em RENDIMENTO → valor_invalido, bloqueante", () => {
  const rows: RowSpec[] = [
    { a: "2024-01-01", b: "2024-01-01", d: "APORTE", e: 100, h: 100 },
    { a: "2024-01-02", b: "2024-01-31", d: "RENDIMENTO", gError: true, h: 100 },
  ];
  const [c] = parseVbWorkbook(workbook([{ name: "X", ws: creditorSheet("X", rows) }])).creditors;
  assert.equal(c.entries[1].kind, "rendimento");
  assert.equal(c.entries[1].amount, 0);
  assert.deepEqual(c.entries[1].flags, ["valor_invalido"]);
  assert.equal(c.blockingCount, 1);
});

test("aba oculta → hidden true; nome vem de A1, com fallback no nome da aba", () => {
  const ws = creditorSheet("Fabio", [{ a: "2017-02-23", b: "2017-02-23", d: "APORTE", e: 15000, h: 15000 }]);
  const noName = creditorSheet("", [{ a: "2017-02-23", b: "2017-02-23", d: "APORTE", e: 1, h: 1 }]);
  delete noName.A1;
  const parsed = parseVbWorkbook(workbook([
    { name: "Fabio", ws, hidden: true },
    { name: "Renan", ws: noName },
  ]));
  assert.equal(parsed.creditors[0].hidden, true);
  assert.equal(parsed.creditors[1].name, "Renan");
  assert.equal(parsed.creditors[1].hidden, false);
});

test("arquivo que não é planilha lança", () => {
  assert.throws(() => parseVbWorkbook(new Uint8Array([1, 2, 3, 4])));
});
