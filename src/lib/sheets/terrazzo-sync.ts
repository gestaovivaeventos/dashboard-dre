import { createAdminClient } from "@/lib/supabase/admin";
import { fetchSheetValues, type SheetCellValue, type SheetRow } from "@/lib/sheets/client";

// ===========================================================================
// Configuracao do mapeamento Sheets -> DRE (Terrazzo)
// ===========================================================================
// A planilha da Terrazzo tem um layout MATRIZ (diferente do "razao" da Feat):
//   • Uma ABA por ano (ex.: "2025", "2026"). Cada aba alimenta SO o DRE daquele
//     ano — anos nunca se misturam.
//   • Dentro de cada aba, os meses ficam em COLUNAS fixas (Janeiro=B ... Dez=M)
//     e cada conta DRE fica em uma LINHA fixa.
//
// Mapeamento (linha da planilha -> code da conta no plano custom da Terrazzo):
//   Linha 12 -> 1.1  Locacao de Espaco para Formaturas
//   Linha 13 -> 1.2  Locacao de Espaco para Shows/Palestras
//   Linha 16 -> 3.2  PIS
//   Linha 17 -> 3.3  COFINS
//   Linha 18 -> 9    IRPJ
//   Linha 19 -> 10   Contribuicao Social
//
// Isolamento: este modulo so toca a empresa Terrazzo e so as contas marcadas
// como data_source='sheets' (migration 20260609120000). Nao mexe na Omie, no
// mapeamento, na estrutura DRE nem em outra empresa.
// ===========================================================================
const COMPANY_NAME = "Terrazzo";

// Spreadsheet informada pelo gestor. Pode ser sobrescrita por env var
// (TERRAZZO_SHEET_ID) sem precisar de deploy; o default garante que a
// integracao continue funcionando mesmo sem configuracao extra.
const DEFAULT_SPREADSHEET_ID = "1vdiiSyZUNjM4YdpvdDC1JXcGC5dq6t_x4Uux_CWTelk";

// Primeiro ano com aba na planilha. O sync varre de START_YEAR ate o ano
// seguinte ao atual, assim novas abas anuais passam a ser lidas sem alteracao
// de codigo. Abas inexistentes sao puladas sem quebrar (ver fetchYearRows).
const START_YEAR = 2025;

interface SheetRowMapping {
  /** Numero da linha na planilha (1-based, como aparece no Google Sheets). */
  sheetRow: number;
  /** Code da conta DRE no plano custom da Terrazzo. */
  accountCode: string;
  /** Rotulo so para logs/leitura. */
  label: string;
}

const ROW_MAPPINGS: SheetRowMapping[] = [
  { sheetRow: 12, accountCode: "1.1", label: "Locacao de Espaco para Formaturas" },
  { sheetRow: 13, accountCode: "1.2", label: "Locacao de Espaco para Shows/Palestras" },
  { sheetRow: 16, accountCode: "3.2", label: "PIS" },
  { sheetRow: 17, accountCode: "3.3", label: "COFINS" },
  { sheetRow: 18, accountCode: "9", label: "IRPJ" },
  { sheetRow: 19, accountCode: "10", label: "Contribuicao Social" },
];

// Meses em colunas: Janeiro=B (index 1) ... Dezembro=M (index 12).
// columnIndex e 0-based (A=0, B=1, ..., M=12).
const MONTH_COLUMNS: Array<{ mes: number; columnIndex: number; columnLetter: string }> = [
  { mes: 1, columnIndex: 1, columnLetter: "B" },
  { mes: 2, columnIndex: 2, columnLetter: "C" },
  { mes: 3, columnIndex: 3, columnLetter: "D" },
  { mes: 4, columnIndex: 4, columnLetter: "E" },
  { mes: 5, columnIndex: 5, columnLetter: "F" },
  { mes: 6, columnIndex: 6, columnLetter: "G" },
  { mes: 7, columnIndex: 7, columnLetter: "H" },
  { mes: 8, columnIndex: 8, columnLetter: "I" },
  { mes: 9, columnIndex: 9, columnLetter: "J" },
  { mes: 10, columnIndex: 10, columnLetter: "K" },
  { mes: 11, columnIndex: 11, columnLetter: "L" },
  { mes: 12, columnIndex: 12, columnLetter: "M" },
];

// ===========================================================================
// Tipos publicos
// ===========================================================================
export interface TerrazzoSheetSyncResult {
  spreadsheetId: string;
  yearsRead: number[];
  yearsSkipped: number[];
  cellsRead: number;
  periodsUpserted: number;
  upsertedPeriods: Array<{ ano: number; mes: number; accountCount: number }>;
  warnings: string[];
}

// ===========================================================================
// Helpers de parsing
// ===========================================================================
function parseNumericValue(cell: SheetCellValue): number {
  // Com valueRenderOption=UNFORMATTED_VALUE os numeros chegam nativos. Celula
  // vazia/undefined ou texto nao numerico -> 0 (regra: vazio = zero). Suporta
  // tambem formato BR ("1.234,56" / "(1.234,56)") caso a celula seja texto.
  if (typeof cell === "number" && Number.isFinite(cell)) return cell;
  if (typeof cell === "string") {
    const trimmed = cell.trim();
    if (!trimmed || trimmed === "-") return 0;
    const isNegative = /^\(.*\)$/.test(trimmed);
    const inner = isNegative ? trimmed.slice(1, -1) : trimmed;
    const normalized = inner.replace(/[R$\s]/g, "").replace(/\./g, "").replace(/,/g, ".");
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) return 0;
    return isNegative ? -parsed : parsed;
  }
  return 0;
}

