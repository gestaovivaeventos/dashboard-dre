"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { requireCtrlRole } from "@/lib/ctrl/auth";

// Gestão de cadastros do módulo Compras: Setores e Tipos de Despesa. Uma única
// tela (CadastroManager) opera as duas entidades via este discriminador.
export type CadastroEntity = "sector" | "expense_type";

export interface CadastroItem {
  id: string;
  name: string;
  active: boolean;
}

const CONFIG: Record<
  CadastroEntity,
  { table: string; mergeFn: string; path: string; label: string }
> = {
  sector: {
    table: "ctrl_sectors",
    mergeFn: "ctrl_merge_sectors",
    path: "/ctrl/admin/setores",
    label: "setor",
  },
  expense_type: {
    table: "ctrl_expense_types",
    mergeFn: "ctrl_merge_expense_types",
    path: "/ctrl/admin/tipos-de-despesa",
    label: "tipo de despesa",
  },
};

function friendlyError(message: string, label: string): string {
  if (/duplicate key|unique/i.test(message)) {
    return `Já existe um ${label} com esse nome.`;
  }
  return message;
}

function db() {
  return createAdminClientIfAvailable() ?? null;
}

/** Lista TODOS os registros (ativos e inativos) da entidade — admin/csc. */
export async function getCadastros(entity: CadastroEntity) {
  await requireCtrlRole("csc", "admin");
  const cfg = CONFIG[entity];
  const supabase = db() ?? (await createClient());
  const { data, error } = await supabase
    .from(cfg.table)
    .select("id, name, active")
    .order("active", { ascending: false })
    .order("name");
  if (error) return { error: error.message };
  return { items: (data ?? []) as CadastroItem[] };
}

export async function createCadastro(entity: CadastroEntity, name: string) {
  await requireCtrlRole("csc", "admin");
  const cfg = CONFIG[entity];
  const clean = name.trim();
  if (!clean) return { error: `Informe o nome do ${cfg.label}.` };
  const supabase = db() ?? (await createClient());
  const { error } = await supabase.from(cfg.table).insert({ name: clean });
  if (error) return { error: friendlyError(error.message, cfg.label) };
  revalidatePath(cfg.path);
  return { ok: true as const };
}

export async function renameCadastro(entity: CadastroEntity, id: string, name: string) {
  await requireCtrlRole("csc", "admin");
  const cfg = CONFIG[entity];
  const clean = name.trim();
  if (!clean) return { error: `Informe o nome do ${cfg.label}.` };
  const supabase = db() ?? (await createClient());
  const { error } = await supabase.from(cfg.table).update({ name: clean }).eq("id", id);
  if (error) return { error: friendlyError(error.message, cfg.label) };
  revalidatePath(cfg.path);
  return { ok: true as const };
}

export async function setCadastroActive(
  entity: CadastroEntity,
  id: string,
  active: boolean,
) {
  await requireCtrlRole("csc", "admin");
  const cfg = CONFIG[entity];
  const supabase = db() ?? (await createClient());
  const { error } = await supabase.from(cfg.table).update({ active }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(cfg.path);
  return { ok: true as const };
}

/**
 * Mescla `sourceId` em `targetId`: reponta todos os vínculos (requisições,
 * orçamento, fornecedores/usuários, mapeamentos Omie), resolve colisões e
 * inativa a origem. Transacional (função SQL SECURITY DEFINER).
 */
export async function mergeCadastro(
  entity: CadastroEntity,
  sourceId: string,
  targetId: string,
) {
  await requireCtrlRole("csc", "admin");
  const cfg = CONFIG[entity];
  if (!sourceId || !targetId) return { error: "Selecione origem e destino." };
  if (sourceId === targetId) return { error: "Origem e destino devem ser diferentes." };
  const admin = db();
  if (!admin) {
    return { error: "Operação indisponível: credencial de serviço ausente." };
  }
  const { error } = await admin.rpc(cfg.mergeFn, { p_source: sourceId, p_target: targetId });
  if (error) return { error: error.message };
  revalidatePath(cfg.path);
  return { ok: true as const };
}
