import { createAdminClient } from "@/lib/supabase/admin";
import {
  fetchSheetValues,
  sheetSerialToDate,
  type SheetCellValue,
  type SheetRow,
} from "@/lib/sheets/client";

// ===========================================================================
// Configuracao do mapeamento Sheets → DRE
// ===========================================================================
// Cada coluna da planilha de eventos da Feat alimenta exatamente uma conta
// DRE do plano custom da Feat Producoes. O code identifica a conta dentro
// do plano da Feat (resolvido em runtime para o uuid via dre_accounts).
//
// Indices sao 0-based (column A = 0, B = 1, ..., O = 14).
// ===========================================================================
const COMPANY_NAME = "Feat Producoes";
const DATE_COLUMN_INDEX = 1; // B

interface SheetColumnMapping {
  /** Index 0-based da coluna no spreadsheet. */
  columnIndex: number;
  /** Letra da coluna, so para logs. */
  columnLetter: string;
  /** Code da conta DRE no plano da Feat Producoes. */
  accountCode: string;
}

const COLUMN_MAPPINGS: SheetColumnMapping[] = [
  { columnIndex: 8,  columnLetter: "I", accountCode: "1.1" },  // Resultado dos eventos
  { columnIndex: 10, columnLetter: "K", accountCode: "3.1" },  // ISS
  { columnIndex: 11, columnLetter: "L", accountCode: "9" },    // IRPJ
  { columnIndex: 12, columnLetter: "M", accountCode: "10" },   // CSLL → Contribuicao Social
  { columnIndex: 13, columnLetter: "N", accountCode: "3.3" },  // COFINS
  { columnIndex: 14, columnLetter: "O", accountCode: "3.2" },  // PIS
];

// ===========================================================================
// Tipos publicos
// ===========================================================================
export interface FeatSheetSyncResult {
  spreadsheetId: string;
  range: string;
  rowsRead: number;
  rowsSkipped: number;
  periodsUpserted: number;
  upsertedPeriods: Array<{ ano: number; mes: number; accountCount: number }>;
  warnings: string[];
}

// ===========================================================================
// Helpers de parsing
// ===========================================================================
function parseNumericValue(cell: SheetCellValue): number {
  // Com valueRenderOption=UNFORMATTED_VALUE, numeros vem nativos. Strings
  // vazias ou nao numericas → 0. Formato BR "1.234,56" so apareceria se a
  // celula fosse texto puro — neste sheet os valores sao formulas numericas.
  if (typeof cell === "number" && Number.isFinite(cell)) return cell;
  if (typeof cell === "string") {
    const trimmed = cell.trim();
    if (!trimmed || trimmed === "-") return 0;
    // Tentativa de parse BR-format ("1.234,56" ou "(1.234,56)"): remove
    // pontos de milhar, troca virgula por ponto, interpreta parenteses
    // como negativo.
    const isNegative = /^\(.*\)$/.test(trimmed);
    const inner = isNegative ? trimmed.slice(1, -1) : trimmed;
    const normalized = inner.replace(/\./g, "").replace(/,/g, ".");
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) return 0;
    return isNegative ? -parsed : parsed;
  }
  return 0;
}

function parseDateCell(cell: SheetCellValue): Date | null {
  if (typeof cell === "number" && Number.isFinite(cell) && cell > 0) {
    return sheetSerialToDate(cell);
  }
  if (typeof cell === "string") {
    const match = cell.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (match) {
      const [, dd, mm, yyyy] = match;
      return new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
    }
  }
  return null;
}

// ===========================================================================
// Agregacao por (ano, mes, conta)
// ===========================================================================
function aggregateRows(rows: SheetRow[]): {
  byKey: Map<string, number>;
  rowsRead: number;
  rowsSkipped: number;
  warnings: string[];
} {
  const byKey = new Map<string, number>();
  const warnings: string[] = [];
  let rowsRead = 0;
  let rowsSkipped = 0;

  // Pula a linha 1 (headers).
  rows.slice(1).forEach((row, idx) => {
    const rowNumber = idx + 2;
    const dateCell = row[DATE_COLUMN_INDEX];
    const date = parseDateCell(dateCell);
    if (!date) {
      // Linhas sem data sao geralmente espacadores ou rascunhos — apenas
      // pula em silencio.
      rowsSkipped += 1;
      return;
    }
    const ano = date.getUTCFullYear();
    const mes = date.getUTCMonth() + 1;
    if (ano < 2020 || ano > 2099) {
      warnings.push(`Linha ${rowNumber}: ano fora do range esperado (${ano}).`);
      rowsSkipped += 1;
      return;
    }

    rowsRead += 1;

    COLUMN_MAPPINGS.forEach((mapping) => {
      const value = parseNumericValue(row[mapping.columnIndex]);
      if (value === 0) return;
      const key = `${ano}-${mes}-${mapping.accountCode}`;
      byKey.set(key, (byKey.get(key) ?? 0) + value);
    });
  });

  return { byKey, rowsRead, rowsSkipped, warnings };
}

