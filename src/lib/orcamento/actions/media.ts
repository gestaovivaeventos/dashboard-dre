"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { getOrcamentoAdmin } from "@/lib/orcamento/auth";
import { isSchemaMissing } from "@/lib/orcamento/errors";
import { isValidBudgetYear } from "@/lib/orcamento/years";
import { setorEspecifico } from "@/lib/orcamento/setor-filtro";
import { INDICES, type IndiceKey } from "@/lib/orcamento/indices";
import {
  fetchRealizados,
  REALIZADO_VAZIO,
  type MediaRealizado,
} from "@/lib/orcamento/media-realizado";

const PATH = "/orcamento/despesas/media";

// ─── Tipos ────────────────────────────────────────────────────────────────────

// MediaRealizado + o cálculo do realizado (meses fechados, média) vivem em
// `@/lib/orcamento/media-realizado` (fonte única, compartilhada com a Prévia).
export type { MediaRealizado };

export interface MediaCategoriaItem {
  categoryCode: string;
  categoryName: string;
  /** Setor DESTA linha. Uma categoria pode ter uma linha por setor, e é este
   * campo (não o filtro da tela) que diz para onde a edição vai. */
  setorId: string | null;
  setorNome: string | null;
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

/** Códigos + nomes das categorias marcadas com o método 'media' na empresa/ano. */
/**
 * Categorias por média, restritas ao SETOR quando ele é informado.
 *
 * A categoria só aparece no setor a que foi atribuída (tela Método por
 * categoria). Sem isso, toda categoria apareceria em todos os setores e o
 * mesmo gasto seria orçado várias vezes.
 */
async function fetchCategoriasMedia(
  supabase: Awaited<ReturnType<typeof createClient>>,
  companyId: string,
  year: number,
  setorId: string | null,
): Promise<{
  codes: Map<string, string>;
  /** Setores atribuídos a cada categoria (para montar uma linha por par). */
  setoresPorCodigo: Map<string, string[]>;
  needsMigration?: boolean;
  error?: string;
}> {
  const { data, error } = await supabase
    .from("orcamento_categoria_metodo")
    .select("category_code, category_name")
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("metodo", "media");
  if (error) {
    if (isSchemaMissing(error.message)) return { codes: new Map(), setoresPorCodigo: new Map(), needsMigration: true };
    return { codes: new Map(), setoresPorCodigo: new Map(), error: error.message };
  }

  // Atribuição categoria -> setores. Com um setor escolhido, filtra por ele;
  // em "Todos os setores", traz tudo para montar uma linha por par.
  const especifico = setorEspecifico(setorId);
  let atribQuery = supabase
    .from("orcamento_categoria_setores")
    .select("category_code, setor_id")
    .eq("company_id", companyId)
    .eq("year", year);
  if (especifico) atribQuery = atribQuery.eq("setor_id", especifico);
  const setoresPorCodigo = new Map<string, string[]>();
  let permitidas: Set<string> | null = null;
  if (setorId) {
    const { data: atrib, error: atribErr } = await atribQuery;
    if (atribErr) {
      if (isSchemaMissing(atribErr.message)) return { codes: new Map(), setoresPorCodigo: new Map(), needsMigration: true };
      return { codes: new Map(), setoresPorCodigo: new Map(), error: atribErr.message };
    }
    permitidas = new Set((atrib ?? []).map((r) => r.category_code as string));
    for (const r of atrib ?? []) {
      const code = r.category_code as string;
      const lista = setoresPorCodigo.get(code) ?? [];
      lista.push(r.setor_id as string);
      setoresPorCodigo.set(code, lista);
    }
  }

  const codes = new Map<string, string>();
  for (const r of data ?? []) {
    const code = r.category_code as string;
    if (permitidas && !permitidas.has(code)) continue;
    codes.set(code, (r.category_name as string) ?? code);
  }
  return { codes, setoresPorCodigo };
}

// ─── Leitura ────────────────────────────────────────────────────────────────

export async function getMediaCategorias(
  companyId: string,
  year: number,
  /** Setor da tela. As categorias e os valores são os DESTE setor. */
  setorId: string | null = null,
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
  const cats = await fetchCategoriasMedia(supabase, companyId, year, setorId);
  if (cats.needsMigration) return { needsMigration: true };
  if (cats.error) return { error: cats.error };
  const codes = Array.from(cats.codes.keys());
  if (codes.length === 0) {
    return { setup: { items: [], baseYear, indices } };
  }

  // Snapshots salvos. A chave é (categoria, setor): a mesma categoria pode ter
  // uma linha em cada setor, e ler só por código faria os dois setores
  // mostrarem o mesmo valor.
  const { data: saved, error: savedError } = await supabase
    .from("orcamento_media_categorias")
    .select("category_code, setor_id, media_valor, manual, indice_key, base_year, meses_considerados, calculado_em")
    .eq("company_id", companyId)
    .eq("year", year);
  if (savedError) {
    if (isSchemaMissing(savedError.message)) return { needsMigration: true };
    return { error: savedError.message };
  }
  const chave = (code: string, sid: string | null) => `${code}|${sid ?? "-"}`;
  const savedByKey = new Map(
    (saved ?? []).map((r) => [chave(r.category_code as string, (r.setor_id as string) ?? null), r]),
  );

  // Nomes dos setores, para rotular as linhas na visão "Todos os setores".
  const { data: setoresRows } = await supabase
    .from("orcamento_setores")
    .select("id, name")
    .eq("company_id", companyId)
    .eq("year", year);
  const nomeSetor = new Map(
    (setoresRows ?? []).map((r) => [r.id as string, r.name as string]),
  );

  // Realizado do ano-base ao vivo (sugestão + detalhe mensal).
  const realizados = await fetchRealizados(supabase, companyId, baseYear, codes);

  // Uma linha por (categoria × setor atribuído). Com um setor selecionado, é
  // uma linha por categoria; em "Todos os setores", a categoria orçada por dois
  // setores aparece duas vezes, cada uma com o seu valor.
  const pares: { code: string; setorId: string | null }[] = [];
  for (const code of codes) {
    const doCode = cats.setoresPorCodigo?.get(code);
    if (doCode && doCode.length > 0) {
      for (const sid of doCode) pares.push({ code, setorId: sid });
    } else {
      pares.push({ code, setorId: setorEspecifico(setorId) });
    }
  }

  const items: MediaCategoriaItem[] = pares.map(({ code, setorId: sid }) => {
    const row = savedByKey.get(chave(code, sid));
    const indiceKey = isIndiceKey(row?.indice_key) ? (row!.indice_key as IndiceKey) : null;
    return {
      categoryCode: code,
      categoryName: cats.codes.get(code) ?? code,
      setorId: sid,
      setorNome: sid ? nomeSetor.get(sid) ?? null : null,
      mediaValor: row?.media_valor == null ? null : Number(row.media_valor),
      manual: Boolean(row?.manual),
      indiceKey,
      baseYear: row?.base_year == null ? null : Number(row.base_year),
      mesesConsiderados: row?.meses_considerados == null ? null : Number(row.meses_considerados),
      calculadoEm: (row?.calculado_em as string) ?? null,
      realizado: realizados.get(code) ?? REALIZADO_VAZIO,
    };
  });

  items.sort(
    (a, b) =>
      a.categoryName.localeCompare(b.categoryName, "pt-BR") ||
      (a.setorNome ?? "").localeCompare(b.setorNome ?? "", "pt-BR"),
  );

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
  /** Setor da tela — a linha do orçamento pertence a ele. */
  setorId: string | null = null,
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
      setor_id: setorId,
      media_valor: realizado.media,
      manual: false,
      base_year: baseYear,
      meses_considerados: realizado.mesesConsiderados,
      calculado_em: calculadoEm,
      updated_by: admin.userId,
    },
    { onConflict: "company_id,year,category_code,setor_id" },
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
      setorId,
      setorNome: null,
      mediaValor: realizado.media,
      manual: false,
      indiceKey: null, // preservado no banco; a tela recarrega o índice do estado local
      baseYear,
      mesesConsiderados: realizado.mesesConsiderados,
      calculadoEm,
      realizado,
    },
  };
}

