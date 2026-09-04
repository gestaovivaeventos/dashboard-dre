"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { getOrcamentoAdmin } from "@/lib/orcamento/auth";
import { friendlySetorError, isSchemaMissing } from "@/lib/orcamento/errors";
import { isValidBudgetYear } from "@/lib/orcamento/years";

export interface OrcamentoSetor {
  id: string;
  name: string;
  active: boolean;
  /** Setor correspondente no módulo Compras. É por ele que se sabe QUEM é o
   * dono do setor (user_sectors aponta para ctrl_sectors), então sem esse
   * vínculo o setor orça normalmente mas ninguém o "possui". */
  ctrlSectorId: string | null;
}

/** Setor do módulo Compras, para o seletor de vínculo. */
export interface CtrlSetorOption {
  id: string;
  name: string;
}

const PATH = "/orcamento/configuracoes/setores";

/** Lista os setores (ativos e inativos) de uma empresa no ano do orçamento. */
export async function getSetores(companyId: string, year: number): Promise<{
  items?: OrcamentoSetor[];
  ctrlSetores?: CtrlSetorOption[];
  orcarPorSetor?: boolean;
  error?: string;
  needsMigration?: boolean;
}> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!companyId) return { items: [] };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());
  const { data, error } = await supabase
    .from("orcamento_setores")
    .select("id, name, active, ctrl_sector_id")
    .eq("company_id", companyId)
    .eq("year", year)
    .order("active", { ascending: false })
    .order("name");
  if (error) {
    if (isSchemaMissing(error.message)) return { needsMigration: true };
    return { error: error.message };
  }

  // Flag "orçar por setor" da empresa NESTE ano (para a anotação da tela).
  const { data: cfg } = await supabase
    .from("orcamento_company_config")
    .select("orcar_por_setor")
    .eq("company_id", companyId)
    .eq("year", year)
    .maybeSingle();

  // Setores do Compras, para o admin ligar cada setor do orçamento ao seu par.
  const { data: ctrlRows } = await supabase
    .from("ctrl_sectors")
    .select("id, name")
    .eq("active", true)
    .order("name");

  return {
    items: (data ?? []).map((r) => ({
      id: r.id as string,
      name: r.name as string,
      active: Boolean(r.active),
      ctrlSectorId: (r.ctrl_sector_id as string | null) ?? null,
    })),
    ctrlSetores: (ctrlRows ?? []).map((r) => ({ id: r.id as string, name: r.name as string })),
    orcarPorSetor: Boolean(cfg?.orcar_por_setor),
  };
}

/**
 * Liga (ou desliga, com null) o setor do orçamento ao setor do módulo Compras.
 * É esse vínculo que a Fase 3 usará para saber quais setores um gerente
 * alcança — `user_sectors` aponta para `ctrl_sectors`, não para o cadastro do
 * orçamento.
 */
export async function setSetorCtrlVinculo(id: string, ctrlSectorId: string | null) {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!id) return { error: "Setor inválido." };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());
  const { error } = await supabase
    .from("orcamento_setores")
    .update({ ctrl_sector_id: ctrlSectorId, updated_by: admin.userId })
    .eq("id", id);
  if (error) {
    if (isSchemaMissing(error.message)) return { needsMigration: true };
    return { error: error.message };
  }
  revalidatePath(PATH);
  return { ok: true as const };
}

export async function createSetor(companyId: string, year: number, name: string) {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!companyId) return { error: "Selecione uma empresa." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };
  const clean = name.trim();
  if (!clean) return { error: "Informe o nome do setor." };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());
  const { error } = await supabase.from("orcamento_setores").insert({
    company_id: companyId,
    year,
    name: clean,
    updated_by: admin.userId,
  });
  if (error) return { error: friendlySetorError(error.message) };
  revalidatePath(PATH);
  return { ok: true as const };
}

export async function renameSetor(id: string, name: string) {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  const clean = name.trim();
  if (!clean) return { error: "Informe o nome do setor." };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());
  const { error } = await supabase
    .from("orcamento_setores")
    .update({ name: clean, updated_by: admin.userId })
    .eq("id", id);
  if (error) return { error: friendlySetorError(error.message) };
  revalidatePath(PATH);
  return { ok: true as const };
}

export async function setSetorActive(id: string, active: boolean) {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());
  const { error } = await supabase
    .from("orcamento_setores")
    .update({ active, updated_by: admin.userId })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(PATH);
  return { ok: true as const };
}

/**
 * Clona os setores de uma empresa de um ano para outro (só os ativos entram).
 * Não duplica setores cujo nome já exista no ano de destino. Retorna a
 * quantidade copiada.
 */
export async function cloneSetores(companyId: string, fromYear: number, toYear: number) {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!companyId) return { error: "Selecione uma empresa." };
  if (!isValidBudgetYear(fromYear) || !isValidBudgetYear(toYear)) {
    return { error: "Ano do orçamento inválido." };
  }
  if (fromYear === toYear) return { error: "Escolha anos de origem e destino diferentes." };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());

  const { data: source, error: srcError } = await supabase
    .from("orcamento_setores")
    .select("name")
    .eq("company_id", companyId)
    .eq("year", fromYear)
    .eq("active", true);
  if (srcError) {
    if (isSchemaMissing(srcError.message)) return { needsMigration: true };
    return { error: srcError.message };
  }
  if (!source || source.length === 0) return { ok: true as const, copied: 0 };

  const { data: existing, error: existError } = await supabase
    .from("orcamento_setores")
    .select("name")
    .eq("company_id", companyId)
    .eq("year", toYear);
  if (existError) return { error: existError.message };
  const taken = new Set((existing ?? []).map((r) => (r.name as string).trim().toLowerCase()));

  const rows = source
    .filter((r) => !taken.has((r.name as string).trim().toLowerCase()))
    .map((r) => ({
      company_id: companyId,
      year: toYear,
      name: r.name as string,
      updated_by: admin.userId,
    }));
  if (rows.length === 0) return { ok: true as const, copied: 0 };

  const { error: insError } = await supabase.from("orcamento_setores").insert(rows);
  if (insError) return { error: friendlySetorError(insError.message) };
  revalidatePath(PATH);
  return { ok: true as const, copied: rows.length };
}
