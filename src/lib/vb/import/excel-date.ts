// Datas da planilha chegam como serial do Excel (dias desde 30/12/1899). O
// SheetJS é lido com cellDates:false de propósito: converter aqui, em UTC,
// evita o dia "pular" por fuso horário.

const MS_PER_DAY = 86_400_000;
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);

/**
 * Abaixo disso é lixo de fórmula: `=B(anterior)+1` apontando célula vazia vira
 * serial 1 (01/01/1900). Nada no VB é anterior a 1902.
 */
export const MIN_VALID_SERIAL = 1000;

export function excelSerialToIsoDate(serial: unknown): string | null {
  if (typeof serial !== "number" || !Number.isFinite(serial)) return null;
  if (serial < MIN_VALID_SERIAL) return null;
  return new Date(EXCEL_EPOCH_UTC + Math.floor(serial) * MS_PER_DAY)
    .toISOString()
    .slice(0, 10);
}

export function isoDateToExcelSerial(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - EXCEL_EPOCH_UTC) / MS_PER_DAY);
}

export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/** `b - a` em dias de calendário — a convenção da coluna DIAS da planilha. */
export function diffDaysIso(a: string, b: string): number {
  const [ya, ma, da] = a.split("-").map(Number);
  const [yb, mb, db] = b.split("-").map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / MS_PER_DAY);
}
