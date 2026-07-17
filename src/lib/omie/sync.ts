import { revalidatePath } from "next/cache";

import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  refreshDreAggregatesForSource,
  refreshCashFlowAggregatesForSource,
} from "@/lib/dashboard/aggregate-refresh";
import { decryptSecret } from "@/lib/security/encryption";
import { CASE_SHOWS_COMPANY_NAME } from "@/lib/dashboard/case-shows-custody";
import { CASE_COMPANY_ID } from "@/lib/case/constants";
import { runCaseShowsCustodyCompetenciaSync } from "@/lib/omie/case-shows-custody-sync";
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
const OMIE_DEPARTAMENTOS_URL =
  "https://app.omie.com.br/api/v1/geral/departamentos/";
const OMIE_PROJETOS_URL =
  "https://app.omie.com.br/api/v1/geral/projetos/";
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
  // Projeto Omie: codigo (cCodProjeto) extraido pelo processador e nome
  // resolvido via catalogo (ListarProjetos). Usado pela regra de exclusao
  // de DRE da Feat Producoes. Null quando nao ha projeto vinculado.
  project_code: string | null;
  project_name?: string | null;
  department_code: string | null;
  supplier_customer: string | null;
  document_number: string | null;
  raw_json: Record<string, unknown>;
  processing_metadata: Record<string, unknown>;
}

export type SyncMode = "incremental" | "full" | "rolling" | "custom";

