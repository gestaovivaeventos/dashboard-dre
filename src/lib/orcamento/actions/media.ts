"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { getOrcamentoAdmin } from "@/lib/orcamento/auth";
import { isSchemaMissing } from "@/lib/orcamento/errors";
import { isValidBudgetYear } from "@/lib/orcamento/years";
import { INDICES, type IndiceKey } from "@/lib/orcamento/indices";

const PATH = "/orcamento/despesas/media";

// ─── Tipos ────────────────────────────────────────────────────────────────────

/** Realizado do ano-base de uma categoria, mês a mês. */
export interface MediaRealizado {
  /** 12 posições (jan…dez). null = mês sem pagamento no ano-base. */
  meses: (number | null)[];
  /** Soma dos meses com valor. */
  total: number;
  /** Quantos meses tiveram pagamento (denominador da média). */
  mesesComValor: number;
  /** total / mesesComValor. null quando não há nenhum mês com valor. */
  media: number | null;
}

export interface MediaCategoriaItem {
  categoryCode: string;
  categoryName: string;
  /** Média efetiva salva (snapshot). null = ainda não calculada/salva. */
  mediaValor: number | null;
  /** true = valor editado à mão (≠ recalculado da Omie). */
  manual: boolean;
  /** Índice de correção escolhido (null = sem correção). */
  indiceKey: IndiceKey | null;
  baseYear: number | null;
  mesesConsiderados: number | null;
  calculadoEm: string | null;
  /** Realizado do ano-base recalculado ao vivo (para sugestão e detalhe). */
  realizado: MediaRealizado;
}

/** Índice de correção disponível, com o valor (%) do ano do orçamento. */
export interface IndiceOption {
  key: IndiceKey;
  label: string;
  /** Percentual cadastrado para o ano do orçamento. null = não cadastrado. */
  value: number | null;
}

export interface MediaSetup {
  items: MediaCategoriaItem[];
  /** Ano-base da média (ano do orçamento − 1). */
  baseYear: number;
  /** Índices percentuais disponíveis para correção, com o valor do ano. */
  indices: IndiceOption[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function db() {
  return createAdminClientIfAvailable();
}

/** Só os índices percentuais servem para correção (salário mínimo é valor R$). */
const INDICES_PERCENT = INDICES.filter((i) => i.unit === "percent");
const INDICE_KEYS = new Set<string>(INDICES_PERCENT.map((i) => i.key));

function isIndiceKey(value: unknown): value is IndiceKey {
  return typeof value === "string" && INDICE_KEYS.has(value);
}

interface RealizadoRow {
  category_code: string;
  month: number;
  total: number | string;
}

/** Agrupa as linhas do RPC (categoria × mês) em um realizado por categoria. */
function buildRealizados(rows: RealizadoRow[]): Map<string, MediaRealizado> {
  const byCode = new Map<string, (number | null)[]>();
  for (const r of rows) {
    const code = r.category_code;
    if (!byCode.has(code)) byCode.set(code, Array(12).fill(null));
    const meses = byCode.get(code)!;
    const idx = Number(r.month) - 1;
    if (idx >= 0 && idx < 12) meses[idx] = Number(r.total);
  }
  const out = new Map<string, MediaRealizado>();
  byCode.forEach((meses, code) => out.set(code, resumirRealizado(meses)));
  return out;
}

function resumirRealizado(meses: (number | null)[]): MediaRealizado {
  let total = 0;
  let mesesComValor = 0;
  for (const v of meses) {
    if (v == null) continue;
    total += v;
    mesesComValor += 1;
  }
  const media = mesesComValor > 0 ? total / mesesComValor : null;
  return { meses, total, mesesComValor, media };
}

const REALIZADO_VAZIO: MediaRealizado = {
  meses: Array(12).fill(null),
  total: 0,
  mesesComValor: 0,
  media: null,
};

/** Lê o realizado do ano-base para um conjunto de categorias (via RPC). */
async function fetchRealizados(
  supabase: Awaited<ReturnType<typeof createClient>>,
  companyId: string,
  baseYear: number,
  codes: string[],
): Promise<Map<string, MediaRealizado>> {
  if (codes.length === 0) return new Map();
  const { data, error } = await supabase.rpc("orcamento_media_realizado", {
    p_company_id: companyId,
    p_base_year: baseYear,
    p_category_codes: codes,
  });
  if (error) return new Map();
  return buildRealizados((data ?? []) as RealizadoRow[]);
}

/** Códigos + nomes das categorias marcadas com o método 'media' na empresa/ano. */
async function fetchCategoriasMedia(
  supabase: Awaited<ReturnType<typeof createClient>>,
  companyId: string,
  year: number,
): Promise<{ codes: Map<string, string>; needsMigration?: boolean; error?: string }> {
  const { data, error } = await supabase
    .from("orcamento_categoria_metodo")
    .select("category_code, category_name")
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("metodo", "media");
  if (error) {
    if (isSchemaMissing(error.message)) return { codes: new Map(), needsMigration: true };
    return { codes: new Map(), error: error.message };
  }
  const codes = new Map<string, string>();
  for (const r of data ?? []) {
    codes.set(r.category_code as string, (r.category_name as string) ?? (r.category_code as string));
  }
  return { codes };
}

// ─── Leitura ────────────────────────────────────────────────────────────────

export async function getMediaCategorias(
  companyId: string,
  year: number,
): Promise<{ setup?: MediaSetup; error?: string; needsMigration?: boolean }> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!companyId) {
    return { setup: { items: [], baseYear: year - 1, indices: [] } };
  }
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const supabase = db() ?? (await createClient());
  const baseYear = year - 1;

