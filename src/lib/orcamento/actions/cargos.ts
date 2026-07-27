"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { getOrcamentoAdmin } from "@/lib/orcamento/auth";
import { isSchemaMissing } from "@/lib/orcamento/errors";

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

/** Lista os cargos de uma empresa (ativos e inativos) com seus níveis aninhados. */
export async function getCargos(companyId: string): Promise<{
  items?: CargoWithNiveis[];
  error?: string;
  needsMigration?: boolean;
}> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!companyId) return { items: [] };

  const supabase = db() ?? (await createClient());

  const { data: cargos, error: cargosError } = await supabase
    .from("orcamento_cargos")
    .select("id, name, active")
    .eq("company_id", companyId)
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

export async function createCargo(companyId: string, name: string) {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!companyId) return { error: "Selecione uma empresa." };
  const clean = name.trim();
  if (!clean) return { error: "Informe o nome do cargo." };

  const supabase = db() ?? (await createClient());
  const { error } = await supabase
    .from("orcamento_cargos")
    .insert({ company_id: companyId, name: clean, updated_by: admin.userId });
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
