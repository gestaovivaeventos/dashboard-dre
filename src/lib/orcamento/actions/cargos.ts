"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { getOrcamentoAdmin } from "@/lib/orcamento/auth";
import { isSchemaMissing } from "@/lib/orcamento/errors";
import { isValidBudgetYear } from "@/lib/orcamento/years";

export interface CargoNivel {
  id: string;
  name: string;
  salario: number;
}

export interface CargoWithNiveis {
  id: string;
  name: string;
  active: boolean;
  niveis: CargoNivel[];
}

const PATH = "/orcamento/configuracoes/plano-cargos";

function db() {
  return createAdminClientIfAvailable();
}

function friendlyCargoError(message: string, label: "cargo" | "nível"): string {
  if (/duplicate key|unique/i.test(message)) {
    return label === "cargo"
      ? "Já existe um cargo com esse nome nesta empresa."
      : "Já existe um nível com esse nome neste cargo.";
  }
  return message;
}

/** Lista os cargos de uma empresa no ano (ativos e inativos) com níveis aninhados. */
export async function getCargos(companyId: string, year: number): Promise<{
  items?: CargoWithNiveis[];
  error?: string;
  needsMigration?: boolean;
}> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!companyId) return { items: [] };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const supabase = db() ?? (await createClient());

  const { data: cargos, error: cargosError } = await supabase
    .from("orcamento_cargos")
    .select("id, name, active")
    .eq("company_id", companyId)
    .eq("year", year)
    .order("active", { ascending: false })
    .order("name");
  if (cargosError) {
    if (isSchemaMissing(cargosError.message)) return { needsMigration: true };
    return { error: cargosError.message };
  }

  const cargoIds = (cargos ?? []).map((c) => c.id as string);
  let niveisByCargoId = new Map<string, CargoNivel[]>();
  if (cargoIds.length > 0) {
    const { data: niveis, error: niveisError } = await supabase
      .from("orcamento_cargo_niveis")
      .select("id, cargo_id, name, salario")
      .in("cargo_id", cargoIds)
      .order("salario", { ascending: true })
      .order("name");
    if (niveisError) return { error: niveisError.message };
    niveisByCargoId = (niveis ?? []).reduce((map, n) => {
      const cargoId = n.cargo_id as string;
      const list = map.get(cargoId) ?? [];
      list.push({ id: n.id as string, name: n.name as string, salario: Number(n.salario) });
      map.set(cargoId, list);
      return map;
    }, new Map<string, CargoNivel[]>());
  }

  const items: CargoWithNiveis[] = (cargos ?? []).map((c) => ({
    id: c.id as string,
    name: c.name as string,
    active: Boolean(c.active),
    niveis: niveisByCargoId.get(c.id as string) ?? [],
  }));

  return { items };
}

// ─── Cargo ──────────────────────────────────────────────────────────────────

export async function createCargo(companyId: string, year: number, name: string) {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!companyId) return { error: "Selecione uma empresa." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };
  const clean = name.trim();
  if (!clean) return { error: "Informe o nome do cargo." };

  const supabase = db() ?? (await createClient());
  const { error } = await supabase
    .from("orcamento_cargos")
    .insert({ company_id: companyId, year, name: clean, updated_by: admin.userId });
  if (error) return { error: friendlyCargoError(error.message, "cargo") };
  revalidatePath(PATH);
  return { ok: true as const };
}

export async function renameCargo(id: string, name: string) {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  const clean = name.trim();
  if (!clean) return { error: "Informe o nome do cargo." };

  const supabase = db() ?? (await createClient());
  const { error } = await supabase
    .from("orcamento_cargos")
    .update({ name: clean, updated_by: admin.userId })
    .eq("id", id);
  if (error) return { error: friendlyCargoError(error.message, "cargo") };
  revalidatePath(PATH);
  return { ok: true as const };
}

export async function setCargoActive(id: string, active: boolean) {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };

  const supabase = db() ?? (await createClient());
  const { error } = await supabase
    .from("orcamento_cargos")
    .update({ active, updated_by: admin.userId })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(PATH);
  return { ok: true as const };
}

// ─── Nível ──────────────────────────────────────────────────────────────────

function validateSalario(salario: number | null): string | null {
  if (salario == null || !Number.isFinite(salario)) return "Informe um salário válido.";
  if (salario < 0) return "O salário não pode ser negativo.";
  return null;
}

export async function createNivel(cargoId: string, name: string, salario: number | null) {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!cargoId) return { error: "Cargo inválido." };
  const clean = name.trim();
  if (!clean) return { error: "Informe o nome do nível." };
  const salErr = validateSalario(salario);
  if (salErr) return { error: salErr };

  const supabase = db() ?? (await createClient());
  const { error } = await supabase
    .from("orcamento_cargo_niveis")
    .insert({ cargo_id: cargoId, name: clean, salario, updated_by: admin.userId });
  if (error) return { error: friendlyCargoError(error.message, "nível") };
  revalidatePath(PATH);
  return { ok: true as const };
}

