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
  /** Valor EFETIVO em uso (já com o reajuste, se houver). */
  salario: number;
  /** Salário-base antes do reajuste. null = nenhum reajuste aplicado. */
  salarioOriginal: number | null;
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
  /** Reajuste em vigor na empresa/ano, em % (0 = nenhum). */
  reajustePercent?: number;
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
      .select("id, cargo_id, name, salario, salario_original")
      .in("cargo_id", cargoIds)
      .order("salario", { ascending: true })
      .order("name");
    if (niveisError) return { error: niveisError.message };
    niveisByCargoId = (niveis ?? []).reduce((map, n) => {
      const cargoId = n.cargo_id as string;
      const list = map.get(cargoId) ?? [];
      list.push({
        id: n.id as string,
        name: n.name as string,
        salario: Number(n.salario),
        salarioOriginal: n.salario_original == null ? null : Number(n.salario_original),
      });
      map.set(cargoId, list);
      return map;
    }, new Map<string, CargoNivel[]>());
  }

  const { data: cfg } = await supabase
    .from("orcamento_company_config")
    .select("reajuste_cargos_percent")
    .eq("company_id", companyId)
    .eq("year", year)
    .maybeSingle();
  const reajustePercent = cfg?.reajuste_cargos_percent == null
    ? 0
    : Number(cfg.reajuste_cargos_percent);

  const items: CargoWithNiveis[] = (cargos ?? []).map((c) => ({
    id: c.id as string,
    name: c.name as string,
    active: Boolean(c.active),
    niveis: niveisByCargoId.get(c.id as string) ?? [],
  }));

  return { items, reajustePercent };
}

// ─── Reajuste salarial ──────────────────────────────────────────────────────

/** Arredonda para centavos, para o reajuste não deixar dízima no salário. */
function centavos(valor: number): number {
  return Math.round(valor * 100) / 100;
}

/**
 * Aplica um reajuste percentual a TODOS os níveis do plano de cargos de uma
 * empresa no ano — todos os setores, cargos ativos e inativos.
 *
 * Sempre recalcula a partir de `salario_original`, nunca do salário já
 * reajustado: trocar 5% por 8% dá 8% sobre a base, não 8% sobre os 5%. Zerar
 * devolve o salário original e limpa o reajuste.
 */
export async function applyReajuste(companyId: string, year: number, percent: number) {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!companyId) return { error: "Selecione uma empresa." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };
  if (!Number.isFinite(percent)) return { error: "Informe um percentual válido." };
  if (percent < -100 || percent > 1000) {
    return { error: "Percentual fora da faixa (-100% a 1000%)." };
  }

  const supabase = db() ?? (await createClient());

  const { data: cargos, error: cargosError } = await supabase
    .from("orcamento_cargos")
    .select("id")
    .eq("company_id", companyId)
    .eq("year", year);
  if (cargosError) {
    if (isSchemaMissing(cargosError.message)) return { needsMigration: true };
    return { error: cargosError.message };
  }
  const cargoIds = (cargos ?? []).map((c) => c.id as string);

  let afetados = 0;
  if (cargoIds.length > 0) {
    const { data: niveis, error: niveisError } = await supabase
      .from("orcamento_cargo_niveis")
      .select("id, cargo_id, name, salario, salario_original")
      .in("cargo_id", cargoIds);
    if (niveisError) {
      if (isSchemaMissing(niveisError.message)) return { needsMigration: true };
      return { error: niveisError.message };
    }

    const zerar = percent === 0;
    const rows = (niveis ?? []).map((n) => {
      // A base é o original quando já há reajuste; senão o salário atual, que
      // vira o original a partir de agora.
      const base = n.salario_original == null ? Number(n.salario) : Number(n.salario_original);
      return {
        id: n.id as string,
        cargo_id: n.cargo_id as string,
        name: n.name as string,
        salario: zerar ? base : centavos(base * (1 + percent / 100)),
        salario_original: zerar ? null : base,
        updated_by: admin.userId,
      };
    });

    if (rows.length > 0) {
      // Upsert pela PK = update em lote, numa ida só ao banco.
      const { error: upError } = await supabase
        .from("orcamento_cargo_niveis")
        .upsert(rows, { onConflict: "id" });
      if (upError) return { error: upError.message };
      afetados = rows.length;
    }
  }

  const { error: cfgError } = await supabase.from("orcamento_company_config").upsert(
    {
      company_id: companyId,
      year,
      reajuste_cargos_percent: percent === 0 ? null : percent,
      updated_by: admin.userId,
    },
    { onConflict: "company_id,year" },
  );
  if (cfgError) return { error: cfgError.message };

  revalidatePath(PATH);
  return { ok: true as const, afetados };
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

/**
 * Reajuste em vigor na empresa/ano a que o cargo pertence (0 = nenhum).
 * Usado para manter a invariante `salario = salario_original × (1 + p/100)`
 * também quando um nível é digitado à mão com o reajuste ligado.
 */
async function reajusteDoCargo(
  supabase: Awaited<ReturnType<typeof createClient>>,
  cargoId: string,
): Promise<number> {
  const { data: cargo } = await supabase
    .from("orcamento_cargos")
    .select("company_id, year")
    .eq("id", cargoId)
    .maybeSingle();
  if (!cargo) return 0;

  const { data: cfg } = await supabase
    .from("orcamento_company_config")
    .select("reajuste_cargos_percent")
    .eq("company_id", cargo.company_id as string)
    .eq("year", cargo.year as number)
    .maybeSingle();
  const percent = cfg?.reajuste_cargos_percent;
  return percent == null ? 0 : Number(percent);
}

/**
 * Campos de salário de um nível digitado à mão. O valor digitado é sempre o
 * EFETIVO (o que aparece na tela); a base é obtida de volta pelo reajuste, de
 * modo que zerar o reajuste depois remova o percentual também deste nível.
 */
function camposSalario(salario: number, percent: number) {
  if (percent === 0) return { salario, salario_original: null };
  return { salario, salario_original: centavos(salario / (1 + percent / 100)) };
}

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
  const percent = await reajusteDoCargo(supabase, cargoId);
  const { error } = await supabase.from("orcamento_cargo_niveis").insert({
    cargo_id: cargoId,
    name: clean,
    ...camposSalario(salario as number, percent),
    updated_by: admin.userId,
  });
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
  const { data: atual } = await supabase
    .from("orcamento_cargo_niveis")
    .select("cargo_id")
    .eq("id", id)
    .maybeSingle();
  const percent = atual ? await reajusteDoCargo(supabase, atual.cargo_id as string) : 0;

  const { error } = await supabase
    .from("orcamento_cargo_niveis")
    .update({
      name: clean,
      ...camposSalario(salario as number, percent),
      updated_by: admin.userId,
    })
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