export interface CustomDateRange {
  // Datas no formato DD-MM-YYYY (mesmo formato usado pela Omie).
  dateFrom: string;
  dateTo: string;
}

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
  customRange?: CustomDateRange,
): { dateFrom: string; dateTo: string } {
  const now = new Date();
  const dateTo = formatDateForOmie(now);

  if (mode === "custom") {
    if (!customRange) {
      throw new Error("Range customizado obrigatorio para sync mode=custom.");
    }
    return { dateFrom: customRange.dateFrom, dateTo: customRange.dateTo };
  }

  if (mode === "rolling") {
    const from = new Date(now);
    from.setDate(from.getDate() - 3);
    return { dateFrom: formatDateForOmie(from), dateTo };
  }

  // "full" sempre re-busca todo o historico desde 2022. Antes, apos a primeira
  // execucao bem-sucedida, este ramo caia para uma janela de 24 meses — combinado
  // com `cleanup_obsolete_entries(p_date_from=null, p_date_to=null)`, isso apagava
  // todos os entries fora da janela (2022, 2023, inicio de 2024) a cada
  // "Sincronizar Historico" subsequente. Em vez de tentar "otimizar" a janela,
  // confiamos no upsert por omie_id para reaproveitar registros ja gravados.
  if (mode === "full") {
    return { dateFrom: "01-01-2022", dateTo };
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

// Erros transientes do undici/supabase-js em que vale tentar de novo:
// "TypeError: fetch failed", "ECONNRESET", "socket hang up", etc.
// Tipicamente causados por payload grande ou conexao interrompida no
// caminho ate o PostgREST.
function isTransientNetworkError(message: string | null | undefined) {
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    m.includes("fetch failed") ||
    m.includes("econnreset") ||
    m.includes("etimedout") ||
    m.includes("socket hang up") ||
    m.includes("network") ||
    m.includes("timeout")
  );
}

async function withRetry<T>(
  label: string,
  fn: () => Promise<{ data: T | null; error: { message: string } | null }>,
  maxAttempts = 4,
): Promise<{ data: T | null; error: { message: string } | null }> {
  let lastErrorMessage: string | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await fn();
      if (!result.error) return result;
      lastErrorMessage = result.error.message;
      if (!isTransientNetworkError(result.error.message) || attempt === maxAttempts) {
        return result;
      }
    } catch (err) {
      lastErrorMessage = err instanceof Error ? err.message : String(err);
      if (!isTransientNetworkError(lastErrorMessage) || attempt === maxAttempts) {
        throw err;
      }
    }
    // backoff exponencial: 500ms, 1s, 2s
    await sleep(500 * 2 ** (attempt - 1));
  }
  return { data: null, error: { message: `${label}: ${lastErrorMessage ?? "falha apos retries"}` } };
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
  // Retry em erros TRANSIENTES da Omie: HTTP 5xx (servidor sobrecarregado —
  // comum em sync de historico completo, onde ListarMovimentos pagina muitas
  // vezes) e falhas de rede (fetch failed / timeout). Leituras como
  // ListarMovimentos/Categorias/Projetos sao idempotentes, entao re-tentar e
  // seguro. Erros de negocio (faultstring / HTTP 4xx) NAO sao re-tentados —
  // sao deterministicos. Backoff: 600ms, 1.2s, 2.4s.
  const MAX_ATTEMPTS = 4;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const elapsed = Date.now() - lastRequestRef.value;
    if (lastRequestRef.value > 0 && elapsed < REQUEST_INTERVAL_MS) {
      await sleep(REQUEST_INTERVAL_MS - elapsed);
    }

    let response: Response;
    try {
      response = await fetch(url, {
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
    } catch (err) {
      // Falha de rede (undici "fetch failed", ECONNRESET, etc.) — transiente.
      lastRequestRef.value = Date.now();
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt === MAX_ATTEMPTS) throw lastError;
      await sleep(600 * 2 ** (attempt - 1));
      continue;
    }
    lastRequestRef.value = Date.now();

    if (!response.ok) {
      // 5xx = transiente (re-tenta); 4xx = erro definitivo (aborta ja).
      if (response.status >= 500 && attempt < MAX_ATTEMPTS) {
        lastError = new Error(`Omie HTTP ${response.status} em ${call}.`);
        await sleep(600 * 2 ** (attempt - 1));
        continue;
      }
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

  // Inalcancavel na pratica (o loop retorna ou lanca), mas satisfaz o tipo.
  throw lastError ?? new Error(`Falha ao chamar Omie em ${call}.`);
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
// Fetch project catalog (ListarProjetos)
// ===========================================================================
// A Omie expoe os projetos cadastrados via `geral/projetos/`. ListarMovimentos
// so traz o cCodProjeto (codigo numerico) — para conhecer o NOME do projeto
// (necessario p/ a regra da Feat Producoes: projetos "N.O." entram na DRE,
// demais ficam de fora) resolvemos codigo -> nome aqui.
//
// Retorna Map<codigo, nome>. Em caso de falha (sem permissao na API, etc.)
// devolve o que tiver — o sync continua e os entries ficam sem project_name
// (tratados como "tem projeto e nao e N.O." pela regra, default seguro).
async function fetchProjectCatalog(
  appKey: string,
  appSecret: string,
  lastRequestRef: { value: number },
): Promise<Map<string, string>> {
  const projectsByCode = new Map<string, string>();
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    try {
      const response = await omieRequest(
        OMIE_PROJETOS_URL,
        "ListarProjetos",
        appKey,
        appSecret,
        { pagina: page, registros_por_pagina: 500 },
        lastRequestRef,
      );
      const records = extractArray(response);
      for (const record of records) {
        // ListarProjetos retorna { nCodProj, cCodIntProj, cNome, cInativo }.
        // O movimento (ListarMovimentos) referencia o projeto via cCodProjeto,
        // que em algumas empresas vem como o codigo NUMERICO (nCodProj) e em
        // outras como o codigo de INTEGRACAO (cCodIntProj). Por isso indexamos
        // o nome do projeto sob TODAS as chaves de codigo disponiveis no
        // registro — assim a busca projectCatalog.get(cCodProjeto) casa
        // independentemente de qual variante a empresa usa. (Antes so o
        // primeiro code presente — nCodProj — virava chave; quando o movimento
        // trazia cCodIntProj, o nome nao resolvia e a regra "N.O." da Viva nao
        // disparava, deixando lancamentos N.O. presos em Fundos.)
        const rec = record as Record<string, unknown>;
        const name = getString(rec, [
          "cNome",
          "nome",
          "cNomeProjeto",
          "nome_projeto",
          "descricao",
        ]);
        if (!name) continue;
        for (const key of [
          "nCodProj",
          "codigo",
          "nCodProjeto",
          "codInt",
          "cCodIntProj",
        ]) {
          const codeVariant = getString(rec, [key]);
          if (codeVariant) projectsByCode.set(codeVariant, name);
        }
      }
      totalPages = Number(
        getString(response, [
          "total_de_paginas",
          "total_paginas",
          "nTotPaginas",
        ]) ?? "1",
      );
      if (!Number.isFinite(totalPages) || totalPages < 1) totalPages = page;
      page += 1;
    } catch {
      // API indisponivel/sem permissao: retorna o catalogo parcial.
      break;
    }
  }

  return projectsByCode;
}

// ===========================================================================
// Fetch department catalog (ListarDepartamentos)
// ===========================================================================
// A Omie expoe os departamentos cadastrados em cada empresa via a API
// `geral/departamentos/`. Retornamos um Map<codigo, descricao> para a
// camada de UI/persistencia popular o catalogo `company_departments`.
// ===========================================================================
export interface OmieDepartment {
  code: string;
  name: string;
}

interface DepartmentCatalog {
  /** Todos os departamentos do catalogo Omie (folhas + agregadores). */
  all: OmieDepartment[];
  /**
   * Codigos detectados como AGREGADORES (nos com filhos na arvore). O chamador
   * decide o que fazer: por padrao sao escondidos da DRE, mas um agregador que
   * recebe lancamentos diretamente deve ser resgatado (ver syncCompanyDepartments).
   */
  aggregatorCodes: Set<string>;
}

async function fetchDepartmentCatalog(
  appKey: string,
  appSecret: string,
  lastRequestRef: { value: number },
): Promise<DepartmentCatalog> {
  // Coletamos TODOS os departamentos do catalogo, incluindo agregadores, e
  // devolvemos quais sao agregadores (nos com filhos). Agregadores como
  // "Sua Empresa" (raiz da arvore VIVA GO/HERO) normalmente nao recebem
  // lancamentos diretamente e por isso nao fazem sentido como opcao de filtro;
  // mas um no com filhos pode AINDA receber lancamentos diretos (ex.: CUBO na
  // Feat Producoes), entao a decisao final de esconder fica com o chamador.
  //
  // A Omie expoe a hierarquia de varias formas dependendo do plano. Detectamos
  // agregadores por DOIS criterios (qualquer um marca como agregador):
  //   1. `estrutura` aparece como prefixo de outra estrutura (ex.: "01" e
  //      prefixo de "01.001"). Esse e o criterio principal porque a Omie
  //      sempre retorna `estrutura` para hierarquias.
  //   2. `codigo`/`cCodDepartamento` aparece como pai (`codDep`, `codigo_pai`,
  //      `cCodDepPai`) de outro registro.
  interface RawDept {
    code: string;
    name: string;
    structure: string | null;
    parentCode: string | null;
  }
  const all: RawDept[] = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    let response: Record<string, unknown>;
    try {
      response = await omieRequest(
        OMIE_DEPARTAMENTOS_URL,
        "ListarDepartamentos",
        appKey,
        appSecret,
        { pagina: page, registros_por_pagina: 500, apenas_importado_api: "N" },
        lastRequestRef,
      );
    } catch {
      // ListarDepartamentos retorna erro de "nenhum cadastro" como exception:
      // tratamos como lista vazia em vez de propagar.
      break;
    }
    const records = extractArray(response);
    for (const record of records) {
      const code = getString(record, ["codigo", "cCodDepartamento", "codDep"]);
      const description = getString(record, ["descricao", "cDescricao"]);
      const structure = getString(record, ["estrutura", "cEstrutura"]);
      const name = description ?? structure ?? code;
      const parentCode = getString(record, [
        "codigo_pai",
        "cCodDepPai",
        "codigoPai",
        "cCodPai",
        "codDepPai",
      ]);
      if (code) {
        all.push({
          code,
          name: name ?? code,
          structure,
          parentCode: parentCode ?? null,
        });
      }
    }
    totalPages = Number(
      getString(response, [
        "total_de_paginas",
        "total_paginas",
        "nTotPaginas",
      ]) ?? "1",
    );
    if (!Number.isFinite(totalPages) || totalPages < 1) totalPages = page;
    page += 1;
  }

  // 1. Marca codigos que aparecem como parent.
  const hasChildren = new Set<string>();
  for (const d of all) {
    if (d.parentCode) hasChildren.add(d.parentCode);
  }

  // 2. Marca codigos cuja `estrutura` e prefixo da estrutura de outro.
  //    Ex.: estrutura "01" e prefixo de "01.001" -> "01" e agregador.
  //    Comparacao via prefixo + delimitador "." para evitar falso positivo
  //    (estrutura "1" nao e prefixo de "10").
  const structures = all
    .map((d) => ({ code: d.code, structure: d.structure }))
    .filter((d): d is { code: string; structure: string } => Boolean(d.structure));
  for (const a of structures) {
    for (const b of structures) {
      if (a.code === b.code) continue;
      if (b.structure.startsWith(a.structure + ".")) {
        hasChildren.add(a.code);
        break;
      }
    }
  }

  // Dedup por code, retornando TODOS os departamentos + o conjunto de
  // agregadores. O filtro de "esconder agregadores" e aplicado pelo chamador,
  // que resgata os que estao em uso (recebem lancamentos).
  const byCode = new Map<string, OmieDepartment>();
  for (const d of all) {
    if (!byCode.has(d.code)) byCode.set(d.code, { code: d.code, name: d.name });
  }
  return {
    all: Array.from(byCode.values()),
    aggregatorCodes: hasChildren,
  };
}

