import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { decryptSecret } from "@/lib/security/encryption";
import type { UserProfile } from "@/lib/supabase/types";
import { processMovimentos } from "@/lib/omie/financial-processor";

// ===========================================================================
// API Endpoints
// ===========================================================================
const OMIE_MOV_FINANCEIRAS_URL =
  "https://app.omie.com.br/api/v1/financas/mf/";
const OMIE_CATEGORIAS_URL =
  "https://app.omie.com.br/api/v1/geral/categorias/";
const REQUEST_INTERVAL_MS = 350;

// ===========================================================================
// Types
// ===========================================================================
type EntryType = "receita" | "despesa";

/**
 * NormalizedEntry compatível com ProcessedFinancialEntry do financial-processor
 * Todos os registros passam pelas 11 regras de negócio implementadas
 */
interface NormalizedEntry {
  company_id: string;
  omie_id: string;
  type: EntryType;
  description: string;
  value: number;
  payment_date: string;
  ano_pgto: number;
  mes_pagamento: number;
  category_code: string | null;
  category_name?: string | null;
  supplier_customer: string | null;
  document_number: string | null;
  raw_json: Record<string, unknown>;
  processing_metadata: Record<string, unknown>;
}

interface SyncResult {
  recordsImported: number;
  categories: Array<{ company_id: string; code: string; description: string }>;
  newUnmappedCategories: Array<{
    company_id: string;
    code: string;
    description: string;
  }>;
}

// ===========================================================================
// Helpers
// ===========================================================================
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return null;
}

function parseDate(input: unknown): string | null {
  if (typeof input !== "string" || !input.trim()) return null;
  const trimmed = input.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) {
    const [day, month, year] = trimmed.split("/");
    return `${year}-${month}-${day}`;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function parseNumber(input: unknown): number {
  if (typeof input === "number" && Number.isFinite(input)) return input;
  if (typeof input === "string") {
    const normalized = input.replace(/\./g, "").replace(",", ".");
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function extractArray(response: Record<string, unknown>) {
  const candidates = Object.values(response).filter(Array.isArray);
  return (candidates[0] as Record<string, unknown>[] | undefined) ?? [];
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

// ===========================================================================
// IMPORTANT: Processing logic moved to financial-processor.ts
// ---------------------------------------------------------------------------
// The following functions have been refactored into @/lib/omie/financial-processor.ts
// to implement all 11 business rules in a clear, auditable manner:
//   - flattenMovimento
//   - normalizeMovimento
//   - All validation and transformation logic
//
// This sync.ts file now orchestrates the sync pipeline using the processor.
// ===========================================================================


// ===========================================================================
// Omie HTTP request with rate-limiting
// ===========================================================================
async function omieRequest(
  url: string,
  call: string,
  appKey: string,
  appSecret: string,
  params: Record<string, unknown>,
  lastRequestRef: { value: number },
) {
  const elapsed = Date.now() - lastRequestRef.value;
  if (lastRequestRef.value > 0 && elapsed < REQUEST_INTERVAL_MS) {
    await sleep(REQUEST_INTERVAL_MS - elapsed);
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      call,
      app_key: appKey,
      app_secret: appSecret,
      param: [params],
    }),
    cache: "no-store",
  });
  lastRequestRef.value = Date.now();

  if (!response.ok) {
    throw new Error(`Omie HTTP ${response.status} em ${call}.`);
  }

  const data = (await response.json()) as Record<string, unknown>;
  const faultString =
    getString(data, ["faultstring", "error_description", "message"]) ??
    getString(data, ["descricao_status"]);
  if (
    data.faultcode ||
    (faultString && String(faultString).toLowerCase().includes("erro"))
  ) {
    throw new Error(faultString ?? `Erro retornado pela Omie em ${call}.`);
  }

  return data;
}

// ===========================================================================
// Fetch all pages of ListarMovimentos (filtrado por periodo)
// ===========================================================================
async function fetchAllMovimentos(
  appKey: string,
  appSecret: string,
  dateFrom: string,
  dateTo: string,
  lastRequestRef: { value: number },
): Promise<Record<string, unknown>[]> {
  const allRecords: Record<string, unknown>[] = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    const response = await omieRequest(
      OMIE_MOV_FINANCEIRAS_URL,
      "ListarMovimentos",
      appKey,
      appSecret,
      {
        nPagina: page,
        nRegPorPagina: 500,
        dDtPagtoDe: dateFrom,
        dDtPagtoAte: dateTo,
        cExibirDepartamentos: "S",
      },
      lastRequestRef,
    );

    const records = extractArray(response);
    allRecords.push(...records);

    totalPages = Number(
      getString(response, ["nTotPaginas", "total_de_paginas"]) ?? "1",
    );
    if (!Number.isFinite(totalPages) || totalPages < 1) {
      totalPages = page;
    }
    page += 1;
  }

  return allRecords;
}