export async function updateNivel(id: string, name: string, salario: number | null) {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  const clean = name.trim();
  if (!clean) return { error: "Informe o nome do nível." };
  const salErr = validateSalario(salario);
  if (salErr) return { error: salErr };

  const supabase = db() ?? (await createClient());
  const { error } = await supabase
    .from("orcamento_cargo_niveis")
    .update({ name: clean, salario, updated_by: admin.userId })
    .eq("id", id);
  if (error) return { error: friendlyCargoError(error.message, "nível") };
  revalidatePath(PATH);
  return { ok: true as const };
}

export async function deleteNivel(id: string) {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };

  const supabase = db() ?? (await createClient());
  const { error } = await supabase.from("orcamento_cargo_niveis").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(PATH);
  return { ok: true as const };
}

// ─── Clonar de outro ano ──────────────────────────────────────────────────────

/**
 * Clona o plano de cargos (cargos ativos + seus níveis, com os salários) de uma
 * empresa de um ano para outro. Não duplica cargos cujo nome já exista no ano de
 * destino. Retorna quantos cargos foram copiados.
 */
export async function cloneCargos(companyId: string, fromYear: number, toYear: number) {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!companyId) return { error: "Selecione uma empresa." };
  if (!isValidBudgetYear(fromYear) || !isValidBudgetYear(toYear)) {
    return { error: "Ano do orçamento inválido." };
  }
  if (fromYear === toYear) return { error: "Escolha anos de origem e destino diferentes." };

  const supabase = db() ?? (await createClient());

  const { data: source, error: srcError } = await supabase
    .from("orcamento_cargos")
    .select("id, name")
    .eq("company_id", companyId)
    .eq("year", fromYear)
    .eq("active", true);
  if (srcError) {
    if (isSchemaMissing(srcError.message)) return { needsMigration: true };
    return { error: srcError.message };
  }
  if (!source || source.length === 0) return { ok: true as const, copied: 0 };

  const { data: existing, error: existError } = await supabase
    .from("orcamento_cargos")
    .select("name")
    .eq("company_id", companyId)
    .eq("year", toYear);
  if (existError) return { error: existError.message };
  const taken = new Set((existing ?? []).map((r) => (r.name as string).trim().toLowerCase()));

  const toCopy = source.filter((c) => !taken.has((c.name as string).trim().toLowerCase()));
  if (toCopy.length === 0) return { ok: true as const, copied: 0 };

  // Níveis dos cargos de origem, para replicar sob os novos cargos.
  const sourceIds = toCopy.map((c) => c.id as string);
  const { data: niveis, error: nivError } = await supabase
    .from("orcamento_cargo_niveis")
    .select("cargo_id, name, salario")
    .in("cargo_id", sourceIds);
  if (nivError) return { error: nivError.message };
  const niveisBySource = (niveis ?? []).reduce((map, n) => {
    const cid = n.cargo_id as string;
    const list = map.get(cid) ?? [];
    list.push({ name: n.name as string, salario: Number(n.salario) });
    map.set(cid, list);
    return map;
  }, new Map<string, { name: string; salario: number }[]>());

  // Insere os cargos novos e recupera seus ids para pendurar os níveis.
  const { data: inserted, error: insError } = await supabase
    .from("orcamento_cargos")
    .insert(
      toCopy.map((c) => ({
        company_id: companyId,
        year: toYear,
        name: c.name as string,
        updated_by: admin.userId,
      })),
    )
    .select("id, name");
  if (insError) return { error: friendlyCargoError(insError.message, "cargo") };

  // Mapeia nome→novo id (nomes são únicos por empresa/ano) para ligar os níveis.
  const newIdByName = new Map(
    (inserted ?? []).map((c) => [(c.name as string).trim().toLowerCase(), c.id as string]),
  );
  const nivelRows: { cargo_id: string; name: string; salario: number; updated_by: string }[] = [];
  toCopy.forEach((c) => {
    const newId = newIdByName.get((c.name as string).trim().toLowerCase());
    if (!newId) return;
    for (const n of niveisBySource.get(c.id as string) ?? []) {
      nivelRows.push({ cargo_id: newId, name: n.name, salario: n.salario, updated_by: admin.userId });
    }
  });
  if (nivelRows.length > 0) {
    const { error: nivInsError } = await supabase
      .from("orcamento_cargo_niveis")
      .insert(nivelRows);
    if (nivInsError) return { error: nivInsError.message };
  }

  revalidatePath(PATH);
  return { ok: true as const, copied: toCopy.length };
}