/**
 * Busca os departamentos cadastrados na Omie para a empresa e sincroniza com
 * a tabela `company_departments` (upsert por (company_id, omie_code)).
 *
 * Mantem `included` quando ja existe — assim re-syncs nao apagam selecao
 * feita pelo usuario. Lancamentos sem departamento sao representados pela
 * linha sentinela `__none__`, criada se ainda nao existir.
 */
export async function syncCompanyDepartments(companyId: string) {
  const supabase = createAdminClient();

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
  if (!company.omie_app_key || !company.omie_app_secret) {
    throw new Error("Credenciais Omie nao configuradas para esta empresa.");
  }

  const appKey = decryptSecret(company.omie_app_key);
  const appSecret = decryptSecret(company.omie_app_secret);
  const lastRequestRef = { value: 0 };
  const catalog = await fetchDepartmentCatalog(appKey, appSecret, lastRequestRef);

  // Codigos que efetivamente recebem lancamentos (DISTINCT no banco, sem o cap
  // de 1000 linhas do PostgREST). Usado para RESGATAR agregadores em uso: um no
  // com filhos que tambem recebe lancamentos diretos (ex.: CUBO) deve continuar
  // selecionavel na DRE, em vez de ser escondido como simples agregador.
  const usedCodes = new Set<string>();
  {
    const { data: usedRows, error: usedError } = await supabase.rpc(
      "company_used_department_codes",
      { p_company_id: companyId },
    );
    if (usedError) {
      // Best-effort: se falhar, caimos no comportamento antigo (so folhas).
      console.warn("[syncCompanyDepartments] used codes warning:", usedError.message);
    } else {
      for (const row of (usedRows ?? []) as { department_code: string | null }[]) {
        if (row.department_code) usedCodes.add(row.department_code);
      }
    }
  }

  // Mantem um departamento quando: e folha (nao e agregador) OU, sendo
  // agregador, recebe lancamentos diretamente (esta em uso). Isso esconde
  // apenas o no raiz sintetico ("Sua Empresa"), sem perder departamentos
  // operacionais que tem sub-departamentos mas tambem lancamentos proprios.
  const departments = catalog.all.filter(
    (d) => !catalog.aggregatorCodes.has(d.code) || usedCodes.has(d.code),
  );

  const now = new Date().toISOString();

  // Upsert do catalogo Omie. Sentinela `__none__` e tratada na linha seguinte.
  if (departments.length > 0) {
    const rows = departments.map((d) => ({
      company_id: companyId,
      omie_code: d.code,
      name: d.name,
      synced_at: now,
      updated_at: now,
    }));
    const { error } = await supabase
      .from("company_departments")
      .upsert(rows, {
        onConflict: "company_id,omie_code",
        ignoreDuplicates: false,
      });
    if (error) {
      throw new Error(`Falha ao salvar departamentos: ${error.message}`);
    }
  }

  // Limpa departamentos obsoletos: agregadores que ficaram em syncs antigos
  // (antes do filtro por folha) ou departamentos removidos na Omie. Preserva
  // `__none__` e os codigos que vieram no catalogo atual.
  {
    const validCodes = ["__none__", ...departments.map((d) => d.code)];
    const { error } = await supabase
      .from("company_departments")
      .delete()
      .eq("company_id", companyId)
      .not("omie_code", "in", `(${validCodes.map((c) => `"${c}"`).join(",")})`);
    if (error) {
      // Nao propagamos: limpeza e best-effort. Usuario ainda consegue salvar.
      console.warn("[syncCompanyDepartments] cleanup warning:", error.message);
    }
  }

  // Sentinela "sem departamento" — so insere se ainda nao existir.
  const { data: existingNone } = await supabase
    .from("company_departments")
    .select("id")
    .eq("company_id", companyId)
    .eq("omie_code", "__none__")
    .maybeSingle();
  if (!existingNone) {
    await supabase.from("company_departments").insert({
      company_id: companyId,
      omie_code: "__none__",
      name: "Sem departamento vinculado",
      included: false,
      synced_at: now,
    });
  }

  return { count: departments.length };
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
  const isAllowed = await canSyncCompany(profile, companyId);
  if (!isAllowed) {
    throw new Error("Sem permissao para sincronizar esta empresa.");
  }
  return runCompanySyncAsSystem(companyId, mode);
}

