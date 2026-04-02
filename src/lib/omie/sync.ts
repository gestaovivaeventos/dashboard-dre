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
const OMIE_CLIENTES_URL =
  "https://app.omie.com.br/api/v1/geral/clientes/";
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

export type SyncMode = "incremental" | "full";

interface SyncResult {
  recordsImported: number;
  recordsDeleted: number;
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
function formatDateForOmie(date: Date): string {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

function calculateDateRange(
  mode: SyncMode,
  lastFullSyncAt: string | null,
): { dateFrom: string; dateTo: string } {
  const now = new Date();
  const dateTo = formatDateForOmie(now);

  if (mode === "full") {
    if (!lastFullSyncAt) {
      return { dateFrom: "01-01-2022", dateTo };
    }
    const from = new Date(now);
    from.setMonth(from.getMonth() - 24);
    return { dateFrom: formatDateForOmie(from), dateTo };
  }

  // Incremental: from watermark - 3 days
  if (!lastFullSyncAt) {
    return { dateFrom: "01-01-2022", dateTo };
  }
  const from = new Date(lastFullSyncAt);
  from.setDate(from.getDate() - 3);
  return { dateFrom: formatDateForOmie(from), dateTo };
}

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
        lDadosCad: "S",
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
// Fetch client/supplier names (ListarClientesResumido)
// ===========================================================================
async function fetchClientNames(
  appKey: string,
  appSecret: string,
  lastRequestRef: { value: number },
) {
  const clientsByCode = new Map<number, string>();
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    try {
      const response = await omieRequest(
        OMIE_CLIENTES_URL,
        "ListarClientesResumido",
        appKey,
        appSecret,
        { pagina: page, registros_por_pagina: 500 },
        lastRequestRef,
      );
      const records = extractArray(response);
      for (const record of records) {
        const code = record.codigo_cliente ?? record.nCodCliente;
        const nomeFantasia = getString(record, ["nome_fantasia", "fantasia"]);
        const razaoSocial = getString(record, ["razao_social", "nome"]);
        const name = nomeFantasia || razaoSocial;
        if (code && name) {
          clientsByCode.set(Number(code), name);
        }
      }
      totalPages = Number(
        getString(response, ["total_de_paginas", "nTotPaginas"]) ?? "1",
      );
      if (!Number.isFinite(totalPages) || totalPages < 1) totalPages = page;
      page += 1;
    } catch {
      // If API fails (e.g. no permission), return what we have
      break;
    }
  }

  return clientsByCode;
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
export async function runCompanySync(
  companyId: string,
  profile: UserProfile,
  mode: SyncMode = "incremental",
) {
  return runCompanySyncInternal(companyId, {
    profile,
    skipPermission: false,
    mode,
  });
}

export async function runCompanySyncAsSystem(
  companyId: string,
  mode: SyncMode = "incremental",
) {
  return runCompanySyncInternal(companyId, {
    profile: null,
    skipPermission: true,
    mode,
  });
}

async function runCompanySyncInternal(
  companyId: string,
  options: {
    profile: UserProfile | null;
    skipPermission: boolean;
    mode: SyncMode;
  },
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
    .select("id, omie_app_key, omie_app_secret, last_full_sync_at, segment_id")
    .eq("id", companyId)
    .single<{
      id: string;
      omie_app_key: string | null;
      omie_app_secret: string | null;
      last_full_sync_at: string | null;
      segment_id: string | null;
    }>();

  if (companyError || !company) {
    throw new Error("Empresa nao encontrada.");
  }

  const effectiveMode =
    options.mode === "incremental" && !company.last_full_sync_at
      ? "full"
      : options.mode;

  const { dateFrom, dateTo } = calculateDateRange(
    effectiveMode,
    company.last_full_sync_at,
  );

  const { data: syncLog, error: syncLogError } = await supabase
    .from("sync_log")
    .insert({
      company_id: companyId,
      started_at: new Date().toISOString(),
      status: "running",
      records_imported: 0,
      sync_type: effectiveMode,
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
      mode: effectiveMode,
      dateFrom,
      dateTo,
      segmentId: company.segment_id,
    });

    if (effectiveMode === "full") {
      await supabase
        .from("companies")
        .update({ last_full_sync_at: new Date().toISOString() })
        .eq("id", companyId);
    }

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
  mode,
  dateFrom,
  dateTo,
  segmentId,
}: {
  companyId: string;
  appKey: string;
  appSecret: string;
  lastRequestRef: { value: number };
  mode: SyncMode;
  dateFrom: string;
  dateTo: string;
  segmentId: string | null;
}): Promise<SyncResult> {
  const supabase = await createSupabaseClient();

  // 1. Buscar movimentos financeiros filtrados por data de pagamento
  //    + catalogo de categorias + nomes de clientes/fornecedores.
  const [rawMovimentos, categoryCatalog, clientNames] = await Promise.all([
    fetchAllMovimentos(appKey, appSecret, dateFrom, dateTo, lastRequestRef),
    fetchCategoryCatalog(appKey, appSecret, lastRequestRef),
    fetchClientNames(appKey, appSecret, lastRequestRef),
  ]);

  // 2. Enriquecer os dados brutos ANTES de processar.
  //    A API ListarMovimentos NAO retorna nome do cliente nem observacao.
  //    Injetamos esses campos nos raw records para que o processador os use.
  for (const raw of rawMovimentos) {
    const det = (typeof raw.detalhes === "object" && raw.detalhes !== null)
      ? (raw.detalhes as Record<string, unknown>)
      : raw;

    // Injetar nome fantasia do cliente/fornecedor
    const codCliente = Number(det.nCodCliente ?? 0);
    if (codCliente > 0 && clientNames.has(codCliente)) {
      det.cNomeCliente = clientNames.get(codCliente)!;
    } else {
      const cpf = getString(det, ["cCPFCNPJCliente"]);
      if (cpf) det.cNomeCliente = cpf;
    }

    // Descricao: com lDadosCad=S, a API retorna o campo "observacao".
    // Se observacao existir, copiar para cDescricao (que o processador prioriza).
    // Se nao, usar cNumOS + cTipo como fallback.
    const obs = getString(det, ["observacao"]);
    if (obs) {
      det.cDescricao = obs;
    } else if (!det.cDescricao && !det.cObs) {
      const numOS = getString(det, ["cNumOS"]);
      const tipo = getString(det, ["cTipo"]);
      const numDocFiscal = getString(det, ["cNumDocFiscal"]);
      const numTitulo = getString(det, ["cNumTitulo"]);
      if (numOS && numOS !== "0") {
        det.cDescricao = tipo ? `${tipo} - ${numOS}` : numOS;
      } else if (numDocFiscal) {
        det.cDescricao = tipo ? `${tipo} - NF ${numDocFiscal}` : `NF ${numDocFiscal}`;
      } else if (numTitulo) {
        det.cDescricao = tipo ? `${tipo} - ${numTitulo}` : numTitulo;
      }
    }
  }

  // 3. Usar o processador financeiro que implementa as 11 regras
  //    de negócio completas para DRE em regime de caixa.
  const { entries } = processMovimentos(rawMovimentos, companyId);

  // 3.1 Regra Franquias Viva: Ressarciveis com projeto → Fundos
  //     Baseada no MAPEAMENTO existente (contas DRE 2.4 e 7.5.5).
  //
  //     - category_code mapeado para 2.4 (Receitas Ressarciveis):
  //       Se cCodProjeto preenchido → redireciona para 5.8 (Receitas Ressarciveis - Fundos)
  //       Se cCodProjeto vazio → mantém em 2.4
  //
  //     - category_code mapeado para 7.5.5 (Despesas Ressarciveis):
  //       Se cCodProjeto preenchido → redireciona para 5.9 (Despesas Ressarciveis - Fundos)
  //       Se cCodProjeto vazio → mantém em 7.5.5
  if (segmentId) {
    const { data: segData } = await supabase
      .from("segments")
      .select("slug")
      .eq("id", segmentId)
      .single<{ slug: string }>();

    if (segData?.slug === "franquias-viva") {
      // Buscar IDs das 4 contas DRE envolvidas
      const { data: dreAccounts } = await supabase
        .from("dre_accounts")
        .select("id,code")
        .in("code", ["2.4", "7.5.5", "5.8", "5.9"])
        .eq("active", true);

      const dreIdByCode = new Map<string, string>();
      (dreAccounts ?? []).forEach((a) => {
        dreIdByCode.set(a.code as string, a.id as string);
      });

      const recRessarcId = dreIdByCode.get("2.4");    // Receitas Ressarciveis
      const despRessarcId = dreIdByCode.get("7.5.5");  // Despesas Ressarciveis
      const fundosRecId = dreIdByCode.get("5.8");      // Receitas Ressarciveis - Fundos
      const fundosDespId = dreIdByCode.get("5.9");     // Despesas Ressarciveis - Fundos

      if (recRessarcId && despRessarcId && fundosRecId && fundosDespId) {
        // DUPLA DETECCAO de categorias ressarciveis:
        //
        // Fonte 1: category_mapping — category_codes mapeados para 2.4 ou 7.5.5
        //          em qualquer empresa (cobre categorias ja mapeadas)
        const { data: mappingsData } = await supabase
          .from("category_mapping")
          .select("omie_category_code,dre_account_id,company_id")
          .in("dre_account_id", [recRessarcId, despRessarcId]);

        const effectiveMapping = new Map<string, string>(); // category_code → dre_account_id
        (mappingsData ?? []).forEach((m) => {
          const cc = m.omie_category_code as string;
          const dreId = m.dre_account_id as string;
          const cid = m.company_id as string | null;
          if (cid === companyId) {
            effectiveMapping.set(cc, dreId);
          } else if (!effectiveMapping.has(cc)) {
            effectiveMapping.set(cc, dreId);
          }
        });

        // Fonte 2: catalogo Omie — categorias cujo nome contem "ressarc"
        //          (cobre categorias nao mapeadas ainda, como em empresas novas)
        for (const [code, description] of Array.from(categoryCatalog.entries())) {
          if (effectiveMapping.has(code)) continue; // ja detectado pelo mapeamento
          const norm = description.toLowerCase()
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
          if (norm.includes("ressarc")) {
            // Determinar se é receita ou despesa pelo prefixo do código Omie
            // Códigos 1.xx = receita, 2.xx = despesa (convenção Omie)
            const isReceita = code.startsWith("1.");
            effectiveMapping.set(code, isReceita ? recRessarcId : despRessarcId);
          }
        }

        // Redirecionar entries com cCodProjeto preenchido.
        // Usar Map de overrides (nao mutar o entry diretamente).
        const categoryOverrides = new Map<number, string>(); // index → new category_code
        const fundosMappingsNeeded = new Map<string, { code: string; dreId: string; name: string }>();

        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i];
          if (!entry.category_code) continue;
          const mappedDreId = effectiveMapping.get(entry.category_code);
          if (!mappedDreId) continue; // nao e ressarcivel → ignorar

          const raw = entry.raw_json ?? {};
          const det = (typeof raw.detalhes === "object" && raw.detalhes !== null)
            ? (raw.detalhes as Record<string, unknown>)
            : raw;
          const projeto = getString(det, ["cCodProjeto"]);

          if (!projeto) continue; // sem projeto → manter mapeamento normal

          // Com projeto → redirecionar para Fundos
          let fundosId: string;
          let prefix: string;
          let label: string;
          if (mappedDreId === recRessarcId) {
            fundosId = fundosRecId;
            prefix = "__fundos_rec_";
            label = "Receitas Ressarciveis - Fundos (projeto)";
          } else {
            fundosId = fundosDespId;
            prefix = "__fundos_desp_";
            label = "Despesas Ressarciveis - Fundos (projeto)";
          }

          const newCode = `${prefix}${entry.category_code}`;
          categoryOverrides.set(i, newCode);

          if (!fundosMappingsNeeded.has(newCode)) {
            fundosMappingsNeeded.set(newCode, { code: newCode, dreId: fundosId, name: label });
          }
        }

        // Aplicar overrides: recriar entries com category_code alterado
        for (const [idx, newCode] of Array.from(categoryOverrides)) {
          const original = entries[idx];
          entries[idx] = { ...original, category_code: newCode } as typeof original;
        }

        // Criar mapeamentos para os códigos especiais via delete+insert
        if (fundosMappingsNeeded.size > 0) {
          const codes = Array.from(fundosMappingsNeeded.keys());
          await supabase
            .from("category_mapping")
            .delete()
            .eq("company_id", companyId)
            .in("omie_category_code", codes);

          const rows = Array.from(fundosMappingsNeeded.values()).map((m) => ({
            omie_category_code: m.code,
            omie_category_name: m.name,
            dre_account_id: m.dreId,
            company_id: companyId,
          }));
          await supabase.from("category_mapping").insert(rows);
        }
      }
    }
  }

  // 4. Deduplicar por omie_id (ultima ocorrencia vence).
  const deduped = new Map<string, NormalizedEntry>();
  for (const entry of entries) {
    deduped.set(entry.omie_id, entry);
  }
  const uniqueEntries = Array.from(deduped.values());

  // 5. Upsert lancamentos normalizados.
  for (const batch of chunk(uniqueEntries, 500)) {
    const { error } = await supabase.from("financial_entries").upsert(batch, {
      onConflict: "company_id,omie_id",
    });
    if (error) {
      throw new Error(`Falha ao salvar lancamentos: ${error.message}`);
    }
  }

  // 5. Limpar lancamentos obsoletos dentro do periodo buscado.
  //    - Full: busca todos da empresa (periodo completo).
  //    - Incremental: busca apenas no range de datas sincronizado,
  //      para nao deletar dados fora da janela incremental.
  let recordsDeleted = 0;
  {
    const validOmieIds = new Set(uniqueEntries.map((e) => e.omie_id));

    // Converter dateFrom/dateTo de DD-MM-YYYY para YYYY-MM-DD (formato do banco).
    const [dd1, mm1, yyyy1] = dateFrom.split("-");
    const [dd2, mm2, yyyy2] = dateTo.split("-");
    const dbDateFrom = `${yyyy1}-${mm1}-${dd1}`;
    const dbDateTo = `${yyyy2}-${mm2}-${dd2}`;

    let query = supabase
      .from("financial_entries")
      .select("id, omie_id")
      .eq("company_id", companyId);

    if (mode === "incremental") {
      // Escopo: apenas entries dentro do periodo buscado.
      query = query.gte("payment_date", dbDateFrom).lte("payment_date", dbDateTo);
    }

    const { data: existingEntries } = await query;

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
    recordsDeleted = idsToDelete.length;
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
    recordsDeleted,
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