  // Índices percentuais do ano do orçamento (para o seletor de correção).
  const { data: indiceRowRaw } = await supabase
    .from("orcamento_indices")
    .select("*")
    .eq("year", year)
    .maybeSingle();
  const indiceRow = (indiceRowRaw ?? null) as Record<string, number | null> | null;
  const indices: IndiceOption[] = INDICES_PERCENT.map((meta) => {
    const v = indiceRow?.[meta.key];
    return {
      key: meta.key,
      label: meta.label,
      value: v == null ? null : Number(v),
    };
  });

  // Categorias marcadas como 'media'.
  const cats = await fetchCategoriasMedia(supabase, companyId, year);
  if (cats.needsMigration) return { needsMigration: true };
  if (cats.error) return { error: cats.error };
  const codes = Array.from(cats.codes.keys());
  if (codes.length === 0) {
    return { setup: { items: [], baseYear, indices } };
  }

  // Snapshots salvos.
  const { data: saved, error: savedError } = await supabase
    .from("orcamento_media_categorias")
    .select("category_code, media_valor, manual, indice_key, base_year, meses_considerados, calculado_em")
    .eq("company_id", companyId)
    .eq("year", year);
  if (savedError) {
    if (isSchemaMissing(savedError.message)) return { needsMigration: true };
    return { error: savedError.message };
  }
  const savedByCode = new Map(
    (saved ?? []).map((r) => [r.category_code as string, r]),
  );

  // Realizado do ano-base ao vivo (sugestão + detalhe mensal).
  const realizados = await fetchRealizados(supabase, companyId, baseYear, codes);

  const items: MediaCategoriaItem[] = codes.map((code) => {
    const row = savedByCode.get(code);
    const indiceKey = isIndiceKey(row?.indice_key) ? (row!.indice_key as IndiceKey) : null;
    return {
      categoryCode: code,
      categoryName: cats.codes.get(code) ?? code,
      mediaValor: row?.media_valor == null ? null : Number(row.media_valor),
      manual: Boolean(row?.manual),
      indiceKey,
      baseYear: row?.base_year == null ? null : Number(row.base_year),
      mesesConsiderados: row?.meses_considerados == null ? null : Number(row.meses_considerados),
      calculadoEm: (row?.calculado_em as string) ?? null,
      realizado: realizados.get(code) ?? REALIZADO_VAZIO,
    };
  });

  items.sort((a, b) => a.categoryName.localeCompare(b.categoryName, "pt-BR"));

  return { setup: { items, baseYear, indices } };
}

// ─── Cálculo / edição ─────────────────────────────────────────────────────────

/** Recalcula a média de UMA categoria a partir da Omie e grava como snapshot
 * (manual = false). É o botão "Recalcular pela Omie" da linha. */
