import { getGoogleSheetsAccessToken } from "@/lib/sheets/google-auth";

const SHEETS_API_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

export type SheetCellValue = string | number | boolean | null;
export type SheetRow = SheetCellValue[];

/**
 * Le um range da planilha via `spreadsheets.values.get`.
 * Retorna a matriz crua de valores (sem formatacao).
 *
 * - `valueRenderOption=UNFORMATTED_VALUE` → numeros vem como number nativo
 *   (sem virgula/ponto BR), datas vem como serial number.
 * - `dateTimeRenderOption=SERIAL_NUMBER` → datas como inteiro (dias desde
 *   1899-12-30, padrao Sheets/Excel). Converta com `sheetSerialToDate`.
 */
export async function fetchSheetValues(
  spreadsheetId: string,
  range: string,
): Promise<SheetRow[]> {
  const token = await getGoogleSheetsAccessToken();
  const url = new URL(
    `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`,
  );
  url.searchParams.set("valueRenderOption", "UNFORMATTED_VALUE");
  url.searchParams.set("dateTimeRenderOption", "SERIAL_NUMBER");

  const response = await fetch(url.toString(), {
    headers: { authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Sheets API ${response.status} ao buscar ${spreadsheetId} ${range}: ${body}`,
    );
  }

  const payload = (await response.json()) as { values?: SheetRow[] };
  return payload.values ?? [];
}

/**
 * Resolve o titulo de uma aba pelo gid (`sheetId` na API). O gid aparece na
 * URL (`#gid=...`) e sobrevive a renomeacao da aba — prefira-o quando a
 * origem for um link de planilha.
 */
export async function fetchSheetTabTitleByGid(
  spreadsheetId: string,
  gid: number,
): Promise<string> {
  const token = await getGoogleSheetsAccessToken();
  const url = `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties`;

  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Sheets API ${response.status} ao buscar metadata de ${spreadsheetId}: ${body}`,
    );
  }

  const payload = (await response.json()) as {
    sheets?: Array<{ properties?: { sheetId?: number; title?: string } }>;
  };
  const match = (payload.sheets ?? []).find(
    (s) => s.properties?.sheetId === gid,
  );
  if (!match?.properties?.title) {
    throw new Error(
      `Aba com gid=${gid} nao encontrada na planilha ${spreadsheetId}`,
    );
  }
  return match.properties.title;
}

/**
 * Converte serial number do Sheets (dias desde 1899-12-30) em Date UTC.
 * Sheets / Excel usam o mesmo epoch — exceto pelo bug do "1900 e bissexto"
 * que afeta seriais <= 60, irrelevante para datas modernas.
 */
export function sheetSerialToDate(serial: number): Date {
  // Epoch Sheets: 1899-12-30 00:00 UTC. + serial dias = data alvo.
  const epochMs = Date.UTC(1899, 11, 30);
  return new Date(epochMs + serial * 86_400_000);
}
