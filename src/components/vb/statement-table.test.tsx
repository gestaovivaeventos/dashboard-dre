import assert from "node:assert/strict";
import { test } from "node:test";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { VbStatementTable, type StatementRow } from "@/components/vb/statement-table";

function row(id: string, entry_date: string, kind: StatementRow["kind"], amount: number, balance: number, flags: StatementRow["flags"] = []): StatementRow {
  return {
    id, creditor_id: "c1", entry_date, kind, amount, description: `Lançamento ${id}`,
    period_start: null, period_end: null, days: null, rate: null, rate_basis: null,
    status: "aprovado", import_batch_id: null, source_row: 42, sheet_balance: 999999,
    sort_order: 0, flags, created_by: null, created_at: "2026-09-10T00:00:00Z", updated_at: "2026-09-10T00:00:00Z",
    balance,
  };
}

const ROWS = [
  row("a", "2017-01-01", "entrada", 100, 100),
  row("b", "2020-05-05", "saida", -30, 70),
  row("c", "2026-03-31", "rendimento", 5, 75, ["conferir"]),
];

test("exibe do mais recente para o mais antigo, com separadores por ano", () => {
  const html = renderToStaticMarkup(<VbStatementTable rows={ROWS} yearSeparators />);
  const newest = html.indexOf("31/03/2026");
  const middle = html.indexOf("05/05/2020");
  const oldest = html.indexOf("01/01/2017");
  assert.ok(newest > -1 && middle > -1 && oldest > -1);
  assert.ok(newest < middle && middle < oldest);
  assert.ok(html.indexOf(">2026<") < html.indexOf(">2017<"));
});

test("não menciona planilha nem linha de origem", () => {
  const html = renderToStaticMarkup(<VbStatementTable rows={ROWS} showFlags />);
  assert.doesNotMatch(html, /planilha/i);
  assert.doesNotMatch(html, /L42|999\.999/);
  assert.match(html, /Marcado para conferir/);
});