export async function calcularMedia(
  companyId: string,
  year: number,
  categoryCode: string,
  categoryName: string,
): Promise<{ ok?: true; item?: MediaCategoriaItem; error?: string; needsMigration?: boolean }> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!companyId || !categoryCode) return { error: "Categoria inválida." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const supabase = db() ?? (await createClient());
  const baseYear = year - 1;
  const realizados = await fetchRealizados(supabase, companyId, baseYear, [categoryCode]);
  const realizado = realizados.get(categoryCode) ?? REALIZADO_VAZIO;
  const calculadoEm = new Date().toISOString();

  const { error } = await supabase.from("orcamento_media_categorias").upsert(
    {
      company_id: companyId,
      year,
      category_code: categoryCode,
      category_name: categoryName,
      media_valor: realizado.media,
      manual: false,
      base_year: baseYear,
      meses_considerados: realizado.mesesComValor,
      calculado_em: calculadoEm,
      updated_by: admin.userId,
    },
    { onConflict: "company_id,year,category_code" },
  );
  if (error) {
    if (isSchemaMissing(error.message)) return { needsMigration: true };
    return { error: error.message };
  }
  revalidatePath(PATH);
  return {
    ok: true,
    item: {
      categoryCode,
      categoryName,
      mediaValor: realizado.media,
      manual: false,
      indiceKey: null, // preservado no banco; a tela recarrega o índice do estado local
      baseYear,
      mesesConsiderados: realizado.mesesComValor,
      calculadoEm,
      realizado,
    },
  };
}

/** Recalcula a média de TODAS as categorias 'media' da empresa/ano. */
export async function recalcularTodasMedias(
  companyId: string,
  year: number,
): Promise<{ ok?: true; atualizadas?: number; error?: string; needsMigration?: boolean }> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!companyId) return { error: "Selecione uma empresa." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const supabase = db() ?? (await createClient());
  const cats = await fetchCategoriasMedia(supabase, companyId, year);
  if (cats.needsMigration) return { needsMigration: true };
  if (cats.error) return { error: cats.error };
  const codes = Array.from(cats.codes.keys());
  if (codes.length === 0) return { ok: true, atualizadas: 0 };

  const baseYear = year - 1;
  const realizados = await fetchRealizados(supabase, companyId, baseYear, codes);
  const calculadoEm = new Date().toISOString();

  const rows = codes.map((code) => {
    const realizado = realizados.get(code) ?? REALIZADO_VAZIO;
    return {
      company_id: companyId,
      year,
      category_code: code,
      category_name: cats.codes.get(code) ?? code,
      media_valor: realizado.media,
      manual: false,
      base_year: baseYear,
      meses_considerados: realizado.mesesComValor,
      calculado_em: calculadoEm,
      updated_by: admin.userId,
    };
  });

  const { error } = await supabase
    .from("orcamento_media_categorias")
    .upsert(rows, { onConflict: "company_id,year,category_code" });
  if (error) {
    if (isSchemaMissing(error.message)) return { needsMigration: true };
    return { error: error.message };
  }
  revalidatePath(PATH);
  return { ok: true, atualizadas: rows.length };
}

/** Edição manual do valor da média (manual = true). null limpa o valor. */
export async function setMediaValor(
  companyId: string,
  year: number,
  categoryCode: string,
  categoryName: string,
  valor: number | null,
): Promise<{ ok?: true; error?: string; needsMigration?: boolean }> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!companyId || !categoryCode) return { error: "Categoria inválida." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };
  if (valor != null && (!Number.isFinite(valor) || valor < 0)) {
    return { error: "Valor da média inválido." };
  }

  const supabase = db() ?? (await createClient());
  const { error } = await supabase.from("orcamento_media_categorias").upsert(
    {
      company_id: companyId,
      year,
      category_code: categoryCode,
      category_name: categoryName,
      media_valor: valor,
      manual: valor != null,
      updated_by: admin.userId,
    },
    { onConflict: "company_id,year,category_code" },
  );
  if (error) {
    if (isSchemaMissing(error.message)) return { needsMigration: true };
    return { error: error.message };
  }
  revalidatePath(PATH);
  return { ok: true };
}

/** Define (ou remove) o índice de correção aplicado à média. */
export async function setMediaIndice(
  companyId: string,
  year: number,
  categoryCode: string,
  categoryName: string,
  indiceKey: IndiceKey | null,
): Promise<{ ok?: true; error?: string; needsMigration?: boolean }> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!companyId || !categoryCode) return { error: "Categoria inválida." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };
  if (indiceKey != null && !isIndiceKey(indiceKey)) return { error: "Índice inválido." };

  const supabase = db() ?? (await createClient());
  const { error } = await supabase.from("orcamento_media_categorias").upsert(
    {
      company_id: companyId,
      year,
      category_code: categoryCode,
      category_name: categoryName,
      indice_key: indiceKey,
      updated_by: admin.userId,
    },
    { onConflict: "company_id,year,category_code" },
  );
  if (error) {
    if (isSchemaMissing(error.message)) return { needsMigration: true };
    return { error: error.message };
  }
  revalidatePath(PATH);
  return { ok: true };
}
