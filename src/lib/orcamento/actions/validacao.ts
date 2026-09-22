"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { autorizarEscrita, podeEscreverNoSetor, SEM_ACESSO_SETOR } from "@/lib/orcamento/auth";
import { isSchemaMissing } from "@/lib/orcamento/errors";
import { isValidBudgetYear } from "@/lib/orcamento/years";
import { registrarAlteracao } from "@/lib/orcamento/actions/trilha";
import { travaOItem, type AlvoTipo } from "@/lib/orcamento/trilha";
import { marcarItemProposta } from "@/lib/orcamento/validacao";
import type { OrcamentoMetodo } from "@/lib/orcamento/metodos";

const db = () => createAdminClientIfAvailable();
const PATH = "/orcamento";

/**
 * Ações da DIRETORIA na validação (e as duas respostas do construtor).
 *
 * O que separa este arquivo das actions de método: aqui o diretor não está
 * construindo, está DECIDINDO. Toda ação leva motivo, entra na trilha e — nas
 * que alteram o item — o trava para quem o montou, a menos que o diretor marque
 * "Permitir que o gestor ajuste".
 *
 * Cancelar é MARCA, não exclusão: o item fica visível, riscado, com o motivo.
 * Apagar faria o gestor perder o que escreveu e deixaria a trilha como único
 * lugar onde aquela contratação existiu.
 */

/** Só a diretoria (e o admin) decide. Construtor cai aqui por engano de tela. */
function ehDecisor(papel: string): boolean {
  return papel === "validador" || papel === "admin";
}

// ─── Pessoal: cancelar / reativar colaborador ────────────────────────────────

export async function cancelarColaborador(
  id: string,
  motivo = "",
  permiteAlteracao = false,
  reativar = false,
): Promise<{ ok?: true; error?: string; needsMigration?: boolean }> {
  if (!id) return { error: "Colaborador inválido." };
  // Motivo é OPCIONAL aqui. Obrigá-lo em toda decisão fazia a diretoria digitar
  // uma justificativa por item — inviável para quem corta vinte de uma vez, e o
  // resultado prático seria texto de preenchimento ("ajuste", "corte"), que não
  // informa nada. Continua obrigatório onde o texto É a ação: solicitar um
  // ajuste e pedir liberação.

  const supabase = db() ?? (await createClient());
  const { data: linha, error: lerErr } = await supabase
    .from("orcamento_pessoal_colaboradores")
    .select("id, company_id, year, setor_id, nome, cancelado_em")
    .eq("id", id)
    .maybeSingle();
  if (lerErr) {
    if (isSchemaMissing(lerErr.message)) return { needsMigration: true };
    return { error: lerErr.message };
  }
  if (!linha) return { error: "Colaborador não encontrado." };

  const companyId = linha.company_id as string;
  const year = Number(linha.year);
  const auth = await autorizarEscrita(supabase, companyId, year);
  if (!auth.ok) return { error: auth.error };
  if (!ehDecisor(auth.user.papel)) {
    return { error: "Só a diretoria cancela itens do orçamento." };
  }

  const agora = new Date().toISOString();
  const patch = reativar
    ? {
        cancelado_em: null,
        cancelado_por: null,
        cancelado_motivo: null,
        diretoria_alterado_em: agora,
        diretoria_alterado_por: auth.user.userId,
      }
    : {
        cancelado_em: agora,
        cancelado_por: auth.user.userId,
        cancelado_motivo: motivo.trim(),
        diretoria_alterado_em: agora,
        diretoria_alterado_por: auth.user.userId,
      };

  // A trava acompanha a decisão: item mexido pela diretoria sai das mãos do
  // gestor, salvo liberação explícita.
  const acao = reativar ? "reativou" : "cancelou";
  const travar = travaOItem(auth.user.papel, acao, permiteAlteracao);

  const { error } = await supabase
    .from("orcamento_pessoal_colaboradores")
    .update({ ...patch, diretoria_travado: travar })
    .eq("id", id);
  if (error) {
    if (isSchemaMissing(error.message)) return { needsMigration: true };
    return { error: error.message };
  }

  await registrarAlteracao({
    companyId,
    year,
    cicloId: auth.cicloId,
    setorId: (linha.setor_id as string) ?? null,
    metodo: "pessoal",
    alvoTipo: "colaborador",
    alvoId: id,
    alvoRotulo: (linha.nome as string) || "Colaborador",
    acao,
    fase: auth.fase,
    antes: { cancelado_em: (linha.cancelado_em as string) ?? null },
    depois: { cancelado_em: patch.cancelado_em },
    motivo: motivo.trim() || null,
    permiteAlteracao: permiteAlteracao,
    autorId: auth.user.userId,
    autorPapel: auth.user.papel,
  });

  revalidatePath(PATH);
  return { ok: true };
}

