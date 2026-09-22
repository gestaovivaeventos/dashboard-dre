"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { getOrcamentoUser, podeVerEmpresa, SEM_ACESSO } from "@/lib/orcamento/auth";
import { isSchemaMissing } from "@/lib/orcamento/errors";
import { isValidBudgetYear } from "@/lib/orcamento/years";
import type { TrilhaEntrada, TrilhaEntradaInput } from "@/lib/orcamento/trilha";

const db = () => createAdminClientIfAvailable();

/**
 * Grava uma entrada na trilha.
 *
 * **Best-effort de propósito**: nunca derruba a operação que a originou. Se a
 * migration da fase B ainda não rodou (42P01) ou o insert falha, a gravação do
 * orçamento continua valendo — perder o registro é ruim, perder o trabalho do
 * usuário é pior. O erro vai para o log do servidor, não para a tela.
 *
 * Chame DEPOIS de a escrita principal ter dado certo: a trilha registra fato
 * consumado, não intenção.
 */
export async function registrarAlteracao(entrada: TrilhaEntradaInput): Promise<void> {
  const supabase = db();
  // Sem service role não há como gravar (as policies de escrita são admin-only).
  if (!supabase) return;

  const { error } = await supabase.from("orcamento_alteracoes").insert({
    company_id: entrada.companyId,
    year: entrada.year,
    ciclo_id: entrada.cicloId ?? null,
    versao_id: entrada.versaoId ?? null,
    category_code: entrada.categoryCode ?? null,
    setor_id: entrada.setorId ?? null,
    metodo: entrada.metodo ?? null,
    alvo_tipo: entrada.alvoTipo,
    alvo_id: entrada.alvoId ?? null,
    alvo_rotulo: entrada.alvoRotulo ?? null,
    acao: entrada.acao,
    fase: entrada.fase,
    antes: entrada.antes ?? null,
    depois: entrada.depois ?? null,
    motivo: entrada.motivo ?? null,
    permite_alteracao: entrada.permiteAlteracao ?? null,
    autor_id: entrada.autorId,
    autor_papel: entrada.autorPapel,
    resolucao: entrada.resolucao ?? null,
  });

  if (error && !isSchemaMissing(error.message)) {
    console.error("[orcamento] falha ao registrar alteração na trilha:", error.message);
  }
}

/**
 * Lê a trilha de uma empresa × ano. Filtros opcionais por fase e por setor — a
 * tela de retorno usa fase='validacao' + os setores do construtor; a linha do
 * tempo não filtra nada.
 */
export async function getTrilha(
  companyId: string,
  year: number,
  opts?: { fase?: string; setorIds?: string[]; limite?: number },
): Promise<{ itens?: TrilhaEntrada[]; error?: string; needsMigration?: boolean }> {
  if (!companyId) return { itens: [] };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const user = await getOrcamentoUser();
  if (!user) return { error: SEM_ACESSO };
  if (!podeVerEmpresa(user, companyId)) return { error: SEM_ACESSO };

  const supabase = db() ?? (await createClient());
  let q = supabase
    .from("orcamento_alteracoes")
    .select(
      "id, created_at, category_code, setor_id, metodo, alvo_tipo, alvo_id, alvo_rotulo, " +
        "acao, fase, antes, depois, motivo, permite_alteracao, autor_papel, resolucao, " +
        "autor:users!orcamento_alteracoes_autor_id_fkey(name, email), " +
        "setor:orcamento_setores(name)",
    )
    .eq("company_id", companyId)
    .eq("year", year)
    .order("created_at", { ascending: false })
    .limit(opts?.limite ?? 500);

  if (opts?.fase) q = q.eq("fase", opts.fase);
  if (opts?.setorIds) {
    // Lista vazia = nenhum setor: devolve vazio em vez de virar "sem filtro".
    if (opts.setorIds.length === 0) return { itens: [] };
    q = q.in("setor_id", opts.setorIds);
  }

  const { data, error } = await q;
  if (error) {
    if (isSchemaMissing(error.message)) return { needsMigration: true };
    return { error: error.message };
  }

  type Row = {
    id: string;
    created_at: string;
    category_code: string | null;
    setor_id: string | null;
    metodo: string | null;
    alvo_tipo: string;
    alvo_id: string | null;
    alvo_rotulo: string | null;
    acao: string;
    fase: string;
    antes: Record<string, unknown> | null;
    depois: Record<string, unknown> | null;
    motivo: string | null;
    permite_alteracao: boolean | null;
    autor_papel: string | null;
    resolucao: string | null;
    autor: { name: string | null; email: string | null } | null;
    setor: { name: string | null } | null;
  };

  const itens = ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    categoryCode: r.category_code,
    setorId: r.setor_id,
    setorNome: r.setor?.name ?? null,
    metodo: r.metodo,
    alvoTipo: r.alvo_tipo as TrilhaEntrada["alvoTipo"],
    alvoId: r.alvo_id,
    alvoRotulo: r.alvo_rotulo,
    acao: r.acao as TrilhaEntrada["acao"],
    fase: r.fase as TrilhaEntrada["fase"],
    antes: r.antes,
    depois: r.depois,
    motivo: r.motivo,
    permiteAlteracao: r.permite_alteracao,
    autorNome: r.autor?.name ?? r.autor?.email ?? null,
    autorPapel: r.autor_papel as TrilhaEntrada["autorPapel"],
    resolucao: r.resolucao as TrilhaEntrada["resolucao"],
  }));

  return { itens };
}
