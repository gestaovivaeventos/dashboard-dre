"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { getOrcamentoAdmin } from "@/lib/orcamento/auth";
import { isSchemaMissing } from "@/lib/orcamento/errors";
import { isValidBudgetYear } from "@/lib/orcamento/years";
import { INDICES, type IndiceKey } from "@/lib/orcamento/indices";

const PATH = "/orcamento";

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface ValorFixoItem {
  categoryCode: string;
  categoryName: string;
  /** Valor base informado (ex.: custo atual). null = ainda não preenchido. */
  valorBase: number | null;
  /** Índice de correção escolhido (null = sem correção). */
  indiceKey: IndiceKey | null;
  /** Mês (1..12) em que o reajuste passa a valer. null = sem reajuste no ano. */
  mesReajuste: number | null;
}

/** Índice de correção disponível, com o valor (%) do ano do orçamento. */
export interface IndiceOption {
  key: IndiceKey;
  label: string;
  value: number | null;
}

export interface ValorFixoSetup {
  items: ValorFixoItem[];
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

/** Códigos + nomes das categorias marcadas com 'valor_fixo' na empresa/ano. */
async function fetchCategoriasValorFixo(
  supabase: Awaited<ReturnType<typeof createClient>>,
  companyId: string,
  year: number,
): Promise<{ codes: Map<string, string>; needsMigration?: boolean; error?: string }> {
  const { data, error } = await supabase
    .from("orcamento_categoria_metodo")
    .select("category_code, category_name")
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("metodo", "valor_fixo");
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

export async function getValorFixoCategorias(
  companyId: string,
  year: number,
): Promise<{ setup?: ValorFixoSetup; error?: string; needsMigration?: boolean }> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!companyId) return { setup: { items: [], indices: [] } };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const supabase = db() ?? (await createClient());

  // Índices percentuais do ano do orçamento (para o seletor de correção).
  const { data: indiceRowRaw } = await supabase
    .from("orcamento_indices")
    .select("*")
    .eq("year", year)
    .maybeSingle();
  const indiceRow = (indiceRowRaw ?? null) as Record<string, number | null> | null;
  const indices: IndiceOption[] = INDICES_PERCENT.map((meta) => ({
    key: meta.key,
    label: meta.label,
    value: indiceRow?.[meta.key] == null ? null : Number(indiceRow[meta.key]),
  }));

  // Categorias marcadas como 'valor_fixo'.
  const cats = await fetchCategoriasValorFixo(supabase, companyId, year);
  if (cats.needsMigration) return { needsMigration: true };
  if (cats.error) return { error: cats.error };
  const codes = Array.from(cats.codes.keys());
  if (codes.length === 0) return { setup: { items: [], indices } };

  // Snapshots salvos.
  const { data: saved, error: savedError } = await supabase
    .from("orcamento_valor_fixo_categorias")
    .select("category_code, valor_base, indice_key, mes_reajuste")
    .eq("company_id", companyId)
    .eq("year", year);
  if (savedError) {
    if (isSchemaMissing(savedError.message)) return { needsMigration: true };
    return { error: savedError.message };
  }
  const savedByCode = new Map((saved ?? []).map((r) => [r.category_code as string, r]));

  const items: ValorFixoItem[] = codes.map((code) => {
    const row = savedByCode.get(code);
    return {
      categoryCode: code,
      categoryName: cats.codes.get(code) ?? code,
      valorBase: row?.valor_base == null ? null : Number(row.valor_base),
      indiceKey: isIndiceKey(row?.indice_key) ? (row!.indice_key as IndiceKey) : null,
      mesReajuste: row?.mes_reajuste == null ? null : Number(row.mes_reajuste),
    };
  });

  items.sort((a, b) => a.categoryName.localeCompare(b.categoryName, "pt-BR"));

  return { setup: { items, indices } };
}

// ─── Edição ───────────────────────────────────────────────────────────────────
// Um upsert genérico por campo, para a tela salvar cada célula de forma
// otimista sem apagar os outros campos da linha.

async function upsertCampo(
  companyId: string,
  year: number,
  categoryCode: string,
  categoryName: string,
  patch: Record<string, unknown>,
  updatedBy: string,
): Promise<{ ok?: true; error?: string; needsMigration?: boolean }> {
  const supabase = db() ?? (await createClient());
  const { error } = await supabase.from("orcamento_valor_fixo_categorias").upsert(
    {
      company_id: companyId,
      year,
      category_code: categoryCode,
      category_name: categoryName,
      ...patch,
      updated_by: updatedBy,
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

/** Valor base (custo atual). null limpa o valor. */
export async function setValorFixoBase(
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
    return { error: "Valor base inválido." };
  }
  return upsertCampo(companyId, year, categoryCode, categoryName, { valor_base: valor }, admin.userId);
}

/** Índice de correção (null remove). */
export async function setValorFixoIndice(
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
  return upsertCampo(companyId, year, categoryCode, categoryName, { indice_key: indiceKey }, admin.userId);
}

/** Mês do reajuste (1..12; null = sem reajuste no ano). */
export async function setValorFixoMesReajuste(
  companyId: string,
  year: number,
  categoryCode: string,
  categoryName: string,
  mes: number | null,
): Promise<{ ok?: true; error?: string; needsMigration?: boolean }> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!companyId || !categoryCode) return { error: "Categoria inválida." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };
  if (mes != null && (!Number.isInteger(mes) || mes < 1 || mes > 12)) {
    return { error: "Mês de reajuste inválido." };
  }
  return upsertCampo(companyId, year, categoryCode, categoryName, { mes_reajuste: mes }, admin.userId);
}