export async function runCompanyRangeSync(
  companyId: string,
  profile: UserProfile,
  range: CustomDateRange,
) {
  const isAllowed = await canSyncCompany(profile, companyId);
  if (!isAllowed) {
    throw new Error("Sem permissao para sincronizar esta empresa.");
  }
  return runCompanySyncInternal(companyId, {
    profile: null,
    skipPermission: true,
    mode: "custom",
    customRange: range,
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
    customRange?: CustomDateRange;
  },
) {
  const supabase = options.skipPermission
    ? createAdminClient()
    : await createSupabaseClient();
  if (!options.skipPermission) {
    const isAllowed = await canSyncCompany(options.profile, companyId);
    if (!isAllowed) {
      throw new Error("Sem permissao para sincronizar esta empresa.");
    }
  }

  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("id, name, omie_app_key, omie_app_secret, last_full_sync_at, segment_id, sync_enabled")
    .eq("id", companyId)
    .single<{
      id: string;
      name: string | null;
      omie_app_key: string | null;
      omie_app_secret: string | null;
      last_full_sync_at: string | null;
      segment_id: string | null;
      sync_enabled: boolean | null;
    }>();

  if (companyError || !company) {
    throw new Error("Empresa nao encontrada.");
  }

  // Gate central de sincronizacao: cobre o cron e todos os disparos manuais
  // (/api/sync/[id], /full, /manual). Empresas fora do pacote de servicos
  // (sync_enabled=false) nao sao sincronizadas, preservando os dados historicos
  // ja apagados a partir do fim do contrato. `active` continua controlando so a
  // visibilidade nas telas.
  if (company.sync_enabled === false) {
    throw new Error(
      "Sincronizacao desativada para esta empresa (fora do pacote de servicos).",
    );
  }

  const effectiveMode =
    options.mode === "incremental" && !company.last_full_sync_at
      ? "full"
      : options.mode;

  const { dateFrom, dateTo } = calculateDateRange(
    effectiveMode,
    company.last_full_sync_at,
    options.customRange,
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
      supabase,
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

    // Invalida o cache do Next para que a proxima navegacao ao Dashboard
    // (ou rotas relacionadas) renderize com o snapshot pos-sync. Sem isso,
    // abas abertas antes do sync continuam mostrando o snapshot antigo
    // ate o usuario forcar refresh manual — causa raiz da discrepancia
    // recorrente entre celula da DRE e total do Drilldown.
    try {
      revalidatePath("/(app)", "layout");
    } catch {
      // revalidatePath nao esta disponivel fora de contexto Next (ex: testes
      // standalone). Sync ainda foi gravado com sucesso, falha aqui e benigna.
    }

    // Hook ADITIVO e ISOLADO: só para a Case Shows, alimenta a tabela gerencial
    // da seção "Custódia de Artistas - Análise Competência" (dados por DATA DE
    // REGISTRO, via ListarMovimentos dDtRegDe/dDtRegAte). Best-effort: qualquer
    // falha aqui é logada e ignorada — NÃO afeta o resultado do sync oficial,
    // nem outras empresas, nem o pipeline regime-de-caixa.
    if ((company.name ?? "").trim().toLowerCase() === CASE_SHOWS_COMPANY_NAME.toLowerCase()) {
      try {
        await runCaseShowsCustodyCompetenciaSync({
          supabase,
          companyId,
          appKey,
          appSecret,
        });
      } catch (custodyError) {
        console.error(
          "[case-shows-custody] Falha ao atualizar competência (ignorado, não afeta o sync):",
          custodyError instanceof Error ? custodyError.message : custodyError,
        );
      }
    }

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
  supabase,
}: {
  companyId: string;
  appKey: string;
  appSecret: string;
  lastRequestRef: { value: number };
  mode: SyncMode;
  dateFrom: string;
  dateTo: string;
  segmentId: string | null;
  supabase: Awaited<ReturnType<typeof createSupabaseClient>>;
}): Promise<SyncResult> {

  // 1. Buscar movimentos financeiros filtrados por data de pagamento
  //    + catalogo de categorias + nomes de clientes/fornecedores.
  const [rawMovimentos, categoryCatalog, clientNames] = await Promise.all([
    fetchAllMovimentos(appKey, appSecret, dateFrom, dateTo, lastRequestRef),
    fetchCategoryCatalog(appKey, appSecret, lastRequestRef),
    fetchClientNames(appKey, appSecret, lastRequestRef),
  ]);

  // Catalogo de projetos buscado SEQUENCIALMENTE (fora do Promise.all acima)
  // de proposito: o rate-limiter da Omie e compartilhado por `lastRequestRef`
  // e, sob concorrencia, rajadas escapam do intervalo de 350ms. Em sync de
  // historico completo (muitas paginas de ListarMovimentos) um endpoint
  // concorrente a mais derrubava a Omie com HTTP 500. Como ListarProjetos so
  // alimenta a regra da Feat (e e tolerante a falha — retorna Map vazio), nao
  // ha perda em busca-lo depois, sem competir com a carga pesada.
  const projectCatalog = await fetchProjectCatalog(appKey, appSecret, lastRequestRef);

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
  // Case Shows: usa a data de recebimento do TÍTULO nas baixas de boleto
  // (Omie.CASH credita D+1), reproduzindo o relatório oficial da Omie. Inerte
  // para as demais empresas. Ver processBaixasDoTitulo em financial-processor.ts.
  const { entries } = processMovimentos(rawMovimentos, companyId, {
    useTituloReceiptDate: companyId === CASE_COMPANY_ID,
  });

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
      // Buscar IDs das 4 contas DRE envolvidas, escopadas por empresa.
      //
      // Sem escopo, o `in("code", [...])` traz tanto a conta GLOBAL
      // (company_id IS NULL) quanto a versao custom de outras empresas do
      // mesmo segmento (ex.: Hero Holding tem plano custom). O `Map.set`
      // abaixo sobrescreve por code em ordem nao-deterministica e a
      // empresa pode acabar com mappings para a conta de OUTRA empresa
      // — caso observado em Viva Petropolis Ago/2023, onde
      // `__fundos_desp_2.08.96` ficou apontando para a conta 5.9 custom da
      // Hero, e os R$ 7.000 daquela despesa nao apareciam na DRE da
      // Petropolis (que usa o plano global). Mesma logica de scope do
      // dashboard em src/app/(app)/dashboard/page.tsx.
      const { data: dreAccountsAll } = await supabase
        .from("dre_accounts")
        .select("id,code,company_id")
        .in("code", ["2.4", "7.5.5", "5.8", "5.9"])
        .eq("active", true);

      const companyHasCustomPlan = (dreAccountsAll ?? []).some(
        (a) => a.company_id === companyId,
      );
      const dreAccounts = (dreAccountsAll ?? []).filter((a) =>
        companyHasCustomPlan
          ? a.company_id === companyId
          : a.company_id === null,
      );

      const dreIdByCode = new Map<string, string>();
      dreAccounts.forEach((a) => {
        dreIdByCode.set(a.code as string, a.id as string);
      });

      const recRessarcId = dreIdByCode.get("2.4");    // Receitas Ressarciveis
      const despRessarcId = dreIdByCode.get("7.5.5");  // Despesas Ressarciveis
      const fundosRecId = dreIdByCode.get("5.8");      // Receitas Ressarciveis - Fundos
      const fundosDespId = dreIdByCode.get("5.9");     // Despesas Ressarciveis - Fundos

      if (recRessarcId && despRessarcId && fundosRecId && fundosDespId) {
        // FONTE UNICA DE VERDADE: catalogo Omie da PROPRIA empresa.
        //
        // A regra de Fundos (cCodProjeto) so vale para categorias cujo NOME
        // no catalogo Omie da empresa seja exatamente um dos 4 canonicos:
        //   "Receitas Ressarciveis", "Receitas Ressarciveis (*)",
        //   "Despesas Ressarciveis", "Despesas Ressarciveis (*)".
        //
        // Comparacao case/acentos-insensivel, por IGUALDADE (nao substring).
        // Mapeamentos manuais em category_mapping NAO sao consultados aqui
        // de proposito: o mesmo codigo Omie (ex.: "1.04.98") pode ser
        // "Estorno de Pagamento" no catalogo de uma empresa e ter sido
        // mapeado erroneamente para 2.4/7.5.5 em outra — confiar no nome
        // canonico do catalogo da propria empresa evita contaminar a regra
        // de Fundos com categorias nao-ressarciveis.
        const effectiveMapping = new Map<string, string>(); // category_code → dre_account_id (2.4 ou 7.5.5)
        for (const [code, description] of Array.from(categoryCatalog.entries())) {
          const trimmed = description.toLowerCase()
            .normalize("NFD").replace(/[̀-ͯ]/g, "")
            .trim();
          if (
            trimmed === "receitas ressarciveis" ||
            trimmed === "receitas ressarciveis (*)"
          ) {
            effectiveMapping.set(code, recRessarcId);
          } else if (
            trimmed === "despesas ressarciveis" ||
            trimmed === "despesas ressarciveis (*)"
          ) {
            effectiveMapping.set(code, despRessarcId);
          }
        }

        // Roteamento DETERMINISTICO das 4 linhas de ressarciveis.
        //
        // Para CADA lancamento de uma categoria ressarcivel (detectada pelo
        // nome canonico no catalogo), reescrevemos o category_code para uma
        // sintetica que aponta exatamente para a conta DRE correta, conforme
        // o projeto vinculado:
        //
        //   • projeto OPERACIONAL (cCodProjeto preenchido e nome != "N.O.")
        //       → Fundos: 5.8 (receita) / 5.9 (despesa)  — grupo "custos com
        //         servicos prestados". Prefixo __fundos_rec_/__fundos_desp_.
        //   • SEM projeto  OU  projeto "N.O." (nao-operacional)
        //       → ressarcivel comum: 2.4 (receita) / 7.5.5 (despesa) — grupos
        //         "outras receitas/despesas". Prefixo __ressarc_rec_/__ressarc_desp_.
        //
        // Por que rotear TAMBEM o caso "comum" (em vez de so manter o
        // category_code original)? Porque o mapeamento-base da categoria na
        // tela de mapeamento pode apontar para Fundos (5.8/5.9) — caso real da
        // viva go, onde "Despesas/Receitas Ressarciveis" estao vinculadas a
        // 5.9/5.8. Se apenas mantivessemos o codigo original, os lancamentos
        // sem projeto e os "N.O." cairiam em Fundos junto com os operacionais,
        // e a linha "outras despesas/receitas" ficaria zerada. Roteando para a
        // conta canonica (2.4/7.5.5, ja resolvida em effectiveMapping/dreIdByCode
        // com escopo da empresa) garantimos a separacao correta INDEPENDENTE do
        // vinculo-base — sem alterar a tela de mapeamento. Para empresas ja
        // configuradas com base = 2.4/7.5.5 o destino e o MESMO (no-op visivel).
        //
        // Exceção "N.O.": nome do projeto vem do catalogo da Omie
        // (ListarProjetos) via `projectCatalog` (cCodProjeto → nome). Predicado
        // literal/case-sensitive por "N.O." (N . O .), mesma semantica da regra
        // da Feat Producoes (dre_entry_excluded_by_project). `replace(/^\s+/,"")`
        // ignora apenas espacos a esquerda. Catalogo indisponivel (nome null) →
        // projeto tratado como operacional → Fundos (default seguro, preserva o
        // comportamento historico de quando o nome nao resolve).
        const fundosMappingsNeeded = new Map<string, { code: string; dreId: string; name: string }>();
        const newEntries: typeof entries = [];

        for (const entry of entries) {
          if (!entry.category_code) {
            newEntries.push(entry);
            continue;
          }
          const canonicalRessarcId = effectiveMapping.get(entry.category_code);
          if (!canonicalRessarcId) {
            newEntries.push(entry);
            continue;
          }
          const isReceita = canonicalRessarcId === recRessarcId;

          const raw = entry.raw_json ?? {};
          const det = (typeof raw.detalhes === "object" && raw.detalhes !== null)
            ? (raw.detalhes as Record<string, unknown>)
            : raw;
          const projeto = getString(det, ["cCodProjeto"]);
          const projetoNome = projeto ? (projectCatalog.get(projeto) ?? null) : null;
          const isOperacional =
            !!projeto &&
            !(projetoNome !== null && projetoNome.replace(/^\s+/, "").startsWith("N.O."));

          let targetDreId: string;
          let prefix: string;
          let label: string;
          if (isOperacional) {
            // projeto operacional → Fundos (custos com servicos prestados)
            targetDreId = isReceita ? fundosRecId : fundosDespId;
            prefix = isReceita ? "__fundos_rec_" : "__fundos_desp_";
            label = isReceita
              ? "Receitas Ressarciveis - Fundos (projeto)"
              : "Despesas Ressarciveis - Fundos (projeto)";
          } else {
            // sem projeto OU projeto "N.O." → ressarcivel comum (outras rec/desp)
            targetDreId = canonicalRessarcId;
            prefix = isReceita ? "__ressarc_rec_" : "__ressarc_desp_";
            label = isReceita
              ? "Receitas Ressarciveis (sem projeto/N.O.)"
              : "Despesas Ressarciveis (sem projeto/N.O.)";
          }

          const newCode = `${prefix}${entry.category_code}`;
          const redirected = Object.assign({}, entry, { category_code: newCode });
          newEntries.push(redirected);

          if (!fundosMappingsNeeded.has(newCode)) {
            fundosMappingsNeeded.set(newCode, { code: newCode, dreId: targetDreId, name: label });
          }
        }

        // Substituir entries pelo array com redirects aplicados
        entries.length = 0;
        entries.push(...newEntries);

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

  // 3.2 Roteamento por projeto (qualquer empresa com linhas em project_mapping).
  //     Usado por empresas do segmento Real Estate (ex.: SGX), onde cada
  //     imovel / empreendimento tem uma conta DRE propria e o lancamento e
  //     classificado no Omie via cCodProjeto em vez de categoria.
  //
  //     Regra:
  //       - Entry sem cCodProjeto             → mantem mapeamento por categoria (fallback)
  //       - Entry com projeto NAO mapeado     → mantem mapeamento por categoria (fallback)
  //       - Entry com projeto mapeado:
  //           type=receita  → roteia para dre_account_revenue_id
  //           type=despesa  → roteia para dre_account_expense_id
  //
  //     Mesmo padrao da regra de Fundos (Viva): reescreve o category_code do
  //     entry para uma sintetica `__proj_<projeto>_<rec|desp>` e cria/atualiza
  //     a linha correspondente em category_mapping (delete + insert idempotente).
  //     Isso preserva o pipeline do dashboard_dre_aggregate sem mudar a RPC.
  //
  //     Empresas sem linhas em project_mapping ignoram este bloco inteiro —
  //     comportamento atual preservado para Viva, Hero, Feat, etc.
  {
    const { data: projectMappings } = await supabase
      .from("project_mapping")
      .select("omie_project_code,dre_account_revenue_id,dre_account_expense_id")
      .eq("company_id", companyId);

    if (projectMappings && projectMappings.length > 0) {
      const byProject = new Map<string, { rev: string | null; exp: string | null }>(
        projectMappings.map((p: {
          omie_project_code: string;
          dre_account_revenue_id: string | null;
          dre_account_expense_id: string | null;
        }) => [
          p.omie_project_code,
          { rev: p.dre_account_revenue_id, exp: p.dre_account_expense_id },
        ]),
      );

      const projectMappingsNeeded = new Map<string, { code: string; dreId: string; name: string }>();
      const newEntries: typeof entries = [];

      for (const entry of entries) {
        const raw = entry.raw_json ?? {};
        const det = (typeof raw.detalhes === "object" && raw.detalhes !== null)
          ? (raw.detalhes as Record<string, unknown>)
          : raw;
        const projeto = getString(det, ["cCodProjeto"]);

        if (!projeto) {
          newEntries.push(entry);
          continue;
        }

        const mapping = byProject.get(projeto);
        if (!mapping) {
          // projeto preenchido mas nao mapeado → fallback para categoria
          newEntries.push(entry);
          continue;
        }

        const targetDreId = entry.type === "receita" ? mapping.rev : mapping.exp;
        if (!targetDreId) {
          // mapeamento incompleto (faltando conta para esse tipo) → fallback
          newEntries.push(entry);
          continue;
        }

        const suffix = entry.type === "receita" ? "rec" : "desp";
        const newCode = `__proj_${projeto}_${suffix}`;
        const redirected = Object.assign({}, entry, { category_code: newCode });
        newEntries.push(redirected);

        if (!projectMappingsNeeded.has(newCode)) {
          projectMappingsNeeded.set(newCode, {
            code: newCode,
            dreId: targetDreId,
            name: `Projeto ${projeto} (${entry.type})`,
          });
        }
      }

      entries.length = 0;
      entries.push(...newEntries);

      if (projectMappingsNeeded.size > 0) {
        const codes = Array.from(projectMappingsNeeded.keys());
        await supabase
          .from("category_mapping")
          .delete()
          .eq("company_id", companyId)
          .in("omie_category_code", codes);

        const rows = Array.from(projectMappingsNeeded.values()).map((m) => ({
          omie_category_code: m.code,
          omie_category_name: m.name,
          dre_account_id: m.dreId,
          company_id: companyId,
        }));
        await supabase.from("category_mapping").insert(rows);
      }
    }
  }

  // 3.3 Resolver o NOME do projeto vinculado (project_name) a partir do
  //     catalogo Omie (ListarProjetos). O processador ja preencheu
  //     project_code; aqui anexamos o nome. Setamos project_name em TODAS as
  //     entries (null quando nao ha projeto ou o codigo nao consta no
  //     catalogo) para manter o conjunto de colunas uniforme no upsert em
  //     lote do PostgREST.
  //
  //     Esses campos sao consumidos pela regra de DRE da Feat Producoes
  //     (RPCs dashboard_dre_aggregate/_by_company/drilldown via
  //     dre_entry_excluded_by_project). Para as demais empresas os campos
  //     ficam gravados mas inertes (a flag dre_exclude_linked_projects e
  //     false), entao nada muda no comportamento delas.
  for (const entry of entries) {
    entry.project_name = entry.project_code
      ? projectCatalog.get(entry.project_code) ?? null
      : null;
  }

  // 4. Deduplicar por omie_id (ultima ocorrencia vence).
  const deduped = new Map<string, NormalizedEntry>();
  for (const entry of entries) {
    deduped.set(entry.omie_id, entry);
  }
  const uniqueEntries = Array.from(deduped.values());

  // 5. Upsert lancamentos normalizados.
  //
  //    Batch de 200 (nao 500): cada entry inclui raw_json (registro Omie
  //    cru) + processing_metadata. Em empresas com volume + payload rico
  //    (ex.: Viva Go), batches grandes geram POSTs de varios MB e batem
  //    em limites/timeouts no caminho ate o PostgREST — visiveis como
  //    "TypeError: fetch failed" do undici, antes mesmo do Postgres ver
  //    o request. withRetry cobre falhas transientes de rede.
  const batches = chunk(uniqueEntries, 200);
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const { error } = await withRetry(
      `upsert financial_entries batch ${i + 1}/${batches.length}`,
      async () => {
        const r = await supabase
          .from("financial_entries")
          .upsert(batch, { onConflict: "company_id,omie_id" });
        return { data: r.data, error: r.error };
      },
    );
    if (error) {
      throw new Error(
        `Falha ao salvar lancamentos (batch ${i + 1}/${batches.length}, ${batch.length} registros): ${error.message}`,
      );
    }
  }

  // 5. Limpar lancamentos obsoletos dentro do periodo buscado via RPC SQL.
  //
  //    Versao anterior fazia SELECT id, omie_id em JS — sujeito ao limite
  //    default de ~1000 linhas do PostgREST. Para empresas com volume
  //    > 1000 linhas no escopo, o cleanup deixava entries antigos para
  //    tras (ex.: omie_ids no formato legado nao sobrescritos por upsert),
  //    causando duplicatas persistentes apos Full Sync.
  //
  //    A RPC SQL abaixo executa o DELETE atomicamente sem paginacao.
  //    - Full: omite p_date_from/p_date_to → escopo total da empresa.
  //    - Rolling/Incremental: passa as datas → escopo restrito.
  let recordsDeleted = 0;
  {
    const validOmieIds = uniqueEntries.map((e) => e.omie_id);

    const [dd1, mm1, yyyy1] = dateFrom.split("-");
    const [dd2, mm2, yyyy2] = dateTo.split("-");
    const dbDateFrom = `${yyyy1}-${mm1}-${dd1}`;
    const dbDateTo = `${yyyy2}-${mm2}-${dd2}`;

    const { data: obsoleteDeleted, error: obsoleteError } = await supabase.rpc(
      "cleanup_obsolete_entries",
      {
        p_company_id: companyId,
        p_valid_omie_ids: validOmieIds,
        p_date_from: mode === "full" ? null : dbDateFrom,
        p_date_to: mode === "full" ? null : dbDateTo,
      },
    );
    if (obsoleteError) {
      throw new Error(
        `Falha ao limpar lancamentos obsoletos: ${obsoleteError.message}`,
      );
    }
    recordsDeleted = Number(obsoleteDeleted ?? 0);

    // 5b. Limpeza global de duplicatas pai-vs-baixa por nCodTitulo.
    const { data: pvbDeleted, error: pvbError } = await supabase.rpc(
      "cleanup_parent_vs_baixa_duplicates",
      { p_company_id: companyId },
    );
    if (pvbError) {
      throw new Error(
        `Falha ao limpar entries legados de titulos com baixas: ${pvbError.message}`,
      );
    }
    recordsDeleted += Number(pvbDeleted ?? 0);

    // 5c. Dedup por nCodMovCC — consolida duplicatas estruturais (parent,
    //     baixa, conciliacao) que apontam para o mesmo movimento bancario.
    //     Mantem a linha mais recente por (company_id, nCodMovCC, rateio).
    const { data: nccDeleted, error: nccError } = await supabase.rpc(
      "dedupe_financial_entries_by_ncodmovcc",
      { p_company_id: companyId },
    );
    if (nccError) {
      throw new Error(
        `Falha ao deduplicar por nCodMovCC: ${nccError.message}`,
      );
    }
    recordsDeleted += Number(nccDeleted ?? 0);
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

  // 8. Atualiza as pre-agregacoes (DRE + Fluxo de Caixa) desta empresa e dos
  //    destinos para onde ela roteia departamentos. Best-effort: nao derruba o
  //    sync se falhar (o agregado so fica defasado ate o proximo refresh).
  const [aggDre, aggCash] = await Promise.all([
    refreshDreAggregatesForSource(supabase, companyId),
    refreshCashFlowAggregatesForSource(supabase, companyId),
  ]);
  if (!aggDre.ok) {
    console.error(
      `[sync] Falha ao atualizar dre_monthly_aggregates de ${companyId}: ${aggDre.error}`,
    );
  }
  if (!aggCash.ok) {
    console.error(
      `[sync] Falha ao atualizar cash_flow_monthly_aggregates de ${companyId}: ${aggCash.error}`,
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
