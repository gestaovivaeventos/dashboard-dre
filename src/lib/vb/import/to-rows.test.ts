import assert from "node:assert/strict";
import { test } from "node:test";

import type { ParsedCreditor } from "@/lib/vb/import/parse-vb-workbook";
import { toEntryRows } from "@/lib/vb/import/to-rows";

const CREDITOR: ParsedCreditor = {
  sheetName: "Pedro P",
  name: "Pedro P",
  hidden: false,
  entries: [
    { sourceRow: 5, sortOrder: 51, entryDate: "2017-08-07", kind: "entrada", amount: 40000, description: "APORTE", periodStart: null, periodEnd: null, days: null, rate: null, rateBasis: null, sheetBalance: 40000, flags: [] },
    { sourceRow: 6, sortOrder: 60, entryDate: "2018-05-01", kind: "rendimento", amount: 3613.9, description: "RENDIMENTO", periodStart: "2017-08-08", periodEnd: "2018-05-01", days: 266, rate: 0.01, rateBasis: "mensal", sheetBalance: 43613.8951, flags: ["conferir"] },
  ],
  skippedRows: [],
  sheetFinalBalance: 43613.8951,
  computedFinalBalance: 43613.9,
  diff: 0,
  blockingCount: 0,
  warningCount: 1,
};

test("toEntryRows: uma linha de vb_entries por lançamento, pendente e ligada ao lote", () => {
  const rows = toEntryRows(CREDITOR, { creditorId: "c1", batchId: "b1", userId: "u1" });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    creditor_id: "c1",
    entry_date: "2017-08-07",
    kind: "entrada",
    amount: 40000,
    description: "APORTE",
    period_start: null,
    period_end: null,
    days: null,
    rate: null,
    rate_basis: null,
    status: "pendente",
    import_batch_id: "b1",
    source_row: 5,
    sheet_balance: 40000,
    sort_order: 51,
    flags: [],
    created_by: "u1",
  });
  assert.equal(rows[1].rate_basis, "mensal");
  assert.deepEqual(rows[1].flags, ["conferir"]);
  assert.equal(rows[1].period_start, "2017-08-08");
});