/**
 * Le as linhas de uma aba/ano. Retorna `null` (sem quebrar) quando a aba nao
 * existe na planilha — o Sheets API responde 400 nesse caso. Assim, selecionar
 * um ano sem aba apenas nao carrega valores daquele ano.
 */
async function fetchYearRows(
  spreadsheetId: string,
  year: number,
): Promise<SheetRow[] | null> {
  // Nome da aba = o ano. Envolto em aspas simples (notacao A1) por seguranca.
  const range = `'${year}'!A1:M30`;
  try {
    return await fetchSheetValues(spreadsheetId, range);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // 400 = aba inexistente / range invalido. Trata como "ano sem dados".
    if (message.includes("Sheets API 400")) {
      return null;
    }
    throw error;
  }
}

// ===========================================================================
// Sync principal
// ===========================================================================
export async function syncTerrazzoSheetsToManualValues(): Promise<TerrazzoSheetSyncResult> {
  const spreadsheetId = process.env.TERRAZZO_SHEET_ID || DEFAULT_SPREADSHEET_ID;

  // Varre de START_YEAR ate o ano seguinte ao atual, para abranger abas futuras
  // sem mudanca de codigo. Anos sem aba sao ignorados com seguranca.
  const currentYear = new Date().getUTCFullYear();
  const lastYear = Math.max(currentYear + 1, START_YEAR);
  const yearsToSync: number[] = [];
  for (let y = START_YEAR; y <= lastYear; y += 1) yearsToSync.push(y);

  const warnings: string[] = [];
  const yearsRead: number[] = [];
  const yearsSkipped: number[] = [];
  let cellsRead = 0;

  // byKey: `${ano}-${mes}-${code}` -> valor.
  const byKey = new Map<string, number>();

  for (const year of yearsToSync) {
    const rows = await fetchYearRows(spreadsheetId, year);
    if (rows === null) {
      yearsSkipped.push(year);
      continue;
    }
    yearsRead.push(year);

    ROW_MAPPINGS.forEach((mapping) => {
      // rows e 0-based; linha N da planilha = rows[N-1].
      const row = rows[mapping.sheetRow - 1];
      if (!row) return; // linha ausente/vazia -> nada a lancar
      MONTH_COLUMNS.forEach(({ mes, columnIndex }) => {
        const value = parseNumericValue(row[columnIndex]);
        cellsRead += 1;
        if (value === 0) return; // vazio/zero nao gera lancamento
        const key = `${year}-${mes}-${mapping.accountCode}`;
        byKey.set(key, (byKey.get(key) ?? 0) + value);
      });
    });
  }

  if (yearsRead.length === 0) {
    warnings.push(
      `Nenhuma aba de ano encontrada na planilha (${yearsToSync.join(", ")}). Nada foi sincronizado.`,
    );
  }

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

  const accountCodes = ROW_MAPPINGS.map((m) => m.accountCode);
  const { data: accountsData, error: accountsError } = await supabase
    .from("dre_accounts")
    .select("id,code,data_source")
    .eq("company_id", companyId)
    .in("code", accountCodes);

  if (accountsError) {
    throw new Error(`Falha ao carregar contas DRE da Terrazzo: ${accountsError.message}`);
  }

  const accountIdByCode = new Map<string, string>();
  (accountsData ?? []).forEach((row) => {
    accountIdByCode.set(row.code as string, row.id as string);
    if (row.data_source !== "sheets") {
      warnings.push(
        `Conta ${row.code} esta marcada como data_source='${row.data_source}' — esperado 'sheets'. ` +
          `Rode a migration 20260609120000_terrazzo_sheets_accounts. Ate la o valor da planilha nao aparece no DRE.`,
      );
    }
  });

  for (const code of accountCodes) {
    if (!accountIdByCode.has(code)) {
      throw new Error(
        `Conta DRE com code '${code}' nao encontrada no plano da Terrazzo. ` +
          `Confirme que a estrutura DRE personalizada da Terrazzo possui essa linha.`,
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
        tab: String(ano),
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

  // ----- Limpa periodos que existiam antes mas sumiram/zeraram na planilha -----
  // Mantem no banco APENAS os (conta, ano, mes) presentes neste sync, para as
  // contas sheets-sourced da Terrazzo. Importante: so removemos linhas de anos
  // que conseguimos LER (yearsRead). Se uma aba estava indisponivel, nao apagamos
  // os dados ja sincronizados daquele ano.
  const currentKeys = new Set(
    upserts.map((u) => `${u.dre_account_id}-${u.ano}-${u.mes}`),
  );
  const accountIds = Array.from(accountIdByCode.values());
  if (yearsRead.length > 0) {
    const { data: existingRows, error: existingError } = await supabase
      .from("manual_account_values")
      .select("id,dre_account_id,ano,mes")
      .eq("company_id", companyId)
      .eq("source", "sheets")
      .in("dre_account_id", accountIds)
      .in("ano", yearsRead);
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
  }

  const upsertedPeriods = Array.from(periodsBucket.entries())
    .map(([key, accountCount]): { ano: number; mes: number; accountCount: number } => {
      const [ano, mes] = key.split("-").map(Number);
      return { ano, mes, accountCount };
    })
    .sort((a, b) => a.ano - b.ano || a.mes - b.mes);

  return {
    spreadsheetId,
    yearsRead,
    yearsSkipped,
    cellsRead,
    periodsUpserted: periodsBucket.size,
    upsertedPeriods,
    warnings,
  };
}

// Exposto para testes (nao consumido pelo runtime).
export const __internals = { parseNumericValue, ROW_MAPPINGS, MONTH_COLUMNS };
