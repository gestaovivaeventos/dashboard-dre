// Parser da planilha VB ("VB TERRAZZO"). Função pura: recebe os bytes do .xlsx
// e devolve, por aba de credor, os lançamentos já classificados e com alertas.
// Não toca banco nem sessão — o route handler de importação e o script
// scripts/vb-parse-check.ts consomem o resultado.
//
// Layout de cada aba de credor (ver docs/superpowers/specs/2026-09-09-vb-viva-bank-design.md §6):
//   A1 = nome do credor
//   linha 4 = DATA | DATA | DIAS | DESCRIÇÃO | ENTRADA | SAÍDA | RENDIMENTO | SALDO | TX
//   linha 5+ = lançamentos. A = início do período (fórmula =B(anterior)+1 na
//   maioria das linhas → 01/01/1900 quando aponta célula vazia), B = data
//   lançada / fim do período, G = rendimento (fórmula FV → taxa mensal
//   capitalizada por dia; H*I → saldo × taxa do período; literal → ajuste).

import * as XLSX from "xlsx";

import { addDaysIso, diffDaysIso, excelSerialToIsoDate } from "@/lib/vb/import/excel-date";
import { fromCents, roundCents, sumCents } from "@/lib/vb/money";
import { isBlockingFlag, type VbEntryFlag, type VbEntryKind, type VbRateBasis } from "@/lib/vb/types";

export interface ParsedEntry {
  sourceRow: number;
  /** linha × 10 + sub (0 rendimento, 1 entrada, 2 saída) — ordem da planilha. */
  sortOrder: number;
  entryDate: string;
  kind: VbEntryKind;
  amount: number;
  description: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  days: number | null;
  rate: number | null;
  rateBasis: VbRateBasis | null;
  /** SALDO da planilha na linha; só no último lançamento gerado pela linha. */
  sheetBalance: number | null;
  flags: VbEntryFlag[];
}

export interface SkippedRow {
  row: number;
  reason: "linha_sem_valor" | "rendimento_zero";
}

export interface ParsedCreditor {
  sheetName: string;
  name: string;
  hidden: boolean;
  entries: ParsedEntry[];
  skippedRows: SkippedRow[];
  sheetFinalBalance: number | null;
  computedFinalBalance: number;
  diff: number | null;
  blockingCount: number;
  warningCount: number;
}

export interface ParsedWorkbook {
  creditors: ParsedCreditor[];
  emptySheets: string[];
  ignoredSheets: string[];
}

const HEADER_ROW = 4;
const FIRST_DATA_ROW = 5;
const EXPECTED_HEADERS = ["DATA", "DATA", "DIAS", "DESCRICAO", "ENTRADA", "SAIDA", "RENDIMENTO", "SALDO"];
const HEADER_COLS = ["A", "B", "C", "D", "E", "F", "G", "H"];
const COL = {
  start: "A",
  end: "B",
  days: "C",
  desc: "D",
  in: "E",
  out: "F",
  yield: "G",
  balance: "H",
  rate: "I",
} as const;
/** Sem nenhuma data válida e sem lançamento anterior; o gestor corrige na revisão. */
const FALLBACK_DATE = "1900-01-01";

type Cell = XLSX.CellObject | undefined;

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function cellAt(ws: XLSX.WorkSheet, col: string, row: number): Cell {
  return ws[`${col}${row}`] as Cell;
}

function numberOf(cell: Cell): number | null {
  if (!cell || cell.t !== "n") return null;
  return typeof cell.v === "number" && Number.isFinite(cell.v) ? cell.v : null;
}

function isErrorCell(cell: Cell): boolean {
  return Boolean(cell && cell.t === "e");
}

function textOf(cell: Cell): string | null {
  if (!cell || cell.v == null) return null;
  const s = String(cell.v).trim();
  return s.length > 0 ? s : null;
}

function isCreditorSheet(ws: XLSX.WorkSheet): boolean {
  return HEADER_COLS.every(
    (col, i) => normalizeHeader(cellAt(ws, col, HEADER_ROW)?.v) === EXPECTED_HEADERS[i],
  );
}

function isHiddenSheet(wb: XLSX.WorkBook, sheetName: string): boolean {
  const meta = wb.Workbook?.Sheets?.find((s) => s.name === sheetName);
  return (meta?.Hidden ?? 0) !== 0;
}

