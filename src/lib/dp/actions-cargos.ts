"use server";

import { revalidatePath } from "next/cache";

import { DP_CARGOS_PATH } from "@/lib/auth/dp";
import { requireDpUser } from "@/lib/dp/auth";
import { chaveNome } from "@/lib/dp/cargos";
import { createAdminClient } from "@/lib/supabase/admin";

// Escrita da estrutura de cargos e salários e do de-para Sólides → nível.
// Toda action passa por requireDpUser() e grava com o admin client — as
// tabelas dp_* não têm policy de escrita.

export type DpCargoResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

type Admin = ReturnType<typeof createAdminClient>;

function falha(error: unknown): { ok: false; error: string } {
  const e = error as { code?: string; message?: string } | null;
  if (e?.code === "23505") return { ok: false, error: "Já existe um cadastro com esse nome aqui." };
  if (e?.code === "PGRST205" || e?.code === "42P01") {
    return { ok: false, error: "Cargos e salários ainda não instalados no banco (migration 20261002120000)." };
  }
  return { ok: false, error: e?.message || "Erro inesperado." };
}

function nomeValido(nome: string, oQue: string): string {
  const n = nome.replace(/\s+/g, " ").trim();
  if (!n) throw new Error(`Informe o nome do ${oQue}.`);
  if (n.length > 120) throw new Error(`O nome do ${oQue} passa de 120 caracteres.`);
  return n;
}

function salarioValido(v: number): number {
  if (!Number.isFinite(v) || v < 0) throw new Error("Salário inválido.");
  if (v > 10_000_000) throw new Error("Salário fora do esperado — confira o valor.");
  return Math.round(v * 100) / 100;
}

/** A qual empresa o nível pertence (via cargo) — a trava contra vincular nível de outra empresa. */
async function empresaDoNivel(admin: Admin, nivelId: string): Promise<string | null> {
  const { data, error } = await admin.from("dp_cargo_niveis").select("dp_cargos(company_id)").eq("id", nivelId).maybeSingle();
  if (error) throw error;
  const cargo = (data as { dp_cargos?: { company_id?: string } | Array<{ company_id?: string }> } | null)?.dp_cargos;
  const c = Array.isArray(cargo) ? cargo[0] : cargo;
  return c?.company_id ?? null;
}

function revalidar() {
  revalidatePath(DP_CARGOS_PATH);
}

export async function salvarCargo(input: { companyId: string; id?: string; nome: string }): Promise<DpCargoResult<{ id: string }>> {
  try {
    const user = await requireDpUser();
    const admin = createAdminClient();
    const nome = nomeValido(input.nome, "cargo");
    const row = { nome, nome_chave: chaveNome(nome), updated_by: user.id, updated_at: new Date().toISOString() };
    if (input.id) {
      const { error } = await admin.from("dp_cargos").update(row).eq("id", input.id).eq("company_id", input.companyId);
      if (error) throw error;
      revalidar();
      return { ok: true, data: { id: input.id } };
    }
    const { data: company } = await admin.from("companies").select("id").eq("id", input.companyId).maybeSingle();
    if (!company) throw new Error("Empresa não encontrada.");
    const { data, error } = await admin
      .from("dp_cargos")
      .insert({ ...row, company_id: input.companyId })
      .select("id")
      .single();
    if (error) throw error;
    revalidar();
    return { ok: true, data: { id: data.id as string } };
  } catch (error) {
    return falha(error);
  }
}

/** Exclui o cargo com os níveis e os vínculos dele (cascata) — a tela confirma antes. */
export async function excluirCargo(input: { companyId: string; id: string }): Promise<DpCargoResult> {
  try {
    await requireDpUser();
    const { error } = await createAdminClient().from("dp_cargos").delete().eq("id", input.id).eq("company_id", input.companyId);
    if (error) throw error;
    revalidar();
    return { ok: true, data: undefined };
  } catch (error) {
    return falha(error);
  }
}

