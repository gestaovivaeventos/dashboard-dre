"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { getOrcamentoAdmin } from "@/lib/orcamento/auth";
import { isSchemaMissing } from "@/lib/orcamento/errors";
import { isValidBudgetYear } from "@/lib/orcamento/years";
import { INDICES, type IndiceKey, type IndiceUnit } from "@/lib/orcamento/indices";

const PATH = "/orcamento";

// ─── Tipos ────────────────────────────────────────────────────────────────────

/** Um contrato dentro de uma categoria orçada por valor fixo. */
export interface ValorFixoContrato {
  /** id da linha em orcamento_valor_fixo_categorias. */
  id: string;
  /** Rótulo do contrato (obrigatório na tela quando a categoria tem 2+). */
  descricao: string | null;
  /** Valor base informado (ex.: custo atual). null = ainda não preenchido. */
  valorBase: number | null;
  /** Índice de correção escolhido (null = sem correção). */
  indiceKey: IndiceKey | null;
  /** Mês (1..12) em que o reajuste passa a valer. null = sem reajuste no ano. */
  mesReajuste: number | null;
}

/** Uma categoria orçada por valor fixo, com seus N contratos. */
export interface ValorFixoItem {
  categoryCode: string;
  categoryName: string;
  contratos: ValorFixoContrato[];
}

/** Payload de um contrato ao salvar (id ausente = inserir). */
export interface ValorFixoContratoInput {
  id?: string | null;
  descricao: string | null;
  valorBase: number | null;
  indiceKey: IndiceKey | null;
  mesReajuste: number | null;
}

/** Índice de correção disponível, com o valor do ano do orçamento. */
export interface IndiceOption {
  key: IndiceKey;
  label: string;
  /** 'percent' (base × (1+%)) ou 'brl' (o valor corrigido É o próprio índice). */
  unit: IndiceUnit;
  /** Percentual, ou o próprio valor em R$ quando unit='brl' (salário mínimo). */
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

// Todos os índices servem de correção no valor fixo: os percentuais aplicam
// base × (1+%); o salário mínimo (unit 'brl') substitui pelo próprio valor em R$.
const INDICE_KEYS = new Set<string>(INDICES.map((i) => i.key));

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

interface ContratoRow {
  id: string;
  category_code: string;
  descricao: string | null;
  valor_base: number | string | null;
  indice_key: string | null;
  mes_reajuste: number | string | null;
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

  // Índices do ano do orçamento (para o seletor de correção). Inclui o salário
  // mínimo, cujo valor cadastrado é o próprio orçado quando escolhido.
  const { data: indiceRowRaw } = await supabase
    .from("orcamento_indices")
    .select("*")
    .eq("year", year)
    .maybeSingle();
  const indiceRow = (indiceRowRaw ?? null) as Record<string, number | null> | null;
  const indices: IndiceOption[] = INDICES.map((meta) => ({
    key: meta.key,
    label: meta.label,
    unit: meta.unit,
    value: indiceRow?.[meta.key] == null ? null : Number(indiceRow[meta.key]),
  }));

  // Categorias marcadas como 'valor_fixo'.
  const cats = await fetchCategoriasValorFixo(supabase, companyId, year);
  if (cats.needsMigration) return { needsMigration: true };
  if (cats.error) return { error: cats.error };
  const codes = Array.from(cats.codes.keys());
  if (codes.length === 0) return { setup: { items: [], indices } };

  // Contratos salvos (N por categoria). Ordena por created_at/id para a lista
  // ficar estável entre recargas.
  const { data: saved, error: savedError } = await supabase
    .from("orcamento_valor_fixo_categorias")
    .select("id, category_code, descricao, valor_base, indice_key, mes_reajuste")
    .eq("company_id", companyId)
    .eq("year", year)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (savedError) {
    if (isSchemaMissing(savedError.message)) return { needsMigration: true };
    return { error: savedError.message };
  }

  const contratosByCode = new Map<string, ValorFixoContrato[]>();
  for (const raw of (saved ?? []) as ContratoRow[]) {
    const code = raw.category_code;
    if (!contratosByCode.has(code)) contratosByCode.set(code, []);
    contratosByCode.get(code)!.push({
      id: raw.id,
      descricao: raw.descricao ?? null,
      valorBase: raw.valor_base == null ? null : Number(raw.valor_base),
      indiceKey: isIndiceKey(raw.indice_key) ? (raw.indice_key as IndiceKey) : null,
      mesReajuste: raw.mes_reajuste == null ? null : Number(raw.mes_reajuste),
    });
  }

