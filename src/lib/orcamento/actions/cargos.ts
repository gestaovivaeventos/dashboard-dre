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

/** Lista os cargos de uma empresa no ano (ativos e inativos) com níveis aninhados.
 * `setorId` filtra os cargos daquele setor (empresa que orça por setor); null =
 * cargos sem setor (plano único). */
export async function getCargos(
  companyId: string,
  year: number,
  setorId: string | null = null,
): Promise<{
  items?: CargoWithNiveis[];
  error?: string;
  needsMigration?: boolean;
}> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!companyId) return { items: [] };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const supabase = db() ?? (await createClient());

  let cargosQuery = supabase
    .from("orcamento_cargos")
    .select("id, name, active")
    .eq("company_id", companyId)
    .eq("year", year);
  cargosQuery = setorId ? cargosQuery.eq("setor_id", setorId) : cargosQuery.is("setor_id", null);

  const { data: cargos, error: cargosError } = await cargosQuery
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

export async function createCargo(
  companyId: string,
  year: number,
  name: string,
  setorId: string | null = null,
) {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!companyId) return { error: "Selecione uma empresa." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };
  const clean = name.trim();
  if (!clean) return { error: "Informe o nome do cargo." };

  const supabase = db() ?? (await createClient());
  const { error } = await supabase
    .from("orcamento_cargos")
    .insert({ company_id: companyId, year, name: clean, setor_id: setorId, updated_by: admin.userId });
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
 * empresa de um ano para outro. O SETOR é remapeado por NOME (o setor de origem
 * "Comercial" vira o "Comercial" do ano de destino) — como os setores também são
 * versionados por ano, o id muda. Cargo cujo setor de origem não exista no ano de
 * destino é ignorado. Não duplica cargos já existentes (mesmo setor + nome) no
 * destino. Retorna quantos cargos foram copiados. */
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
    .select("id, name, setor_id")
    .eq("company_id", companyId)
    .eq("year", fromYear)
    .eq("active", true);
  if (srcError) {
    if (isSchemaMissing(srcError.message)) return { needsMigration: true };
    return { error: srcError.message };
  }
  if (!source || source.length === 0) return { ok: true as const, copied: 0 };

  // Remapeamento de setor por nome entre os anos (id muda a cada ano).
  const { data: setores, error: setErr } = await supabase
    .from("orcamento_setores")
    .select("id, name, year")
    .eq("company_id", companyId)
    .in("year", [fromYear, toYear]);
  if (setErr) return { error: setErr.message };
  const fromSetorNameById = new Map<string, string>();
  const toSetorIdByName = new Map<string, string>();
  for (const s of setores ?? []) {
    const key = (s.name as string).trim().toLowerCase();
    if ((s.year as number) === fromYear) fromSetorNameById.set(s.id as string, key);
    else toSetorIdByName.set(key, s.id as string);
  }
  // Setor de destino de um cargo de origem: null (sem setor) → null; senão mapeia
  // pelo nome. `undefined` = origem tinha setor que não existe no destino → pular.
  function destSetorFor(srcSetorId: string | null): string | null | undefined {
    if (!srcSetorId) return null;
    const name = fromSetorNameById.get(srcSetorId);
    if (!name) return undefined;
    return toSetorIdByName.get(name) ?? undefined;
  }

  // Chave de unicidade considerando setor: "setorId|nome".
  const keyOf = (setorId: string | null, name: string) =>
    `${setorId ?? "-"}::${name.trim().toLowerCase()}`;

  const { data: existing, error: existError } = await supabase
    .from("orcamento_cargos")
    .select("name, setor_id")
    .eq("company_id", companyId)
    .eq("year", toYear);
  if (existError) return { error: existError.message };
  const taken = new Set(
    (existing ?? []).map((r) => keyOf((r.setor_id as string) ?? null, r.name as string)),
  );

  // Cargos a copiar, já com o setor de destino resolvido.
  const toCopy: { srcId: string; name: string; destSetor: string | null }[] = [];
  for (const c of source) {
    const dest = destSetorFor((c.setor_id as string) ?? null);
    if (dest === undefined) continue; // setor de origem inexistente no destino
    const name = c.name as string;
    if (taken.has(keyOf(dest, name))) continue;
    toCopy.push({ srcId: c.id as string, name, destSetor: dest });
  }
  if (toCopy.length === 0) return { ok: true as const, copied: 0 };

  // Níveis dos cargos de origem, para replicar sob os novos cargos.
  const sourceIds = toCopy.map((c) => c.srcId);
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

  // Insere os cargos novos e recupera seus ids (com setor) para pendurar níveis.
  const { data: inserted, error: insError } = await supabase
    .from("orcamento_cargos")
    .insert(
      toCopy.map((c) => ({
        company_id: companyId,
        year: toYear,
        name: c.name,
        setor_id: c.destSetor,
        updated_by: admin.userId,
      })),
    )
    .select("id, name, setor_id");
  if (insError) return { error: friendlyCargoError(insError.message, "cargo") };

  // Mapeia (setor, nome)→novo id para ligar os níveis corretamente.
  const newIdByKey = new Map(
    (inserted ?? []).map((c) => [
      keyOf((c.setor_id as string) ?? null, c.name as string),
      c.id as string,
    ]),
  );
  const nivelRows: { cargo_id: string; name: string; salario: number; updated_by: string }[] = [];
  toCopy.forEach((c) => {
    const newId = newIdByKey.get(keyOf(c.destSetor, c.name));
    if (!newId) return;
    for (const n of niveisBySource.get(c.srcId) ?? []) {
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