/** Recalcula a média de TODAS as categorias 'media' da empresa/ano. */
export async function recalcularTodasMedias(
  companyId: string,
  year: number,
  setorId: string | null = null,
): Promise<{ ok?: true; atualizadas?: number; error?: string; needsMigration?: boolean }> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!companyId) return { error: "Selecione uma empresa." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const supabase = db() ?? (await createClient());
  const cats = await fetchCategoriasMedia(supabase, companyId, year, setorId);
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
      setor_id: setorId,
      media_valor: realizado.media,
      manual: false,
      base_year: baseYear,
      meses_considerados: realizado.mesesConsiderados,
      calculado_em: calculadoEm,
      updated_by: admin.userId,
    };
  });

  const { error } = await supabase
    .from("orcamento_media_categorias")
    .upsert(rows, { onConflict: "company_id,year,category_code,setor_id" });
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
  /** Setor da tela — a linha do orçamento pertence a ele. */
  setorId: string | null = null,
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
      setor_id: setorId,
      media_valor: valor,
      manual: valor != null,
      updated_by: admin.userId,
    },
    { onConflict: "company_id,year,category_code,setor_id" },
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
  /** Setor da tela — a linha do orçamento pertence a ele. */
  setorId: string | null = null,
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
      setor_id: setorId,
      indice_key: indiceKey,
      updated_by: admin.userId,
    },
    { onConflict: "company_id,year,category_code,setor_id" },
  );
  if (error) {
    if (isSchemaMissing(error.message)) return { needsMigration: true };
    return { error: error.message };
  }
  revalidatePath(PATH);
  return { ok: true };
}
