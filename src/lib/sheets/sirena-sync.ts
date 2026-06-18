import { createAdminClient } from "@/lib/supabase/admin";
import { fetchSheetValues, type SheetCellValue, type SheetRow } from "@/lib/sheets/client";

// ===========================================================================
// Configuracao do mapeamento Sheets -> DRE (Sirena)
// ===========================================================================
// Mesmo padrao tecnico da Terrazzo (src/lib/sheets/terrazzo-sync.ts): layout
// MATRIZ, uma ABA por ano, meses em COLUNAS fixas (Janeiro=B ... Dezembro=M) e
// cada conta DRE em uma LINHA fixa. Config 100% ISOLADA da Sirena — planilha,
// aba, linha e conta proprias. Nao toca Terrazzo, Feat, Omie, mapeamento, nem
// nenhuma outra empresa.
//
// Mapeamento (linha da planilha -> conta no plano custom da Sirena):
//   Linha 11 ("total")  ->  conta "Locação de Espaço"  (alimenta a RECEITA)
//
// Diferente da Terrazzo, a Sirena NAO traz impostos pela planilha — eles sao
// CALCULADOS pelo sistema no dashboard (ver src/lib/dashboard/sirena-taxes.ts),
// a partir de "Receita de Estacionamento" (Omie) + "Locação de Espaço" (esta
// planilha). Por isso aqui so existe a linha 11.
//
// A conta "Locação de Espaço" e resolvida por NOME (o code dela no plano custom
// da Sirena nao e conhecido no repo). Resolucao escopada a Sirena, com match
// exato normalizado (case/acentos-insensivel) e falha explicita se nao achar /
// houver ambiguidade — nunca grava em conta errada silenciosamente. A conta
// precisa estar marcada data_source='sheets' (migration 20260618140000) para o
// dashboard ler da planilha em vez da Omie.
// ===========================================================================
const COMPANY_NAME = "Sirena";

// Planilha informada pelo gestor. Override por env (SIRENA_SHEET_ID) sem deploy;
// o default garante funcionamento sem configuracao extra.
const DEFAULT_SPREADSHEET_ID = "1poCqv6T7XZWCLPYW9Li5NGvUmhY7k0nezZxen9j4puQ";

// Primeiro ano com aba na planilha. O sync varre de START_YEAR ate o ano
// seguinte ao atual, assim novas abas anuais passam a ser lidas sem alteracao
// de codigo. Abas inexistentes sao puladas sem quebrar (ver fetchYearRows).
const START_YEAR = 2026;

interface SheetRowMapping {
  /** Numero da linha na planilha (1-based, como aparece no Google Sheets). */
  sheetRow: number;
  /**
   * Chave interna ESTAVEL usada em byKey / source_metadata (sentinel — NAO e
   * procurado como code na DRE).
   */
  accountCode: string;
  /** A conta DRE e resolvida pelo NOME (match exato normalizado, escopo Sirena). */
  accountName: string;
  /** Rotulo so para logs/leitura. */
  label: string;
}

const ROW_MAPPINGS: SheetRowMapping[] = [
  {
    sheetRow: 11,
    accountCode: "__nome__locacao_de_espaco",
    accountName: "Locação de Espaço",
    label: "total (Locação de Espaço)",
  },
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

/** Normaliza nome de conta para match robusto (case/acentos/espacos). */
function normalizeAccountName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ===========================================================================
// Tipos publicos
// ===========================================================================
export interface SirenaSheetSyncResult {
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
 * existe na planilha — o Sheets API responde 400 nesse caso.
 */
async function fetchYearRows(
  spreadsheetId: string,
  year: number,
): Promise<SheetRow[] | null> {
  const range = `'${year}'!A1:M30`;
  try {
    return await fetchSheetValues(spreadsheetId, range);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Sheets API 400")) {
      return null;
    }
    throw error;
  }
}

// ===========================================================================
// Sync principal
// ===========================================================================
export async function syncSirenaSheetsToManualValues(): Promise<SirenaSheetSyncResult> {
  const spreadsheetId = process.env.SIRENA_SHEET_ID || DEFAULT_SPREADSHEET_ID;

  const currentYear = new Date().getUTCFullYear();
  const lastYear = Math.max(currentYear + 1, START_YEAR);
  const yearsToSync: number[] = [];
  for (let y = START_YEAR; y <= lastYear; y += 1) yearsToSync.push(y);

  const warnings: string[] = [];
  const yearsRead: number[] = [];
  const yearsSkipped: number[] = [];
  let cellsRead = 0;

  // byKey: `${ano}-${mes}-${accountCode}` -> valor.
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

  // ----- Resolve company_id + dre_account_id (por NOME) -----
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

  // accountIdByCode: chave interna (sentinel) -> dre_account_id.
  const accountIdByCode = new Map<string, string>();

  const { data: accountsData, error: accountsError } = await supabase
    .from("dre_accounts")
    .select("id,name,data_source")
    .eq("company_id", companyId);
  if (accountsError) {
    throw new Error(`Falha ao carregar contas DRE da Sirena: ${accountsError.message}`);
  }

  for (const mapping of ROW_MAPPINGS) {
    const target = normalizeAccountName(mapping.accountName);
    const matches = (accountsData ?? []).filter(
      (row) => normalizeAccountName((row.name as string) ?? "") === target,
    );
    if (matches.length === 0) {
      throw new Error(
        `Conta DRE "${mapping.accountName}" (linha ${mapping.sheetRow} da planilha) nao encontrada ` +
          `no plano da Sirena. Confirme que a estrutura DRE da Sirena possui essa linha com esse nome.`,
      );
    }
    if (matches.length > 1) {
      throw new Error(
        `Mais de uma conta DRE com nome "${mapping.accountName}" no plano da Sirena ` +
          `(${matches.length} encontradas). Renomeie/desambigue antes de sincronizar a planilha.`,
      );
    }
    const match = matches[0];
    accountIdByCode.set(mapping.accountCode, match.id as string);
    if (match.data_source !== "sheets") {
      warnings.push(
        `Conta "${mapping.accountName}" esta marcada como data_source='${match.data_source}' — esperado 'sheets'. ` +
          `Rode a migration 20260618140000_sirena_sheets_account. Ate la o valor da planilha nao aparece no DRE.`,
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
  // Mantem APENAS os (conta, ano, mes) presentes neste sync, para as contas
  // sheets-sourced da Sirena. So remove de anos que conseguimos LER (yearsRead).
  const currentKeys = new Set(
    upserts.map((u) => `${u.dre_account_id}-${u.ano}-${u.mes}`),
  );
  const accountIds = Array.from(accountIdByCode.values());
  if (yearsRead.length > 0 && accountIds.length > 0) {
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
export const __internals = { parseNumericValue, ROW_MAPPINGS, MONTH_COLUMNS, normalizeAccountName };