export async function salvarNivel(input: {
  companyId: string;
  cargoId: string;
  id?: string;
  nome: string;
  salario: number;
}): Promise<DpCargoResult<{ id: string }>> {
  try {
    const user = await requireDpUser();
    const admin = createAdminClient();
    const { data: cargo } = await admin
      .from("dp_cargos")
      .select("id")
      .eq("id", input.cargoId)
      .eq("company_id", input.companyId)
      .maybeSingle();
    if (!cargo) throw new Error("Cargo não encontrado nesta empresa.");
    const nome = nomeValido(input.nome, "nível");
    const row = {
      nome,
      nome_chave: chaveNome(nome),
      salario: salarioValido(input.salario),
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    };
    if (input.id) {
      const { error } = await admin.from("dp_cargo_niveis").update(row).eq("id", input.id).eq("cargo_id", input.cargoId);
      if (error) throw error;
      revalidar();
      return { ok: true, data: { id: input.id } };
    }
    // Novo nível entra por último na ordem do cargo.
    const { data: ult } = await admin
      .from("dp_cargo_niveis")
      .select("ordem")
      .eq("cargo_id", input.cargoId)
      .order("ordem", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { data, error } = await admin
      .from("dp_cargo_niveis")
      .insert({ ...row, cargo_id: input.cargoId, ordem: ((ult?.ordem as number | undefined) ?? -1) + 1 })
      .select("id")
      .single();
    if (error) throw error;
    revalidar();
    return { ok: true, data: { id: data.id as string } };
  } catch (error) {
    return falha(error);
  }
}

/** Exclui o nível; quem estava vinculado a ele volta para "cargo sem nível definido" (cascata). */
export async function excluirNivel(input: { companyId: string; cargoId: string; id: string }): Promise<DpCargoResult> {
  try {
    await requireDpUser();
    const admin = createAdminClient();
    if ((await empresaDoNivel(admin, input.id)) !== input.companyId) throw new Error("Nível não encontrado nesta empresa.");
    const { error } = await admin.from("dp_cargo_niveis").delete().eq("id", input.id).eq("cargo_id", input.cargoId);
    if (error) throw error;
    revalidar();
    return { ok: true, data: undefined };
  } catch (error) {
    return falha(error);
  }
}

/**
 * De-para de UM ou VÁRIOS cargos da Sólides → nível desta empresa. `nivelId`
 * null remove o vínculo. Vários de uma vez é o "Aplicar sugestões": a tela só
 * manda o que mostrou, e cada nível é conferido contra a empresa — vínculo para
 * nível de outra empresa enquadraria a pessoa na tabela errada.
 */
export async function vincularCargosSolides(input: {
  companyId: string;
  itens: Array<{ solidesCargoId: number; solidesCargoNome: string; nivelId: string | null }>;
}): Promise<DpCargoResult<{ gravados: number }>> {
  try {
    const user = await requireDpUser();
    const admin = createAdminClient();
    if (input.itens.length === 0) return { ok: true, data: { gravados: 0 } };
    if (input.itens.length > 500) throw new Error("Lote grande demais.");

    const nivelIds = Array.from(new Set(input.itens.map((i) => i.nivelId).filter((v): v is string => Boolean(v))));
    for (const id of nivelIds) {
      if ((await empresaDoNivel(admin, id)) !== input.companyId) throw new Error("Nível não pertence a esta empresa.");
    }

    const remover = input.itens.filter((i) => !i.nivelId).map((i) => i.solidesCargoId);
    if (remover.length > 0) {
      const { error } = await admin
        .from("dp_cargo_vinculos")
        .delete()
        .eq("company_id", input.companyId)
        .in("solides_cargo_id", remover);
      if (error) throw error;
    }
    const agora = new Date().toISOString();
    const gravar = input.itens
      .filter((i) => i.nivelId && Number.isInteger(i.solidesCargoId))
      .map((i) => ({
        company_id: input.companyId,
        solides_cargo_id: i.solidesCargoId,
        solides_cargo_nome: i.solidesCargoNome.trim() || `Cargo ${i.solidesCargoId}`,
        nivel_id: i.nivelId as string,
        updated_by: user.id,
        updated_at: agora,
      }));
    if (gravar.length > 0) {
      const { error } = await admin.from("dp_cargo_vinculos").upsert(gravar, { onConflict: "company_id,solides_cargo_id" });
      if (error) throw error;
    }
    revalidar();
    return { ok: true, data: { gravados: gravar.length + remover.length } };
  } catch (error) {
    return falha(error);
  }
}
