"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import {
  getOrcamentoAdmin,
  getOrcamentoUser,
  podeVerEmpresa,
  SEM_ACESSO,
  SEM_ACESSO_ADMIN,
} from "@/lib/orcamento/auth";
import { friendlyGrupoError, isSchemaMissing } from "@/lib/orcamento/errors";
import { normalizarNomeGrupo } from "@/lib/orcamento/grupos";

/**
 * Cadastro dos GRUPOS DE DESPESA (o subnível entre a categoria da DRE e a
 * despesa). Por empresa e SEM ano: a lista atravessa os exercícios, diferente
 * do cadastro de setores, que é por empresa × ano.
 *
 * Escrita é de ADMIN. Leitura é de qualquer usuário do módulo, porque o gestor
 * precisa escolher o grupo ao registrar uma despesa na entrevista — se a
 * leitura fosse admin-only, ele abriria o seletor vazio e toda despesa nasceria
 * sem grupo.
 */

const PATH = "/orcamento";

export interface GrupoDespesa {
  id: string;
  name: string;
  active: boolean;
  /** Quantas despesas do orçamento apontam para este grupo (em qualquer ano).
   * É o que diz se dá para excluir ou se o caminho é inativar. */
  emUso: number;
}

/**
 * Lista os grupos da empresa (ativos e inativos), já em ordem alfabética
 * pt-BR — a mesma ordem da Prévia e da tela de montagem.
 */
export async function getGruposDespesa(companyId: string): Promise<{
  items?: GrupoDespesa[];
  error?: string;
  needsMigration?: boolean;
}> {
  const user = await getOrcamentoUser();
  if (!user) return { error: SEM_ACESSO };
  if (!companyId) return { items: [] };
  if (!podeVerEmpresa(user, companyId)) return { error: SEM_ACESSO };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());
  const { data, error } = await supabase
    .from("orcamento_grupos_despesa")
    .select("id, name, active")
    .eq("company_id", companyId);
  if (error) {
    if (isSchemaMissing(error.message)) return { needsMigration: true };
    return { error: error.message };
  }

  // Uso por grupo, numa consulta só. Serve ao cadastro (habilitar excluir) e
  // evita N+1 numa lista que costuma ter dezenas de linhas.
  const { data: usos } = await supabase
    .from("orcamento_planejamento_despesas")
    .select("grupo_id")
    .eq("company_id", companyId)
    .not("grupo_id", "is", null);
  const contagem = new Map<string, number>();
  (usos ?? []).forEach((r) => {
    const id = r.grupo_id as string | null;
    if (id) contagem.set(id, (contagem.get(id) ?? 0) + 1);
  });

  const items = (data ?? [])
    .map((r) => ({
      id: r.id as string,
      name: r.name as string,
      active: Boolean(r.active),
      emUso: contagem.get(r.id as string) ?? 0,
    }))
    // Ativos primeiro (é onde o admin trabalha), cada bloco em ordem alfabética.
    .sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      return a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" });
    });

  return { items };
}

export async function createGrupoDespesa(companyId: string, name: string) {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: SEM_ACESSO_ADMIN };
  if (!companyId) return { error: "Selecione uma empresa." };
  const clean = normalizarNomeGrupo(name);
  if (!clean) return { error: "Informe o nome do grupo." };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());
  const { error } = await supabase.from("orcamento_grupos_despesa").insert({
    company_id: companyId,
    name: clean,
    updated_by: admin.userId,
  });
  if (error) {
    if (isSchemaMissing(error.message)) return { needsMigration: true };
    return { error: friendlyGrupoError(error.message) };
  }
  revalidatePath(PATH);
  return { ok: true as const };
}

export async function renameGrupoDespesa(id: string, name: string) {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: SEM_ACESSO_ADMIN };
  if (!id) return { error: "Grupo inválido." };
  const clean = normalizarNomeGrupo(name);
  if (!clean) return { error: "Informe o nome do grupo." };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());
  const { error } = await supabase
    .from("orcamento_grupos_despesa")
    .update({ name: clean, updated_by: admin.userId })
    .eq("id", id);
  if (error) return { error: friendlyGrupoError(error.message) };
  revalidatePath(PATH);
  return { ok: true as const };
}

/**
 * Inativa (ou reativa) um grupo. Inativo some do seletor de despesa nova, mas
 * continua nomeando as despesas que já o usam — apagar o nome de um grupo em
 * uso deixaria a Prévia de um ano fechado com subnível anônimo.
 */
export async function setGrupoDespesaActive(id: string, active: boolean) {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: SEM_ACESSO_ADMIN };
  if (!id) return { error: "Grupo inválido." };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());
  const { error } = await supabase
    .from("orcamento_grupos_despesa")
    .update({ active, updated_by: admin.userId })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(PATH);
  return { ok: true as const };
}

/**
 * Exclui um grupo que nunca foi usado. A FK das despesas é RESTRICT, então o
 * banco recusa a exclusão de um grupo em uso mesmo que a tela deixe passar —
 * a mensagem amigável traduz esse 23503 para "inative em vez de excluir".
 */
export async function deleteGrupoDespesa(id: string) {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: SEM_ACESSO_ADMIN };
  if (!id) return { error: "Grupo inválido." };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());
  const { error } = await supabase.from("orcamento_grupos_despesa").delete().eq("id", id);
  if (error) return { error: friendlyGrupoError(error.message) };
  revalidatePath(PATH);
  return { ok: true as const };
}