// ===========================================================================
// Sync principal
// ===========================================================================
export async function syncFeatSheetsToManualValues(): Promise<FeatSheetSyncResult> {
  const spreadsheetId = process.env.FEAT_PRODUCOES_SHEET_ID;
  const tabName = process.env.FEAT_PRODUCOES_SHEET_TAB;
  if (!spreadsheetId) {
    throw new Error("FEAT_PRODUCOES_SHEET_ID nao configurada.");
  }
  if (!tabName) {
    throw new Error(
      "FEAT_PRODUCOES_SHEET_TAB nao configurada (nome da aba dentro do workbook).",
    );
  }

  // Em notacao A1 do Sheets, nomes de aba com qualquer caractere fora de
  // [A-Za-z0-9_] (acentos, espacos, cedilha) precisam ser envolvidos em aspas
  // simples; aspas simples dentro do nome viram '' duplicadas.
  const quotedTab = `'${tabName.replace(/'/g, "''")}'`;
  const range = `${quotedTab}!A:O`;
  const rows = await fetchSheetValues(spreadsheetId, range);
  const { byKey, rowsRead, rowsSkipped, warnings } = aggregateRows(rows);

  // ----- Resolve company_id + dre_account_ids -----
  const supabase = createAdminClient();

  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("id")
    .eq("name", COMPANY_NAME)
    .maybeSingle();
  if (companyError || !company) {
    throw new Error(
      `Empresa "${COMPANY_NAME}" nao encontrada no banco: ${companyError?.message ?? "sem registro"}.`,
    );
  }
  const companyId = company.id as string;

  const accountCodes = COLUMN_MAPPINGS.map((m) => m.accountCode);
  const { data: accountsData, error: accountsError } = await supabase
    .from("dre_accounts")
    .select("id,code,data_source")
    .eq("company_id", companyId)
    .in("code", accountCodes);

  if (accountsError) {
    throw new Error(
      `Falha ao carregar contas DRE da Feat Producoes: ${accountsError.message}`,
    );
  }

  const accountIdByCode = new Map<string, string>();
  (accountsData ?? []).forEach((row) => {
    accountIdByCode.set(row.code as string, row.id as string);
    if (row.data_source !== "sheets") {
      warnings.push(
        `Conta ${row.code} esta marcada como data_source='${row.data_source}' — esperado 'sheets'. Valores nao aparecerao no DRE ate corrigir.`,
      );
    }
  });

  for (const code of accountCodes) {
    if (!accountIdByCode.has(code)) {
      throw new Error(
        `Conta DRE com code '${code}' nao encontrada no plano da Feat Producoes — rode a migration 20260529120000_feat_dre_plan primeiro.`,
      );
    }
  }

  // ----- Constroi linhas de upsert -----
  interface Upsert {
    company_id: string;
    dre_account_id: string;
    ano: number;
    mes: number;
    valor: number;
    source: string;
    source_metadata: Record<string, unknown>;
  }
  const upserts: Upsert[] = [];
  const periodsBucket = new Map<string, number>();
  const syncedAt = new Date().toISOString();

  byKey.forEach((valor, key) => {
    const [anoStr, mesStr, ...codeParts] = key.split("-");
    const ano = Number(anoStr);
    const mes = Number(mesStr);
    const accountCode = codeParts.join("-");
    const dreAccountId = accountIdByCode.get(accountCode);
    if (!dreAccountId) return;

    upserts.push({
      company_id: companyId,
      dre_account_id: dreAccountId,
      ano,
      mes,
      valor,
      source: "sheets",
      source_metadata: {
        spreadsheet_id: spreadsheetId,
        range,
        synced_at: syncedAt,
        account_code: accountCode,
      },
    });

    const periodKey = `${ano}-${mes}`;
    periodsBucket.set(periodKey, (periodsBucket.get(periodKey) ?? 0) + 1);
  });

  // ----- Upsert em lote -----
  if (upserts.length > 0) {
    const { error: upsertError } = await supabase
      .from("manual_account_values")
      .upsert(upserts, {
        onConflict: "company_id,dre_account_id,ano,mes",
      });
    if (upsertError) {
      throw new Error(`Falha ao gravar manual_account_values: ${upsertError.message}`);
    }
  }

  // ----- Limpa periodos que existiam antes mas sumiram da planilha -----
  // Pega todos os (ano, mes) que tem upsert agora e mantem so esses no banco
  // PARA AS CONTAS sheets-sourced da Feat. Periodos previamente sincronizados
  // que nao apareceram mais (ex.: alguem deletou todas as linhas de um mes
  // da planilha) sao removidos para o valor nao "congelar" no DRE.
  const currentKeys = new Set(
    upserts.map((u) => `${u.dre_account_id}-${u.ano}-${u.mes}`),
  );
  const accountIds = Array.from(accountIdByCode.values());
  const { data: existingRows, error: existingError } = await supabase
    .from("manual_account_values")
    .select("id,dre_account_id,ano,mes")
    .eq("company_id", companyId)
    .eq("source", "sheets")
    .in("dre_account_id", accountIds);
  if (existingError) {
    warnings.push(
      `Falha ao auditar linhas obsoletas: ${existingError.message}. Valores antigos podem persistir.`,
    );
  } else {
    const toDelete = (existingRows ?? [])
      .filter((row) => {
        const key = `${row.dre_account_id as string}-${row.ano}-${row.mes}`;
        return !currentKeys.has(key);
      })
      .map((row) => row.id as string);
    if (toDelete.length > 0) {
      const { error: deleteError } = await supabase
        .from("manual_account_values")
        .delete()
        .in("id", toDelete);
      if (deleteError) {
        warnings.push(`Falha ao remover linhas obsoletas: ${deleteError.message}.`);
      }
    }
  }

  const upsertedPeriods = Array.from(periodsBucket.entries())
    .map(([key, accountCount]): { ano: number; mes: number; accountCount: number } => {
      const [ano, mes] = key.split("-").map(Number);
      return { ano, mes, accountCount };
    })
    .sort((a, b) => a.ano - b.ano || a.mes - b.mes);

  return {
    spreadsheetId,
    range,
    rowsRead,
    rowsSkipped,
    periodsUpserted: periodsBucket.size,
    upsertedPeriods,
    warnings,
  };
}

// Exposto para testes (nao consumido pelo runtime).
export const __internals = { parseNumericValue, parseDateCell, aggregateRows };
