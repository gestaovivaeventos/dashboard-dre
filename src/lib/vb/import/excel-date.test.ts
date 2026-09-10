import assert from "node:assert/strict";
import { test } from "node:test";

import {
  addDaysIso,
  diffDaysIso,
  excelSerialToIsoDate,
  isoDateToExcelSerial,
} from "@/lib/vb/import/excel-date";

test("serial Excel → ISO (pares conhecidos)", () => {
  assert.equal(excelSerialToIsoDate(25569), "1970-01-01");
  assert.equal(excelSerialToIsoDate(43831), "2020-01-01");
  assert.equal(excelSerialToIsoDate(42954), "2017-08-07");
  assert.equal(excelSerialToIsoDate(42954.75), "2017-08-07"); // hora é ignorada
});

test("serial inválido (01/01/1900, vazio, texto) → null", () => {
  assert.equal(excelSerialToIsoDate(1), null);
  assert.equal(excelSerialToIsoDate(999), null);
  assert.equal(excelSerialToIsoDate(undefined), null);
  assert.equal(excelSerialToIsoDate("2017-08-07"), null);
  assert.equal(excelSerialToIsoDate(Number.NaN), null);
});

test("ISO → serial é o inverso", () => {
  assert.equal(isoDateToExcelSerial("2017-08-07"), 42954);
  assert.equal(excelSerialToIsoDate(isoDateToExcelSerial("2026-06-30")), "2026-06-30");
});

test("addDaysIso e diffDaysIso (convenção DIAS = fim - início)", () => {
  assert.equal(addDaysIso("2026-06-30", 1), "2026-07-01");
  assert.equal(addDaysIso("2024-02-28", 1), "2024-02-29");
  assert.equal(diffDaysIso("2026-01-02", "2026-03-31"), 88);
  assert.equal(diffDaysIso("2017-08-08", "2018-05-01"), 266);
  assert.equal(diffDaysIso("2026-01-01", "2026-01-01"), 0);
});