  const items: ValorFixoItem[] = codes.map((code) => ({
    categoryCode: code,
    categoryName: cats.codes.get(code) ?? code,
    contratos: contratosByCode.get(code) ?? [],
  }));

  items.sort((a, b) => a.categoryName.localeCompare(b.categoryName, "pt-BR"));

  return { setup: { items, indices } };
}

// ─── Edição ───────────────────────────────────────────────────────────────────

function validarContrato(
  contrato: ValorFixoContratoInput,
  requireDescricao: boolean,
): string | null {
  const descricao = (contrato.descricao ?? "").trim();
  if (requireDescricao && descricao === "") {
    return "Descrição obrigatória quando há mais de um contrato na categoria.";
  }
  if (descricao.length > 200) return "Descrição muito longa (máx. 200 caracteres).";
  if (
    contrato.valorBase != null &&
    (!Number.isFinite(contrato.valorBase) || contrato.valorBase < 0)
  ) {
    return "Valor base inválido.";
  }
  if (contrato.indiceKey != null && !isIndiceKey(contrato.indiceKey)) {
    return "Índice inválido.";
  }
  if (
    contrato.mesReajuste != null &&
    (!Number.isInteger(contrato.mesReajuste) || contrato.mesReajuste < 1 || contrato.mesReajuste > 12)
  ) {
    return "Mês de reajuste inválido.";
  }
  return null;
}

/**
 * Salva um contrato (linha inteira). Sem `id` → insere e devolve o id novo;
 * com `id` → atualiza a linha. `requireDescricao` (a tela envia true quando a
 * categoria tem 2+ contratos) obriga a descrição — validado também aqui.
 */
export async function saveValorFixoContrato(
  companyId: string,
  year: number,
  categoryCode: string,
  categoryName: string,
  contrato: ValorFixoContratoInput,
  requireDescricao: boolean,
): Promise<{ id?: string; error?: string; needsMigration?: boolean }> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!companyId || !categoryCode) return { error: "Categoria inválida." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const validationError = validarContrato(contrato, requireDescricao);
  if (validationError) return { error: validationError };

  const supabase = db() ?? (await createClient());
  const descricao = (contrato.descricao ?? "").trim() || null;
  const patch = {
    descricao,
    valor_base: contrato.valorBase,
    indice_key: contrato.indiceKey,
    mes_reajuste: contrato.mesReajuste,
    updated_by: admin.userId,
  };

  // Atualização de contrato existente.
  if (contrato.id) {
    const { error } = await supabase
      .from("orcamento_valor_fixo_categorias")
      .update({ ...patch, category_name: categoryName })
      .eq("id", contrato.id)
      .eq("company_id", companyId);
    if (error) {
      if (isSchemaMissing(error.message)) return { needsMigration: true };
      return { error: error.message };
    }
    revalidatePath(PATH);
    return { id: contrato.id };
  }

  // Novo contrato.
  const { data, error } = await supabase
    .from("orcamento_valor_fixo_categorias")
    .insert({
      company_id: companyId,
      year,
      category_code: categoryCode,
      category_name: categoryName,
      ...patch,
    })
    .select("id")
    .single();
  if (error) {
    if (isSchemaMissing(error.message)) return { needsMigration: true };
    return { error: error.message };
  }
  revalidatePath(PATH);
  return { id: (data as { id: string }).id };
}

/** Remove um contrato pelo id. */
export async function removeValorFixoContrato(
  companyId: string,
  year: number,
  contratoId: string,
): Promise<{ ok?: true; error?: string; needsMigration?: boolean }> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!companyId || !contratoId) return { error: "Contrato inválido." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const supabase = db() ?? (await createClient());
  const { error } = await supabase
    .from("orcamento_valor_fixo_categorias")
    .delete()
    .eq("id", contratoId)
    .eq("company_id", companyId);
  if (error) {
    if (isSchemaMissing(error.message)) return { needsMigration: true };
    return { error: error.message };
  }
  revalidatePath(PATH);
  return { ok: true };
}