// ─── Planejamento: cancelar / reativar item da PROPOSTA ──────────────────────

/**
 * O item do planejamento não é linha de tabela: é um objeto dentro do jsonb
 * `proposta`. Por isso a identificação é (índice + descrição) — e a descrição
 * é conferida para o cancelamento não cair no item errado se a proposta mudou
 * desde que a tela carregou.
 */
export async function cancelarItemPlanejamento(params: {
  companyId: string;
  year: number;
  categoryCode: string;
  setorId: string | null;
  indice: number;
  descricao: string;
  /** Opcional: só explica quando a diretoria quiser dizer algo. */
  motivo?: string;
  permiteAlteracao?: boolean;
  reativar?: boolean;
}): Promise<{ ok?: true; error?: string; needsMigration?: boolean }> {
  const {
    companyId,
    year,
    categoryCode,
    setorId,
    indice,
    descricao,
    motivo = "",
    permiteAlteracao = false,
    reativar = false,
  } = params;
  if (!companyId || !categoryCode) return { error: "Categoria inválida." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const supabase = db() ?? (await createClient());
  const auth = await autorizarEscrita(supabase, companyId, year);
  if (!auth.ok) return { error: auth.error };
  if (!ehDecisor(auth.user.papel)) {
    return { error: "Só a diretoria cancela itens do orçamento." };
  }

  let q = supabase
    .from("orcamento_planejamento_socios")
    .select("id, proposta, setor_id")
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("category_code", categoryCode);
  q = setorId ? q.eq("setor_id", setorId) : q.is("setor_id", null);
  const { data: linha, error: lerErr } = await q.maybeSingle();
  if (lerErr) {
    if (isSchemaMissing(lerErr.message)) return { needsMigration: true };
    return { error: lerErr.message };
  }
  if (!linha) return { error: "Planejamento não encontrado para esta categoria/setor." };

  const proposta = (linha.proposta ?? null) as { itens?: unknown; justificativa?: unknown } | null;
  const itens = Array.isArray(proposta?.itens)
    ? (proposta!.itens as Record<string, unknown>[])
    : [];
  const marcado = marcarItemProposta(itens, indice, descricao, {
    cancelado: !reativar,
    motivo: motivo.trim() || null,
    por: auth.user.userId,
  });
  if (marcado.error) return { error: marcado.error };

  const acao = reativar ? "reativou" : "cancelou";
  const travar = travaOItem(auth.user.papel, acao, permiteAlteracao);

  const { error } = await supabase
    .from("orcamento_planejamento_socios")
    .update({
      proposta: { ...(proposta ?? {}), itens: marcado.itens },
      diretoria_travado: travar,
      diretoria_alterado_em: new Date().toISOString(),
      diretoria_alterado_por: auth.user.userId,
      updated_by: auth.user.userId,
    })
    .eq("id", linha.id as string);
  if (error) {
    if (isSchemaMissing(error.message)) return { needsMigration: true };
    return { error: error.message };
  }

  await registrarAlteracao({
    companyId,
    year,
    cicloId: auth.cicloId,
    categoryCode,
    setorId: (linha.setor_id as string) ?? null,
    metodo: "planejamento_socios",
    alvoTipo: "planejamento_item",
    alvoRotulo: descricao,
    acao,
    fase: auth.fase,
    depois: { cancelado: !reativar },
    motivo: motivo.trim() || null,
    permiteAlteracao,
    autorId: auth.user.userId,
    autorPapel: auth.user.papel,
  });

  revalidatePath(PATH);
  return { ok: true };
}

/**
 * A diretoria altera o VALOR de um item do planejamento. Mesma identificação
 * (índice + descrição) e a mesma trava.
 */
export async function alterarItemPlanejamento(params: {
  companyId: string;
  year: number;
  categoryCode: string;
  setorId: string | null;
  indice: number;
  descricao: string;
  valorMensal: number;
  /** Opcional: só explica quando a diretoria quiser dizer algo. */
  motivo?: string;
  permiteAlteracao?: boolean;
}): Promise<{ ok?: true; error?: string; needsMigration?: boolean }> {
  const {
    companyId,
    year,
    categoryCode,
    setorId,
    indice,
    descricao,
    valorMensal,
    motivo = "",
    permiteAlteracao = false,
  } = params;
  if (!companyId || !categoryCode) return { error: "Categoria inválida." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };
  if (!Number.isFinite(valorMensal) || valorMensal < 0) return { error: "Valor inválido." };

  const supabase = db() ?? (await createClient());
  const auth = await autorizarEscrita(supabase, companyId, year);
  if (!auth.ok) return { error: auth.error };
  if (!ehDecisor(auth.user.papel)) {
    return { error: "Só a diretoria altera o orçamento na validação." };
  }

  let q = supabase
    .from("orcamento_planejamento_socios")
    .select("id, proposta, setor_id")
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("category_code", categoryCode);
  q = setorId ? q.eq("setor_id", setorId) : q.is("setor_id", null);
  const { data: linha, error: lerErr } = await q.maybeSingle();
  if (lerErr) {
    if (isSchemaMissing(lerErr.message)) return { needsMigration: true };
    return { error: lerErr.message };
  }
  if (!linha) return { error: "Planejamento não encontrado para esta categoria/setor." };

  const proposta = (linha.proposta ?? null) as { itens?: unknown } | null;
  const itens = Array.isArray(proposta?.itens)
    ? (proposta!.itens as Record<string, unknown>[])
    : [];
  if (!Number.isInteger(indice) || indice < 0 || indice >= itens.length) {
    return { error: "Item não encontrado na proposta." };
  }
  const atual = itens[indice];
  if (String(atual.descricao ?? "").trim() !== descricao.trim()) {
    return { error: "A proposta mudou desde que a tela carregou. Recarregue e tente de novo." };
  }
  const anterior = Number(atual.valorMensal ?? atual.valor_mensal ?? 0);
  const novos = itens.map((it, i) => (i === indice ? { ...it, valorMensal: valorMensal } : it));

  const travar = travaOItem(auth.user.papel, "alterou", permiteAlteracao);
  const { error } = await supabase
    .from("orcamento_planejamento_socios")
    .update({
      proposta: { ...(proposta ?? {}), itens: novos },
      diretoria_travado: travar,
      diretoria_alterado_em: new Date().toISOString(),
      diretoria_alterado_por: auth.user.userId,
      updated_by: auth.user.userId,
    })
    .eq("id", linha.id as string);
  if (error) {
    if (isSchemaMissing(error.message)) return { needsMigration: true };
    return { error: error.message };
  }

  await registrarAlteracao({
    companyId,
    year,
    cicloId: auth.cicloId,
    categoryCode,
    setorId: (linha.setor_id as string) ?? null,
    metodo: "planejamento_socios",
    alvoTipo: "planejamento_item",
    alvoRotulo: descricao,
    acao: "alterou",
    fase: auth.fase,
    antes: { valorMensal: anterior },
    depois: { valorMensal },
    motivo: motivo.trim(),
    permiteAlteracao,
    autorId: auth.user.userId,
    autorPapel: auth.user.papel,
  });

  revalidatePath(PATH);
  return { ok: true };
}

// ─── Solicitar ajuste (a diretoria pede sem mexer) ───────────────────────────

/**
 * "Reduza 10%, você escolhe onde." Não altera dado nenhum e, por isso, **não
 * trava nada** — a solicitação pressupõe que o construtor vá editar.
 *
 * É o caminho da diretoria em média e valor fixo, onde ela não edita (só troca
 * o índice), e em qualquer caso em que a decisão de COMO cortar seja de quem
 * conhece a operação.
 */
export async function solicitarAjuste(params: {
  companyId: string;
  year: number;
  categoryCode?: string | null;
  setorId: string | null;
  metodo?: OrcamentoMetodo | null;
  alvoTipo: AlvoTipo;
  alvoId?: string | null;
  alvoRotulo: string;
  motivo: string;
}): Promise<{ ok?: true; error?: string }> {
  const { companyId, year, motivo } = params;
  if (!companyId) return { error: "Empresa inválida." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };
  if (!motivo.trim()) return { error: "Escreva o que você está pedindo ao gestor." };

  const supabase = db() ?? (await createClient());
  const auth = await autorizarEscrita(supabase, companyId, year);
  if (!auth.ok) return { error: auth.error };
  if (!ehDecisor(auth.user.papel)) {
    return { error: "Só a diretoria solicita ajustes na validação." };
  }

  await registrarAlteracao({
    companyId,
    year,
    cicloId: auth.cicloId,
    categoryCode: params.categoryCode ?? null,
    setorId: params.setorId,
    metodo: params.metodo ?? null,
    alvoTipo: params.alvoTipo,
    alvoId: params.alvoId ?? null,
    alvoRotulo: params.alvoRotulo,
    acao: "solicitou",
    fase: auth.fase,
    motivo: motivo.trim(),
    // Fica pendente até o construtor atender ou contestar no retorno.
    resolucao: "pendente",
    autorId: auth.user.userId,
    autorPapel: auth.user.papel,
  });

  revalidatePath(PATH);
  return { ok: true };
}

// ─── Liberar item travado (diretoria) ────────────────────────────────────────

const TABELA_DO_ALVO: Partial<Record<AlvoTipo, string>> = {
  colaborador: "orcamento_pessoal_colaboradores",
  valor_fixo_contrato: "orcamento_valor_fixo_categorias",
  media_linha: "orcamento_media_categorias",
};

/**
 * Destrava um item para o construtor voltar a editá-lo. É o único caminho: a
 * trava não expira nem cai na virada de rodada.
 *
 * Também resolve a contestação pendente (o "pedido de liberação") daquele item,
 * para o pedido não ficar aberto para sempre depois de atendido.
 */
export async function liberarItem(params: {
  companyId: string;
  year: number;
  alvoTipo: AlvoTipo;
  alvoId?: string | null;
  categoryCode?: string | null;
  setorId?: string | null;
  alvoRotulo: string;
  motivo?: string;
}): Promise<{ ok?: true; error?: string }> {
  const { companyId, year, alvoTipo, alvoId } = params;
  if (!companyId) return { error: "Empresa inválida." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const supabase = db() ?? (await createClient());
  const auth = await autorizarEscrita(supabase, companyId, year);
  if (!auth.ok) return { error: auth.error };
  if (!ehDecisor(auth.user.papel)) {
    return { error: "Só a diretoria libera um item travado." };
  }

  const tabela = TABELA_DO_ALVO[alvoTipo];
  if (tabela && alvoId) {
    const { error } = await supabase
      .from(tabela)
      .update({ diretoria_travado: false })
      .eq("id", alvoId)
      .eq("company_id", companyId);
    if (error) return { error: error.message };
  } else if (alvoTipo === "planejamento_item") {
    // O item do planejamento não tem linha própria: a trava vive na categoria ×
    // setor, que é o que o construtor edita.
    let q = supabase
      .from("orcamento_planejamento_socios")
      .update({ diretoria_travado: false })
      .eq("company_id", companyId)
      .eq("year", year);
    if (params.categoryCode) q = q.eq("category_code", params.categoryCode);
    q = params.setorId ? q.eq("setor_id", params.setorId) : q.is("setor_id", null);
    const { error } = await q;
    if (error) return { error: error.message };
  }

  // Resolve a contestação pendente do mesmo alvo, se houver.
  if (alvoId) {
    await supabase
      .from("orcamento_alteracoes")
      .update({
        resolucao: "liberada",
        resolvido_em: new Date().toISOString(),
        resolvido_por: auth.user.userId,
      })
      .eq("company_id", companyId)
      .eq("year", year)
      .eq("alvo_id", alvoId)
      .eq("acao", "contestou")
      .eq("resolucao", "pendente");
  }

  await registrarAlteracao({
    companyId,
    year,
    cicloId: auth.cicloId,
    categoryCode: params.categoryCode ?? null,
    setorId: params.setorId ?? null,
    alvoTipo,
    alvoId: alvoId ?? null,
    alvoRotulo: params.alvoRotulo,
    acao: "liberou",
    fase: auth.fase,
    motivo: params.motivo?.trim() || null,
    permiteAlteracao: true,
    autorId: auth.user.userId,
    autorPapel: auth.user.papel,
  });

  revalidatePath(PATH);
  return { ok: true };
}

// ─── Pedir liberação (construtor) ────────────────────────────────────────────

/**
 * A resposta do construtor a um item travado. Não desfaz nada — abre um pedido
 * que só a diretoria resolve.
 *
 * É o que substitui "desfazer a alteração da diretoria": desfazer em silêncio
 * esvaziaria a validação, então o caminho é pedir, com justificativa.
 */
export async function pedirLiberacao(params: {
  companyId: string;
  year: number;
  alvoTipo: AlvoTipo;
  alvoId?: string | null;
  categoryCode?: string | null;
  setorId: string | null;
  alvoRotulo: string;
  motivo: string;
}): Promise<{ ok?: true; error?: string }> {
  const { companyId, year, motivo } = params;
  if (!companyId) return { error: "Empresa inválida." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };
  if (!motivo.trim()) {
    return { error: "Explique por que este item precisa ser ajustado." };
  }

  const supabase = db() ?? (await createClient());
  const auth = await autorizarEscrita(supabase, companyId, year);
  if (!auth.ok) return { error: auth.error };
  // Escopo de setor: o construtor pede liberação dos setores dele.
  if (!podeEscreverNoSetor(auth.setores, params.setorId)) {
    return { error: SEM_ACESSO_SETOR };
  }

  await registrarAlteracao({
    companyId,
    year,
    cicloId: auth.cicloId,
    categoryCode: params.categoryCode ?? null,
    setorId: params.setorId,
    alvoTipo: params.alvoTipo,
    alvoId: params.alvoId ?? null,
    alvoRotulo: params.alvoRotulo,
    acao: "contestou",
    fase: auth.fase,
    motivo: motivo.trim(),
    resolucao: "pendente",
    autorId: auth.user.userId,
    autorPapel: auth.user.papel,
  });

  revalidatePath(PATH);
  return { ok: true };
}

/** Marca uma solicitação da diretoria como atendida ou vista (construtor). */
export async function responderSolicitacao(
  alteracaoId: string,
  resolucao: "atendida" | "contestada",
  comentario?: string,
): Promise<{ ok?: true; error?: string }> {
  if (!alteracaoId) return { error: "Solicitação inválida." };

  const supabase = db() ?? (await createClient());
  const { data: alt, error: lerErr } = await supabase
    .from("orcamento_alteracoes")
    .select("id, company_id, year, setor_id, alvo_rotulo, alvo_tipo, alvo_id, category_code")
    .eq("id", alteracaoId)
    .maybeSingle();
  if (lerErr) return { error: lerErr.message };
  if (!alt) return { error: "Solicitação não encontrada." };

  const companyId = alt.company_id as string;
  const year = Number(alt.year);
  const auth = await autorizarEscrita(supabase, companyId, year);
  if (!auth.ok) return { error: auth.error };
  if (!podeEscreverNoSetor(auth.setores, (alt.setor_id as string) ?? null)) {
    return { error: SEM_ACESSO_SETOR };
  }

  const { error } = await supabase
    .from("orcamento_alteracoes")
    .update({
      resolucao,
      resolvido_em: new Date().toISOString(),
      resolvido_por: auth.user.userId,
    })
    .eq("id", alteracaoId);
  if (error) return { error: error.message };

  await registrarAlteracao({
    companyId,
    year,
    cicloId: auth.cicloId,
    categoryCode: (alt.category_code as string) ?? null,
    setorId: (alt.setor_id as string) ?? null,
    alvoTipo: (alt.alvo_tipo as AlvoTipo) ?? "categoria_setor",
    alvoId: (alt.alvo_id as string) ?? null,
    alvoRotulo: (alt.alvo_rotulo as string) ?? "Solicitação",
    acao: resolucao === "atendida" ? "atendeu" : "contestou",
    fase: auth.fase,
    motivo: comentario?.trim() || null,
    autorId: auth.user.userId,
    autorPapel: auth.user.papel,
  });

  revalidatePath(PATH);
  return { ok: true };
}