// ===========================================================================
// Fetch category catalog (ListarCategorias) — recursive
// ===========================================================================
function extractCategoriesRecursive(
  records: Record<string, unknown>[],
  result: Map<string, string>,
) {
  for (const record of records) {
    const code = getString(record, ["codigo"]);
    const description = getString(record, ["descricao", "descricao_padrao"]);
    if (code) {
      result.set(code, description ?? code);
    }
    const sub = record.categorias ?? record.categoria_cadastro;
    if (Array.isArray(sub)) {
      extractCategoriesRecursive(
        sub as Record<string, unknown>[],
        result,
      );
    }
  }
}

async function fetchCategoryCatalog(
  appKey: string,
  appSecret: string,
  lastRequestRef: { value: number },
) {
  const categoriesByCode = new Map<string, string>();
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    const response = await omieRequest(
      OMIE_CATEGORIAS_URL,
      "ListarCategorias",
      appKey,
      appSecret,
      { pagina: page, registros_por_pagina: 500 },
      lastRequestRef,
    );
    const records = extractArray(response);
    extractCategoriesRecursive(records, categoriesByCode);

    totalPages = Number(
      getString(response, [
        "total_de_paginas",
        "total_paginas",
        "nTotPaginas",
      ]) ?? "1",
    );
    if (!Number.isFinite(totalPages) || totalPages < 1) {
      totalPages = page;
    }
    page += 1;
  }

  return categoriesByCode;
}

// ===========================================================================
// Permissions
// ===========================================================================
export async function canSyncCompany(
  profile: UserProfile | null,
  companyId: string,
) {
  if (!profile) return false;
  if (profile.role === "admin" || profile.role === "gestor_hero") return true;
  return profile.company_id === companyId;
}

// ===========================================================================
// Public sync entry points
// ===========================================================================
export async function runCompanySync(companyId: string, profile: UserProfile) {
  return runCompanySyncInternal(companyId, {
    profile,
    skipPermission: false,
  });
}

export async function runCompanySyncAsSystem(companyId: string) {
  return runCompanySyncInternal(companyId, {
    profile: null,
    skipPermission: true,
  });
}

async function runCompanySyncInternal(
  companyId: string,
  options: { profile: UserProfile | null; skipPermission: boolean },
) {
  const supabase = await createSupabaseClient();
  if (!options.skipPermission) {
    const isAllowed = await canSyncCompany(options.profile, companyId);
    if (!isAllowed) {
      throw new Error("Sem permissao para sincronizar esta empresa.");
    }
  }

  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("id, omie_app_key, omie_app_secret")
    .eq("id", companyId)
    .single<{
      id: string;
      omie_app_key: string | null;
      omie_app_secret: string | null;
    }>();

  if (companyError || !company) {
    throw new Error("Empresa nao encontrada.");
  }

  const { data: syncLog, error: syncLogError } = await supabase
    .from("sync_log")
    .insert({
      company_id: companyId,
      started_at: new Date().toISOString(),
      status: "running",
      records_imported: 0,
    })
    .select("id")
    .single<{ id: string }>();

  if (syncLogError || !syncLog) {
    throw new Error("Nao foi possivel iniciar o log de sincronizacao.");
  }

  try {
    if (!company.omie_app_key || !company.omie_app_secret) {
      throw new Error(
        "Credenciais da Omie nao configuradas para esta empresa.",
      );
    }

    const appKey = decryptSecret(company.omie_app_key);
    const appSecret = decryptSecret(company.omie_app_secret);
    const lastRequestRef = { value: 0 };

    const result = await syncEntries({
      companyId,
      appKey,
      appSecret,
      lastRequestRef,
    });

    await supabase
      .from("sync_log")
      .update({
        finished_at: new Date().toISOString(),
        status: "success",
        records_imported: result.recordsImported,
        error_message: null,
      })
      .eq("id", syncLog.id);

    return result;
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Erro inesperado no processo de sync.";
    await supabase
      .from("sync_log")
      .update({
        finished_at: new Date().toISOString(),
        status: "error",
        error_message: message,
      })
      .eq("id", syncLog.id);
    throw error;
  }
}

