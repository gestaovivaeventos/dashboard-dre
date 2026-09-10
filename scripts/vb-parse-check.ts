// Confere o parser do VB contra a planilha real (sem tocar o banco):
//
//   npx tsx scripts/vb-parse-check.ts ["docs/VB TERRAZZO V2.xlsx"]
//
// Imprime, por credor, lançamentos, saldo da planilha × saldo somado, diferença
// e alertas. Sai com código 1 se algum credor estourar a tolerância de
// arredondamento (VB_BALANCE_TOLERANCE) ou tiver alerta bloqueante.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parseVbWorkbook } from "../src/lib/vb/import/parse-vb-workbook";
import { VB_BALANCE_TOLERANCE, isBlockingFlag } from "../src/lib/vb/types";

const file = resolve(process.argv[2] ?? "docs/VB TERRAZZO V2.xlsx");
const parsed = parseVbWorkbook(new Uint8Array(readFileSync(file)));

const brl = (v: number | null) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

let failed = false;
console.log(`Arquivo: ${file}`);
console.log(`Abas ignoradas: ${parsed.ignoredSheets.join(", ") || "—"}`);
console.log(`Abas vazias: ${parsed.emptySheets.join(", ") || "—"}`);
console.log("");

for (const c of parsed.creditors) {
  const flagCounts = new Map<string, number>();
  for (const e of c.entries) for (const f of e.flags) flagCounts.set(f, (flagCounts.get(f) ?? 0) + 1);
  const flags = Array.from(flagCounts.entries()).map(([f, n]) => `${f}×${n}${isBlockingFlag(f) ? "!" : ""}`).join(" ");
  const overTolerance = c.diff !== null && Math.abs(c.diff) > VB_BALANCE_TOLERANCE;
  if (overTolerance || c.blockingCount > 0) failed = true;
  console.log(
    `${c.name.padEnd(22)} ${c.hidden ? "(oculta) " : "         "}` +
      `lanç=${String(c.entries.length).padStart(4)} puladas=${String(c.skippedRows.length).padStart(2)} ` +
      `planilha=${brl(c.sheetFinalBalance).padStart(14)} sistema=${brl(c.computedFinalBalance).padStart(14)} ` +
      `diff=${brl(c.diff).padStart(8)}${overTolerance ? " !!" : "   "} ${flags}`,
  );
}

const total = parsed.creditors.filter((c) => !c.hidden).reduce((acc, c) => acc + c.computedFinalBalance, 0);
console.log("");
console.log(`Saldo total (abas visíveis): ${brl(total)}`);
process.exit(failed ? 1 : 0);