function lastRow(ws: XLSX.WorkSheet): number {
  const ref = ws["!ref"];
  if (!ref) return 0;
  return XLSX.utils.decode_range(ref).e.r + 1;
}

/** Método do juro pela fórmula de G. Sem fórmula (valor digitado) = ajuste. */
function rateBasisFromFormula(formula: string | undefined): VbRateBasis {
  if (!formula) return "ajuste";
  const f = formula.replace(/\$/g, "").replace(/\s+/g, "").toUpperCase();
  if (/FV\(/.test(f)) return "mensal";
  if (/^[A-Z]{1,2}\d+\*[A-Z]{1,2}\d+$/.test(f)) return "periodo";
  return "ajuste";
}

function parseCreditorSheet(wb: XLSX.WorkBook, sheetName: string): ParsedCreditor | null {
  const ws = wb.Sheets[sheetName];
  const name = textOf(cellAt(ws, "A", 1)) ?? sheetName;
  const entries: ParsedEntry[] = [];
  const skippedRows: SkippedRow[] = [];
  let sheetFinalBalance: number | null = null;
  // Data do último lançamento em ordem de planilha: fecha o período do próximo
  // rendimento quando A é inválida e detecta linhas fora de ordem.
  let prevDate: string | null = null;
  const end = lastRow(ws);

  for (let row = FIRST_DATA_ROW; row <= end; row++) {
    const desc = textOf(cellAt(ws, COL.desc, row));
    const inCell = cellAt(ws, COL.in, row);
    const outCell = cellAt(ws, COL.out, row);
    const yieldCell = cellAt(ws, COL.yield, row);
    const inVal = numberOf(inCell) ?? 0;
    const outVal = numberOf(outCell) ?? 0;
    const yieldVal = numberOf(yieldCell) ?? 0;
    const anyError = isErrorCell(inCell) || isErrorCell(outCell) || isErrorCell(yieldCell);

    // Linha real vs. preenchimento vazio da planilha (A=anterior+1, C=-1, H=anterior).
    const isReal = desc !== null || inVal !== 0 || outVal !== 0 || yieldVal !== 0 || anyError;
    if (!isReal) continue;

    const balance = numberOf(cellAt(ws, COL.balance, row));
    if (balance !== null) sheetFinalBalance = balance;

    const endDate = excelSerialToIsoDate(cellAt(ws, COL.end, row)?.v);
    const startDate = excelSerialToIsoDate(cellAt(ws, COL.start, row)?.v);
    const rowFlags: VbEntryFlag[] = [];
    let entryDate = endDate ?? startDate;
    let dateInvalid = false;
    if (!entryDate) {
      entryDate = prevDate ?? FALLBACK_DATE;
      dateInvalid = true;
      rowFlags.push("data_invalida");
    }
    if (!dateInvalid && prevDate && entryDate < prevDate) rowFlags.push("fora_de_ordem");
    if (desc && /CONFERIR/i.test(desc)) rowFlags.push("conferir");

    const rowEntries: ParsedEntry[] = [];

    // ── Rendimento ──────────────────────────────────────────────────────
    // Qualquer G ≠ 0 conta; o que arredonda para 0,00 é pulado como rendimento_zero.
    const hasYield = isErrorCell(yieldCell) || yieldVal !== 0;
    if (hasYield) {
      const amount = isErrorCell(yieldCell) ? 0 : roundCents(yieldVal);
      if (!isErrorCell(yieldCell) && amount === 0) {
        skippedRows.push({ row, reason: "rendimento_zero" });
      } else {
        const flags: VbEntryFlag[] = [...rowFlags];
        if (isErrorCell(yieldCell)) flags.push("valor_invalido");
        let periodStart: string;
        if (startDate && startDate <= entryDate) {
          periodStart = startDate;
        } else {
          const candidate = prevDate ? addDaysIso(prevDate, 1) : entryDate;
          periodStart = candidate <= entryDate ? candidate : entryDate;
          flags.push("periodo_inferido");
        }
        const days = diffDaysIso(periodStart, entryDate);
        const sheetDays = numberOf(cellAt(ws, COL.days, row));
        if (sheetDays !== null && Math.round(sheetDays) !== days) flags.push("dias_divergentes");
        rowEntries.push({
          sourceRow: row,
          sortOrder: row * 10,
          entryDate,
          kind: "rendimento",
          amount,
          description: desc ?? "Rendimento",
          periodStart,
          periodEnd: entryDate,
          days,
          rate: numberOf(cellAt(ws, COL.rate, row)),
          rateBasis: rateBasisFromFormula(yieldCell?.f),
          sheetBalance: null,
          flags,
        });
      }
    }

    // ── Movimentos ──────────────────────────────────────────────────────
    const movementFlags: VbEntryFlag[] = [...rowFlags];
    const hasIn = inVal !== 0 || isErrorCell(inCell);
    const hasOut = outVal !== 0 || isErrorCell(outCell);
    if (hasIn && hasOut) movementFlags.push("entrada_e_saida");
    if ((hasIn || hasOut) && !desc) movementFlags.push("sem_descricao");
    const movementDesc = desc ?? "(sem descrição)";

    if (hasIn) {
      const amount = isErrorCell(inCell) ? 0 : roundCents(inVal);
      const flags: VbEntryFlag[] = [...movementFlags];
      if (isErrorCell(inCell) || amount <= 0) flags.push("valor_invalido");
      rowEntries.push({
        sourceRow: row,
        sortOrder: row * 10 + 1,
        entryDate,
        kind: "entrada",
        amount,
        description: movementDesc,
        periodStart: null,
        periodEnd: null,
        days: null,
        rate: null,
        rateBasis: null,
        sheetBalance: null,
        flags,
      });
    }
    if (hasOut) {
      const amount = isErrorCell(outCell) ? 0 : -roundCents(outVal);
      const flags: VbEntryFlag[] = [...movementFlags];
      if (isErrorCell(outCell) || amount >= 0) flags.push("valor_invalido");
      rowEntries.push({
        sourceRow: row,
        sortOrder: row * 10 + 2,
        entryDate,
        kind: "saida",
        amount,
        description: movementDesc,
        periodStart: null,
        periodEnd: null,
        days: null,
        rate: null,
        rateBasis: null,
        sheetBalance: null,
        flags,
      });
    }

    if (rowEntries.length === 0) {
      if (!hasYield) skippedRows.push({ row, reason: "linha_sem_valor" });
    } else {
      rowEntries[rowEntries.length - 1].sheetBalance = balance;
      entries.push(...rowEntries);
    }
    if (!dateInvalid) prevDate = entryDate;
  }

  if (entries.length === 0 && skippedRows.length === 0) return null;

  const computedFinalBalance = fromCents(sumCents(entries.map((e) => e.amount)));
  const diff = sheetFinalBalance === null ? null : roundCents(computedFinalBalance - sheetFinalBalance);
  const blockingCount = entries.filter((e) => e.flags.some(isBlockingFlag)).length;
  const warningCount = entries.filter(
    (e) => e.flags.length > 0 && !e.flags.some(isBlockingFlag),
  ).length;

  return {
    sheetName,
    name,
    hidden: isHiddenSheet(wb, sheetName),
    entries,
    skippedRows,
    sheetFinalBalance,
    computedFinalBalance,
    diff,
    blockingCount,
    warningCount,
  };
}

/**
 * Todo .xlsx é um contêiner ZIP e começa com "PK\x03\x04". Sem essa checagem o
 * SheetJS aceita bytes arbitrários como texto/CSV e devolve uma aba fantasma
 * ("Sheet1") em vez de lançar.
 */
function isZipSignature(data: Uint8Array): boolean {
  return (
    data.length >= 4 && data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04
  );
}

/**
 * Lê o .xlsx inteiro. Lança só quando o arquivo não é uma planilha legível;
 * problema de conteúdo vira flag no lançamento, nunca exceção.
 */
export function parseVbWorkbook(data: Uint8Array): ParsedWorkbook {
  if (!isZipSignature(data)) {
    throw new Error("Arquivo inválido: não é uma planilha .xlsx legível.");
  }
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(data, { type: "array", cellDates: false });
  } catch {
    throw new Error("Arquivo inválido: não é uma planilha .xlsx legível.");
  }
  if (!wb.SheetNames || wb.SheetNames.length === 0) {
    throw new Error("Arquivo inválido: planilha sem abas.");
  }
  const result: ParsedWorkbook = { creditors: [], emptySheets: [], ignoredSheets: [] };

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws || !isCreditorSheet(ws)) {
      result.ignoredSheets.push(sheetName);
      continue;
    }
    const creditor = parseCreditorSheet(wb, sheetName);
    if (!creditor) {
      result.emptySheets.push(sheetName);
      continue;
    }
    result.creditors.push(creditor);
  }

  return result;
}