// ===========================================================================
// syncEntries — orchestrates the full sync pipeline
// ===========================================================================
async function syncEntries({
  companyId,
  appKey,
  appSecret,
  lastRequestRef,
}: {
  companyId: string;
  appKey: string;
  appSecret: string;
  lastRequestRef: { value: number };
}): Promise<SyncResult> {
  const supabase = await createSupabaseClient();

  // Periodo de sincronizacao: ano 2026 completo.
  // TODO: tornar configuravel via parametro.
  const dateFrom = "01-01-2026";
  const dateTo = "31-12-2026";

  // 1. Buscar movimentos financeiros filtrados por data de pagamento
  //    + catalogo de categorias em paralelo.
  const [rawMovimentos, categoryCatalog] = await Promise.all([
    fetchAllMovimentos(appKey, appSecret, dateFrom, dateTo, lastRequestRef),
    fetchCategoryCatalog(appKey, appSecret, lastRequestRef),
  ]);

  // 2. Usar o novo processador financeiro que implementa as 11 regras
  //    de negócio completas para DRE em regime de caixa.
  const { entries } = processMovimentos(rawMovimentos, companyId);

  // 3. Deduplicar por omie_id (ultima ocorrencia vence).
  const deduped = new Map<string, NormalizedEntry>();
  for (const entry of entries) {
    deduped.set(entry.omie_id, entry);
  }
  const uniqueEntries = Array.from(deduped.values());

  // 4. Upsert lancamentos normalizados.
  for (const batch of chunk(uniqueEntries, 500)) {
    const { error } = await supabase.from("financial_entries").upsert(batch, {
      onConflict: "company_id,omie_id",
    });
    if (error) {
      throw new Error(`Falha ao salvar lancamentos: ${error.message}`);
    }
  }

  // 5. Limpar lancamentos obsoletos.
  const validOmieIds = new Set(uniqueEntries.map((e) => e.omie_id));
  const { data: existingEntries } = await supabase
    .from("financial_entries")
    .select("id, omie_id")
    .eq("company_id", companyId);

  const idsToDelete = (existingEntries ?? [])
    .filter((e) => !validOmieIds.has(e.omie_id as string))
    .map((e) => e.id as string);

  for (const batch of chunk(idsToDelete, 50)) {
    const { error } = await supabase
      .from("financial_entries")
      .delete()
      .in("id", batch);
    if (error) {
      throw new Error(
        `Falha ao limpar lancamentos obsoletos: ${error.message}`,
      );
    }
  }

  // 6. Consolidar categorias e upsert omie_categories.
  const categoriesMap = new Map<
    string,
    { company_id: string; code: string; description: string }
  >();
  uniqueEntries.forEach((entry) => {
    if (!entry.category_code) return;
    const catalogDescription = categoryCatalog.get(entry.category_code);
    categoriesMap.set(entry.category_code, {
      company_id: companyId,
      code: entry.category_code,
      description:
        catalogDescription ?? entry.category_name ?? entry.category_code,
    });
  });

  const categories = Array.from(categoriesMap.values());
  if (categories.length > 0) {
    const { error } = await supabase
      .from("omie_categories")
      .upsert(categories, { onConflict: "company_id,code" });
    if (error) {
      throw new Error(`Falha ao salvar categorias: ${error.message}`);
    }
  }

  // 7. Identificar categorias sem mapeamento DRE.
  let newUnmappedCategories: Array<{
    company_id: string;
    code: string;
    description: string;
  }> = [];
  if (categories.length > 0) {
    const codes = categories.map((c) => c.code);
    const { data: mappings } = await supabase
      .from("category_mapping")
      .select("omie_category_code,company_id")
      .in("omie_category_code", codes)
      .or(`company_id.is.null,company_id.eq.${companyId}`);

    const mappedCodes = new Set(
      (mappings ?? []).map((m) => m.omie_category_code as string),
    );
    newUnmappedCategories = categories.filter(
      (c) => !mappedCodes.has(c.code),
    );
  }

  return {
    recordsImported: uniqueEntries.length,
    categories,
    newUnmappedCategories,
  };
}

// ===========================================================================
// Test connection
// ===========================================================================
export async function testCompanyConnection(
  encryptedAppKey: string,
  encryptedAppSecret: string,
) {
  const appKey = decryptSecret(encryptedAppKey);
  const appSecret = decryptSecret(encryptedAppSecret);

  const response = await fetch(OMIE_MOV_FINANCEIRAS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      call: "ListarMovimentos",
      app_key: appKey,
      app_secret: appSecret,
      param: [{ nPagina: 1, nRegPorPagina: 1 }],
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Omie HTTP ${response.status}`);
  }

  const data = (await response.json()) as Record<string, unknown>;
  if (data.faultcode || data.faultstring) {
    throw new Error(
      String(data.faultstring ?? "Falha ao conectar na Omie."),
    );
  }
}
