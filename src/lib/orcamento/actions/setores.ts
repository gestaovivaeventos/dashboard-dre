"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { getOrcamentoAdmin } from "@/lib/orcamento/auth";
import { friendlySetorError, isSchemaMissing } from "@/lib/orcamento/errors";

export interface OrcamentoSetor {
  id: string;
  name: string;
  active: boolean;
}

const PATH = "/orcamento/configuracoes/setores";

/** Lista os setores (ativos e inativos) de uma empresa. */
export async function getSetores(companyId: string): Promise<{
  items?: OrcamentoSetor[];
  error?: string;
  needsMigration?: boolean;
}> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!companyId) return { items: [] };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());
  const { data, error } = await supabase
    .from("orcamento_setores")
    .select("id, name, active")
    .eq("company_id", companyId)
    .order("active", { ascending: false })
    .order("name");
  if (error) {
    if (isSchemaMissing(error.message)) return { needsMigration: true };
    return { error: error.message };
  }
  return { items: (data ?? []) as OrcamentoSetor[] };
}

export async function createSetor(companyId: string, name: string) {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!companyId) return { error: "Selecione uma empresa." };
  const clean = name.trim();
  if (!clean) return { error: "Informe o nome do setor." };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());
  const { error } = await supabase.from("orcamento_setores").insert({
    company_id: companyId,
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
