"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { getOrcamentoAdmin } from "@/lib/orcamento/auth";
import { isSchemaMissing } from "@/lib/orcamento/errors";
import { isValidBudgetYear } from "@/lib/orcamento/years";
import { isMovTipo, isVinculo, type MovTipo, type VinculoKey } from "@/lib/orcamento/vinculos";
import { BENEFICIOS, type Beneficios } from "@/lib/orcamento/beneficios";

const PATH = "/orcamento/despesas/pessoal";

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface Movimentacao {
  tipo: MovTipo;
  data: string | null; // ISO "YYYY-MM-01"
  cargo: string | null;
  salario: number | null;
}

export interface Colaborador {
  id: string;
  setorId: string | null;
  nome: string | null;
  vinculo: VinculoKey;
  cargoAtual: string | null;
  salarioAtual: number | null;
  mov1: Movimentacao | null;
  mov2: Movimentacao | null;
  justificativa: string | null;
  beneficios: Beneficios;
}

export interface ColaboradorInput {
  setorId: string | null;
  nome: string | null;
  vinculo: VinculoKey;
  cargoAtual: string | null;
  salarioAtual: number | null;
  mov1: Movimentacao | null;
  mov2: Movimentacao | null;
  justificativa: string | null;
}

/** Opção de cargo do Plano de Cargos (cargo + nível), com o salário-base.
 * `setorId` é o setor do cargo (null = plano sem setor) — usado para filtrar as
 * opções pelo setor selecionado na tela. */
export interface CargoOption {
  label: string;
  salario: number;
  setorId: string | null;
}

export interface SetorOption {
  id: string;
  name: string;
}

export interface PessoalSetup {
  orcarPorSetor: boolean;
  setores: SetorOption[];
  cargoOptions: CargoOption[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function db() {
  return createAdminClientIfAvailable();
}

function readMov(
  tipo: unknown,
  data: unknown,
  cargo: unknown,
  salario: unknown,
): Movimentacao | null {
  if (!isMovTipo(tipo)) return null;
  return {
    tipo,
    data: (data as string) ?? null,
    cargo: (cargo as string) ?? null,
    salario: salario == null ? null : Number(salario),
  };
}

/** Normaliza uma movimentação vinda do cliente antes de gravar. Desligamento
 * não carrega cargo/salário. */
function cleanMov(mov: Movimentacao | null): {
  tipo: MovTipo | null;
  data: string | null;
  cargo: string | null;
  salario: number | null;
} {
  if (!mov || !isMovTipo(mov.tipo)) {
    return { tipo: null, data: null, cargo: null, salario: null };
  }
  if (mov.tipo === "desligamento") {
    return { tipo: "desligamento", data: mov.data ?? null, cargo: null, salario: null };
  }
  return {
    tipo: "movimentacao",
    data: mov.data ?? null,
    cargo: mov.cargo?.trim() || null,
    salario: mov.salario ?? null,
  };
}

function validateInput(input: ColaboradorInput): string | null {
  if (!isVinculo(input.vinculo)) return "Selecione um vínculo válido.";
  const salaries = [
    input.salarioAtual,
    input.mov1?.salario ?? null,
    input.mov2?.salario ?? null,
  ];
  for (const s of salaries) {
    if (s != null && (!Number.isFinite(s) || s < 0)) return "Salário inválido.";
  }
  return null;
}

// ─── Setup (config + setores + opções de cargo) ─────────────────────────────────

export async function getPessoalSetup(companyId: string, year: number): Promise<{
  setup?: PessoalSetup;
  error?: string;
}> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!companyId) return { setup: { orcarPorSetor: false, setores: [], cargoOptions: [] } };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const supabase = db() ?? (await createClient());

  // Orça por setor? (config do ano)
  const { data: cfg } = await supabase
    .from("orcamento_company_config")
    .select("orcar_por_setor")
    .eq("company_id", companyId)
    .eq("year", year)
    .maybeSingle();
  const orcarPorSetor = Boolean(cfg?.orcar_por_setor);

  // Setores ativos do ano.
  const { data: setoresData, error: setErr } = await supabase
    .from("orcamento_setores")
    .select("id, name")
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("active", true)
    .order("name");
  if (setErr) return { error: setErr.message };
  const setores: SetorOption[] = (setoresData ?? []).map((s) => ({
    id: s.id as string,
    name: s.name as string,
  }));

  // Opções de cargo (cargo ativo × nível) → salário-base, com o setor do cargo.
  const { data: cargos, error: cargosErr } = await supabase
    .from("orcamento_cargos")
    .select("id, name, setor_id")
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("active", true)
    .order("name");
  if (cargosErr) return { error: cargosErr.message };

  const cargoOptions: CargoOption[] = [];
  const cargoIds = (cargos ?? []).map((c) => c.id as string);
  if (cargoIds.length > 0) {
    const { data: niveis, error: nivErr } = await supabase
      .from("orcamento_cargo_niveis")
      .select("cargo_id, name, salario")
      .in("cargo_id", cargoIds);
    if (nivErr) return { error: nivErr.message };
    const cargoById = new Map(
      (cargos ?? []).map((c) => [
        c.id as string,
        { name: c.name as string, setorId: (c.setor_id as string) ?? null },
      ]),
    );
    for (const n of niveis ?? []) {
      const cargo = cargoById.get(n.cargo_id as string);
      if (!cargo) continue;
      cargoOptions.push({
        label: `${cargo.name} — ${n.name as string}`,
        salario: Number(n.salario),
        setorId: cargo.setorId,
      });
    }
    cargoOptions.sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }

