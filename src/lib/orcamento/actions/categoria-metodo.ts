"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { getOrcamentoAdmin } from "@/lib/orcamento/auth";
import { isSchemaMissing } from "@/lib/orcamento/errors";
import { isOrcamentoMetodo, type OrcamentoMetodo } from "@/lib/orcamento/metodos";
import { isValidBudgetYear } from "@/lib/orcamento/years";

export interface CategoriaMetodoItem {
  categoryCode: string;
  categoryName: string;
  dreLineCode: string;
  dreLineName: string;
  metodo: OrcamentoMetodo | null;
}

const PATH = "/orcamento/configuracoes/categoria-metodo";

interface MappingRow {
  omie_category_code: string;
  omie_category_name: string;
  dre_account_id: string | null;
  company_id: string | null;
}

/**
 * Lista as categorias de DESPESA de uma empresa (do mapeamento efetivo:
 * mapeamento global + override específico da empresa, filtrado às categorias
 * cuja linha DRE é de despesa) já com o método de orçamento salvo NO ANO, se
 * houver. A lista de categorias vem do mapeamento (estrutural, não versionada);
 * só o vínculo categoria→método é por ano.
 */
export async function getCategoriaMetodo(companyId: string, year: number): Promise<{
  items?: CategoriaMetodoItem[];
  error?: string;
  needsMigration?: boolean;
}> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!companyId) return { items: [] };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());

  // 1) Mapeamentos que valem para a empresa: específicos dela + globais (null).
  const { data: mappings, error: mapError } = await supabase
    .from("category_mapping")
    .select("omie_category_code, omie_category_name, dre_account_id, company_id")
    .or(`company_id.eq.${companyId},company_id.is.null`);
  if (mapError) return { error: mapError.message };

  // Resolução efetiva por código: o específico da empresa vence o global.
  const globalByCode = new Map<string, MappingRow>();
  const companyByCode = new Map<string, MappingRow>();
  for (const raw of (mappings ?? []) as MappingRow[]) {
    const target = raw.company_id === companyId ? companyByCode : globalByCode;
    if (!target.has(raw.omie_category_code)) target.set(raw.omie_category_code, raw);
  }
  const effective = new Map<string, MappingRow>();
  globalByCode.forEach((row, code) => effective.set(code, row));
  companyByCode.forEach((row, code) => effective.set(code, row));

  // 2) Tipo/rótulo da linha DRE de cada categoria (para filtrar despesas).
  const accountIds = Array.from(
    new Set(
      Array.from(effective.values())
        .map((r) => r.dre_account_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const accountById = new Map<string, { code: string; name: string; type: string }>();
  if (accountIds.length > 0) {
    const { data: accounts, error: accError } = await supabase
      .from("dre_accounts")
      .select("id, code, name, type")
      .in("id", accountIds);
    if (accError) return { error: accError.message };
    for (const a of accounts ?? []) {
      accountById.set(a.id as string, {
        code: a.code as string,
        name: a.name as string,
        type: a.type as string,
      });
    }
  }

  // 3) Métodos já salvos para a empresa NO ANO.
  const { data: saved, error: savedError } = await supabase
    .from("orcamento_categoria_metodo")
    .select("category_code, metodo")
    .eq("company_id", companyId)
    .eq("year", year);
  if (savedError) {
    if (isSchemaMissing(savedError.message)) return { needsMigration: true };
    return { error: savedError.message };
  }
  const metodoByCode = new Map<string, OrcamentoMetodo>();
  for (const s of saved ?? []) {
    if (isOrcamentoMetodo(s.metodo)) metodoByCode.set(s.category_code as string, s.metodo);
  }

  // 4) Só categorias cuja linha DRE é de despesa.
  const items: CategoriaMetodoItem[] = [];
  Array.from(effective.values()).forEach((row) => {
    if (!row.dre_account_id) return;
    const account = accountById.get(row.dre_account_id);
    if (!account || account.type !== "despesa") return;
    items.push({
      categoryCode: row.omie_category_code,
      categoryName: row.omie_category_name,
      dreLineCode: account.code,
      dreLineName: account.name,
      metodo: metodoByCode.get(row.omie_category_code) ?? null,
    });
  });

  items.sort(
    (a, b) =>
      a.dreLineCode.localeCompare(b.dreLineCode, undefined, { numeric: true }) ||
      a.categoryName.localeCompare(b.categoryName, "pt-BR"),
  );

  return { items };
}

/**
 * Define (ou remove) o método de orçamento de uma categoria numa empresa.
 * `metodo` null → remove o vínculo (categoria deixa de ser orçada por esses
 * produtores).
 */
export async function setCategoriaMetodo(
  companyId: string,
  year: number,
  categoryCode: string,
  categoryName: string,
  metodo: OrcamentoMetodo | null,
) {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!companyId || !categoryCode) return { error: "Categoria inválida." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());

  if (metodo === null) {
    const { error } = await supabase
      .from("orcamento_categoria_metodo")
      .delete()
      .eq("company_id", companyId)
      .eq("year", year)
      .eq("category_code", categoryCode);
    if (error) return { error: error.message };
    revalidatePath(PATH);
    return { ok: true as const };
  }

  if (!isOrcamentoMetodo(metodo)) return { error: "Método inválido." };

  const { error } = await supabase.from("orcamento_categoria_metodo").upsert(
    {
      company_id: companyId,
      year,
      category_code: categoryCode,
      category_name: categoryName,
      metodo,
      updated_by: admin.userId,
    },
    { onConflict: "company_id,year,category_code" },
  );
  if (error) {
    if (isSchemaMissing(error.message)) {
      return { error: "Migration do módulo Orçamento (categoria × método) ainda não aplicada." };
    }
    return { error: error.message };
  }
  revalidatePath(PATH);
  return { ok: true as const };
}

/**
 * Clona os vínculos categoria→método de uma empresa de um ano para outro. Não
 * sobrescreve categorias que já tenham método definido no ano de destino.
 * Retorna quantos vínculos foram copiados.
 */
export async function cloneCategoriaMetodo(
  companyId: string,
  fromYear: number,
  toYear: number,
) {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!companyId) return { error: "Selecione uma empresa." };
  if (!isValidBudgetYear(fromYear) || !isValidBudgetYear(toYear)) {
    return { error: "Ano do orçamento inválido." };
  }
  if (fromYear === toYear) return { error: "Escolha anos de origem e destino diferentes." };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());

  const { data: source, error: srcError } = await supabase
    .from("orcamento_categoria_metodo")
    .select("category_code, category_name, metodo")
    .eq("company_id", companyId)
    .eq("year", fromYear);
  if (srcError) {
    if (isSchemaMissing(srcError.message)) return { needsMigration: true };
    return { error: srcError.message };
  }
  if (!source || source.length === 0) return { ok: true as const, copied: 0 };

  const { data: existing, error: existError } = await supabase
    .from("orcamento_categoria_metodo")
    .select("category_code")
    .eq("company_id", companyId)
    .eq("year", toYear);
  if (existError) return { error: existError.message };
  const taken = new Set((existing ?? []).map((r) => r.category_code as string));

  const rows = source
    .filter((r) => !taken.has(r.category_code as string))
    .map((r) => ({
      company_id: companyId,
      year: toYear,
      category_code: r.category_code as string,
      category_name: (r.category_name as string) ?? null,
      metodo: r.metodo as string,
      updated_by: admin.userId,
    }));
  if (rows.length === 0) return { ok: true as const, copied: 0 };

  const { error: insError } = await supabase
    .from("orcamento_categoria_metodo")
    .insert(rows);
  if (insError) return { error: insError.message };
  revalidatePath(PATH);
  return { ok: true as const, copied: rows.length };
}