  return { setup: { orcarPorSetor, setores, cargoOptions } };
}

// ─── Quadro de colaboradores ────────────────────────────────────────────────────

// Precisa ser um literal (o supabase-js infere o tipo da linha a partir dele).
// A cauda são as colunas de benefício: ao acrescentar um item em BENEFICIOS,
// acrescente a coluna aqui também, senão o valor é gravado mas nunca lido.
const COLAB_COLS =
  "id, setor_id, nome, vinculo, cargo_atual, salario_atual, mov1_tipo, mov1_data, mov1_cargo, mov1_salario, mov2_tipo, mov2_data, mov2_cargo, mov2_salario, justificativa, vale_transporte, beneficio_gasolina, beneficio_alimentacao, refeicoes_empresa, assistencia_medica, auxilio_home_office, seguro_vida";

/** Lê os valores de benefício de uma linha crua. */
function readBeneficios(r: Record<string, unknown>): Beneficios {
  const b = {} as Beneficios;
  for (const meta of BENEFICIOS) {
    const v = r[meta.key];
    b[meta.key] = v == null ? null : Number(v);
  }
  return b;
}

/** Lista os colaboradores de uma empresa/ano/setor. `setorId` null = quadro único
 * (empresa que não orça por setor). */
export async function getColaboradores(
  companyId: string,
  year: number,
  setorId: string | null,
): Promise<{ items?: Colaborador[]; error?: string; needsMigration?: boolean }> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!companyId) return { items: [] };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const supabase = db() ?? (await createClient());
  let query = supabase
    .from("orcamento_pessoal_colaboradores")
    .select(COLAB_COLS)
    .eq("company_id", companyId)
    .eq("year", year);
  query = setorId ? query.eq("setor_id", setorId) : query.is("setor_id", null);

  const { data, error } = await query
    .order("nome", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });
  if (error) {
    if (isSchemaMissing(error.message)) return { needsMigration: true };
    return { error: error.message };
  }

  const items: Colaborador[] = (data ?? []).map((r) => ({
    id: r.id as string,
    setorId: (r.setor_id as string) ?? null,
    nome: (r.nome as string) ?? null,
    vinculo: r.vinculo as VinculoKey,
    cargoAtual: (r.cargo_atual as string) ?? null,
    salarioAtual: r.salario_atual == null ? null : Number(r.salario_atual),
    mov1: readMov(r.mov1_tipo, r.mov1_data, r.mov1_cargo, r.mov1_salario),
    mov2: readMov(r.mov2_tipo, r.mov2_data, r.mov2_cargo, r.mov2_salario),
    justificativa: (r.justificativa as string) ?? null,
    beneficios: readBeneficios(r as Record<string, unknown>),
  }));
  return { items };
}

function toRow(input: ColaboradorInput, adminId: string) {
  const m1 = cleanMov(input.mov1);
  const m2 = cleanMov(input.mov2);
  return {
    setor_id: input.setorId ?? null,
    nome: input.nome?.trim() || null,
    vinculo: input.vinculo,
    cargo_atual: input.cargoAtual?.trim() || null,
    salario_atual: input.salarioAtual,
    mov1_tipo: m1.tipo,
    mov1_data: m1.data,
    mov1_cargo: m1.cargo,
    mov1_salario: m1.salario,
    mov2_tipo: m2.tipo,
    mov2_data: m2.data,
    mov2_cargo: m2.cargo,
    mov2_salario: m2.salario,
    justificativa: input.justificativa?.trim() || null,
    updated_by: adminId,
  };
}

export async function createColaborador(
  companyId: string,
  year: number,
  input: ColaboradorInput,
) {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!companyId) return { error: "Selecione uma empresa." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };
  const err = validateInput(input);
  if (err) return { error: err };

  const supabase = db() ?? (await createClient());
  const { error } = await supabase.from("orcamento_pessoal_colaboradores").insert({
    company_id: companyId,
    year,
    ...toRow(input, admin.userId),
  });
  if (error) {
    if (isSchemaMissing(error.message)) return { needsMigration: true };
    return { error: error.message };
  }
  revalidatePath(PATH);
  return { ok: true as const };
}

export async function updateColaborador(id: string, input: ColaboradorInput) {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!id) return { error: "Colaborador inválido." };
  const err = validateInput(input);
  if (err) return { error: err };

  const supabase = db() ?? (await createClient());
  const { error } = await supabase
    .from("orcamento_pessoal_colaboradores")
    .update(toRow(input, admin.userId))
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(PATH);
  return { ok: true as const };
}

/** Atualiza só os benefícios (parte verde) de um colaborador. Não toca nos
 * campos do quadro (parte azul). */
export async function updateColaboradorBeneficios(id: string, beneficios: Beneficios) {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!id) return { error: "Colaborador inválido." };

  const row: Record<string, number | null> = {};
  for (const meta of BENEFICIOS) {
    const v = beneficios[meta.key];
    if (v != null && (!Number.isFinite(v) || v < 0)) return { error: "Valor de benefício inválido." };
    row[meta.key] = v ?? null;
  }

  const supabase = db() ?? (await createClient());
  const { error } = await supabase
    .from("orcamento_pessoal_colaboradores")
    .update({ ...row, updated_by: admin.userId })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(PATH);
  return { ok: true as const };
}

export async function deleteColaborador(id: string) {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };

  const supabase = db() ?? (await createClient());
  const { error } = await supabase
    .from("orcamento_pessoal_colaboradores")
    .delete()
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(PATH);
  return { ok: true as const };
}
