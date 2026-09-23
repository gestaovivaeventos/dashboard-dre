"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import {
  autorizarEscrita,
  autorizarLeitura,
  getOrcamentoUser,
  podeVerEmpresa,
  setoresDeEscrita,
  SEM_ACESSO,
} from "@/lib/orcamento/auth";
import { isValidBudgetYear } from "@/lib/orcamento/years";
import { isSchemaMissing } from "@/lib/orcamento/errors";
import type { OrcamentoMetodo } from "@/lib/orcamento/metodos";
import type { CicloEstado } from "@/lib/orcamento/ciclo";

/**
 * A REVISÃO linha a linha da diretoria.
 *
 * O diretor valida dentro das telas de método: escolhe o setor e percorre as
 * linhas, marcando o visto. Isto guarda os vistos — por CICLO e por RODADA, de
 * modo que um reenvio zera tudo: a rodada nova precisa ser olhada de novo, e
 * herdar os vistos da anterior daria a ele um setor "todo revisado" que ele não
 * viu.
 */

const db = () => createAdminClientIfAvailable();

export interface RevisaoEstado {
  /** Chaves já revisadas nesta rodada (ver `chaveDoAlvo`). */
  revisadas: string[];
  /** O ciclo está na janela em que a revisão faz sentido? */
  emValidacao: boolean;
  estado: CicloEstado;
  /** Quem olha pode decidir agora (diretoria ou admin, com o ciclo na janela). */
  podeDecidir: boolean;
  /**
   * Quem olha É diretoria (ou admin), independente da fase.
   *
   * Serve para a barra aparecer em modo INFORMATIVO fora da janela: sem isso, o
   * diretor abre a tela num ciclo "em construção" e não há pista nenhuma de por
   * que ele não consegue validar — foi exatamente o que aconteceu no teste.
   */
  papelDecide: boolean;
  /** Esta tela × setor já foi concluída pela diretoria nesta rodada. */
  telaConcluida: boolean;
  /** Quantas combinações (tela × setor) já foram concluídas nesta rodada. */
  telasConcluidas: number;
  /**
   * O gestor FINALIZOU esta tela × setor: o orçamento dali está fechado para
   * edição, e só um administrador reabre.
   */
  finalizada: boolean;
  /** Quem olha pode reabrir (admin). */
  podeReabrir: boolean;
}

/**
 * Vistos da empresa × ano, opcionalmente recortados por método e setor — é o
 * que a barra usa para o progresso da tela em que o diretor está.
 */
export async function getRevisoes(
  companyId: string,
  year: number,
  opts?: { metodo?: OrcamentoMetodo; setorId?: string | null },
): Promise<{ dados?: RevisaoEstado; error?: string }> {
  if (!companyId) return { error: "Selecione uma empresa." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const supabase = db() ?? (await createClient());
  const auth = await autorizarLeitura(supabase, companyId, year);
  if (!auth.ok) return { error: auth.error };

  const { data: ciclo } = await supabase
    .from("orcamento_ciclos")
    .select("id, estado, rodada")
    .eq("company_id", companyId)
    .eq("year", year)
    .maybeSingle();

  const estado = ((ciclo?.estado as CicloEstado) ?? "em_construcao") as CicloEstado;
  const emValidacao = estado === "em_validacao";
  const papelDecide = auth.user.papel === "validador" || auth.user.isAdmin;

  if (!ciclo) {
    return {
      dados: {
        revisadas: [],
        emValidacao,
        estado,
        podeDecidir: papelDecide && emValidacao,
        papelDecide,
        telaConcluida: false,
        telasConcluidas: 0,
        finalizada: false,
        podeReabrir: auth.user.isAdmin,
      },
    };
  }

  let q = supabase
    .from("orcamento_revisoes")
    .select("alvo_chave")
    .eq("ciclo_id", ciclo.id as string)
    .eq("rodada", Number(ciclo.rodada ?? 0));
  if (opts?.metodo) q = q.eq("metodo", opts.metodo);
  if (opts?.setorId) q = q.eq("setor_id", opts.setorId);

  const { data, error } = await q;
  if (error && !isSchemaMissing(error.message)) return { error: error.message };

  // Fechamentos por tela × setor desta rodada.
  const { data: telas } = await supabase
    .from("orcamento_validacoes_tela")
    .select("metodo, setor_chave")
    .eq("ciclo_id", ciclo.id as string)
    .eq("rodada", Number(ciclo.rodada ?? 0));
  const chaveTela = (m: string, sid: string | null) => `${m}|${sid ?? "-"}`;
  const concluidas = new Set(
    ((telas ?? []) as Array<{ metodo: string; setor_chave: string }>).map((t) =>
      chaveTela(t.metodo, t.setor_chave === "-" ? null : t.setor_chave),
    ),
  );

  // Finalização do gestor desta tela × setor.
  let finalizada = false;
  if (opts?.metodo) {
    const { data: fin } = await supabase
      .from("orcamento_setor_entregas")
      .select("entregue_em")
      .eq("ciclo_id", ciclo.id as string)
      .eq("rodada", Number(ciclo.rodada ?? 0))
      .eq("metodo", opts.metodo)
      .eq("setor_chave", opts.setorId ?? "-")
      .maybeSingle();
    finalizada = Boolean(fin);
  }

  return {
    dados: {
      revisadas: (data ?? []).map((r) => r.alvo_chave as string),
      emValidacao,
      estado,
      podeDecidir: papelDecide && emValidacao,
      papelDecide,
      telaConcluida:
        opts?.metodo != null &&
        concluidas.has(chaveTela(opts.metodo, opts.setorId ?? null)),
      telasConcluidas: concluidas.size,
      finalizada,
      podeReabrir: auth.user.isAdmin,
    },
  };
}

/**
 * "Terminei o orçamento DESTA tela NESTE setor" — e fecha para edição.
 *
 * Diferente do que a entrega era antes (um aviso sem efeito), a finalização
 * TRAVA: nem o próprio gestor edita depois. Só um administrador reabre, pelo
 * botão ao lado. É o que dá sentido ao ato — sem a trava, "finalizei" era uma
 * opinião que o orçamento não respeitava.
 */
export async function finalizarTelaSetor(params: {
  companyId: string;
  year: number;
  metodo: OrcamentoMetodo;
  setorId: string | null;
  /** Reabrir (admin). */
  reabrir?: boolean;
}): Promise<{ ok?: true; error?: string; needsMigration?: boolean }> {
  const { companyId, year, metodo, setorId, reabrir = false } = params;
  if (!companyId) return { error: "Empresa inválida." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const supabase = db();
  if (!supabase) return { error: "Serviço indisponível." };

  const user = await getOrcamentoUser();
  if (!user) return { error: SEM_ACESSO };
  if (!podeVerEmpresa(user, companyId)) return { error: SEM_ACESSO };

  // Reabrir é do ADMIN. Se o próprio gestor pudesse reabrir, a trava não
  // travaria nada — seria um botão de dois estados.
  if (reabrir && !user.isAdmin) {
    return { error: "Só um administrador reabre um orçamento finalizado." };
  }

  const { data: ciclo } = await supabase
    .from("orcamento_ciclos")
    .select("id, rodada, estado")
    .eq("company_id", companyId)
    .eq("year", year)
    .maybeSingle();
  if (!ciclo) return { error: "Este orçamento ainda não tem um ciclo — nada a finalizar." };

  // Finalizar só faz sentido enquanto se constrói (ou se ajusta, no retorno).
  const estado = ciclo.estado as CicloEstado;
  if (!reabrir && estado !== "em_construcao" && estado !== "em_ajuste") {
    return { error: "Este orçamento não está em construção." };
  }

  // Escopo: o gestor finaliza os setores dele; admin, qualquer um.
  if (!user.isAdmin) {
    const meus = await setoresDeEscrita(supabase, user, companyId, year, estado);
    if (meus !== null && !(setorId && meus.includes(setorId))) {
      return { error: "Você só pode finalizar os setores vinculados a você." };
    }
  }

  const chave = setorId ?? "-";
  if (reabrir) {
    const { error } = await supabase
      .from("orcamento_setor_entregas")
      .delete()
      .eq("ciclo_id", ciclo.id as string)
      .eq("rodada", Number(ciclo.rodada ?? 0))
      .eq("metodo", metodo)
      .eq("setor_chave", chave);
    if (error) {
      if (isSchemaMissing(error.message)) return { needsMigration: true };
      return { error: error.message };
    }
  } else {
    const { error } = await supabase.from("orcamento_setor_entregas").upsert(
      {
        ciclo_id: ciclo.id as string,
        rodada: Number(ciclo.rodada ?? 0),
        metodo,
        setor_chave: chave,
        setor_id: setorId,
        entregue_em: new Date().toISOString(),
        entregue_por: user.userId,
      },
      { onConflict: "ciclo_id,rodada,metodo,setor_chave" },
    );
    if (error) {
      if (isSchemaMissing(error.message)) return { needsMigration: true };
      return { error: error.message };
    }
  }

  revalidatePath(`/orcamento/empresa/${companyId}/${year}`);
  return { ok: true };
}

/**
 * A tela × setor está FINALIZADA (fechada para edição)?
 *
 * Chamada pelas actions de escrita de cada método. O admin nunca é barrado —
 * é ele quem reabre, e exigir que reabra para consertar uma linha seria
 * cerimônia sem ganho.
 */
export async function telaSetorFinalizada(
  companyId: string,
  year: number,
  metodo: OrcamentoMetodo,
  setorId: string | null,
): Promise<boolean> {
  const supabase = db();
  if (!supabase) return false;
  const { data: ciclo } = await supabase
    .from("orcamento_ciclos")
    .select("id, rodada")
    .eq("company_id", companyId)
    .eq("year", year)
    .maybeSingle();
  if (!ciclo) return false;
  const { data } = await supabase
    .from("orcamento_setor_entregas")
    .select("entregue_em")
    .eq("ciclo_id", ciclo.id as string)
    .eq("rodada", Number(ciclo.rodada ?? 0))
    .eq("metodo", metodo)
    .eq("setor_chave", setorId ?? "-")
    .maybeSingle();
  return Boolean(data);
}

/**
 * "Terminei de revisar ESTA tela NESTE setor."
 *
 * A validação é fechada por combinação (método × setor) porque é assim que o
 * trabalho acontece: a diretoria fecha o Pessoal do Atendimento, depois a Média
 * do Financeiro, muitas vezes em dias diferentes e com responsáveis diferentes.
 * Um único "concluir" da empresa inteira não dava onde registrar esse progresso.
 *
 * Fechar uma tela NÃO move o ciclo: devolver o orçamento aos gestores continua
 * sendo um ato explícito (`concluir_validacao`), porque é ele que reabre a
 * edição para eles.
 */
export async function concluirTelaSetor(params: {
  companyId: string;
  year: number;
  metodo: OrcamentoMetodo;
  setorId: string | null;
  desfazer?: boolean;
}): Promise<{ ok?: true; error?: string; needsMigration?: boolean }> {
  const { companyId, year, metodo, setorId, desfazer = false } = params;
  if (!companyId) return { error: "Empresa inválida." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const supabase = db();
  if (!supabase) return { error: "Serviço indisponível." };

  const auth = await autorizarEscrita(supabase, companyId, year);
  if (!auth.ok) return { error: auth.error };
  if (!(auth.user.papel === "validador" || auth.user.isAdmin)) {
    return { error: "Só a diretoria conclui a validação." };
  }
  if (auth.estado !== "em_validacao") {
    return { error: "Este orçamento não está em validação." };
  }

  const { data: ciclo } = await supabase
    .from("orcamento_ciclos")
    .select("id, rodada")
    .eq("company_id", companyId)
    .eq("year", year)
    .maybeSingle();
  if (!ciclo) return { error: "Ciclo não encontrado." };

  const chave = setorId ?? "-";
  if (desfazer) {
    const { error } = await supabase
      .from("orcamento_validacoes_tela")
      .delete()
      .eq("ciclo_id", ciclo.id as string)
      .eq("rodada", Number(ciclo.rodada ?? 0))
      .eq("metodo", metodo)
      .eq("setor_chave", chave);
    if (error) {
      if (isSchemaMissing(error.message)) return { needsMigration: true };
      return { error: error.message };
    }
  } else {
    const { error } = await supabase.from("orcamento_validacoes_tela").upsert(
      {
        ciclo_id: ciclo.id as string,
        rodada: Number(ciclo.rodada ?? 0),
        metodo,
        setor_chave: chave,
        company_id: companyId,
        year,
        setor_id: setorId,
        concluido_em: new Date().toISOString(),
        concluido_por: auth.user.userId,
      },
      { onConflict: "ciclo_id,rodada,metodo,setor_chave" },
    );
    if (error) {
      if (isSchemaMissing(error.message)) return { needsMigration: true };
      return { error: error.message };
    }
  }

  revalidatePath(`/orcamento/empresa/${companyId}/${year}`);
  return { ok: true };
}

/**
 * Marca (ou desmarca) o visto de uma linha.
 *
 * Não altera o orçamento — é o registro de que a diretoria OLHOU aquela linha.
 * Por isso não passa pela trilha: vinte vistos por setor afogariam o histórico
 * de decisões, que é o que o gestor lê no retorno.
 */
export async function marcarRevisado(params: {
  companyId: string;
  year: number;
  alvoChave: string;
  alvoTipo: string;
  metodo: OrcamentoMetodo;
  setorId: string | null;
  revisado: boolean;
}): Promise<{ ok?: true; error?: string; needsMigration?: boolean }> {
  const { companyId, year, alvoChave, alvoTipo, metodo, setorId, revisado } = params;
  if (!companyId || !alvoChave) return { error: "Item inválido." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const supabase = db();
  if (!supabase) return { error: "Serviço indisponível." };

  const auth = await autorizarEscrita(supabase, companyId, year);
  if (!auth.ok) return { error: auth.error };
  if (!(auth.user.papel === "validador" || auth.user.isAdmin)) {
    return { error: "Só a diretoria marca a revisão." };
  }
  if (auth.estado !== "em_validacao") {
    return { error: "A revisão acontece enquanto o orçamento está em validação." };
  }

  const { data: ciclo } = await supabase
    .from("orcamento_ciclos")
    .select("id, rodada")
    .eq("company_id", companyId)
    .eq("year", year)
    .maybeSingle();
  if (!ciclo) return { error: "Ciclo não encontrado." };

  if (!revisado) {
    const { error } = await supabase
      .from("orcamento_revisoes")
      .delete()
      .eq("ciclo_id", ciclo.id as string)
      .eq("rodada", Number(ciclo.rodada ?? 0))
      .eq("alvo_chave", alvoChave);
    if (error) {
      if (isSchemaMissing(error.message)) return { needsMigration: true };
      return { error: error.message };
    }
  } else {
    const { error } = await supabase.from("orcamento_revisoes").upsert(
      {
        ciclo_id: ciclo.id as string,
        rodada: Number(ciclo.rodada ?? 0),
        alvo_chave: alvoChave,
        alvo_tipo: alvoTipo,
        company_id: companyId,
        year,
        setor_id: setorId,
        metodo,
        revisado_em: new Date().toISOString(),
        revisado_por: auth.user.userId,
      },
      { onConflict: "ciclo_id,rodada,alvo_chave" },
    );
    if (error) {
      if (isSchemaMissing(error.message)) return { needsMigration: true };
      return { error: error.message };
    }
  }

  revalidatePath(`/orcamento/empresa/${companyId}/${year}`);
  return { ok: true };
}

/**
 * Marca todas as linhas de uma tela × setor de uma vez ("revisar tudo").
 *
 * Existe porque o caso mais comum é o diretor concordar com o setor inteiro: sem
 * isto ele daria trinta cliques para dizer "está bom", e o visto viraria um
 * imposto em vez de uma ferramenta.
 */
export async function marcarTodosRevisados(params: {
  companyId: string;
  year: number;
  metodo: OrcamentoMetodo;
  setorId: string | null;
  alvos: Array<{ chave: string; tipo: string }>;
  revisado: boolean;
}): Promise<{ ok?: true; marcados?: number; error?: string }> {
  const { companyId, year, metodo, setorId, alvos, revisado } = params;
  if (alvos.length === 0) return { ok: true, marcados: 0 };

  for (const a of alvos) {
    const res = await marcarRevisado({
      companyId,
      year,
      alvoChave: a.chave,
      alvoTipo: a.tipo,
      metodo,
      setorId,
      revisado,
    });
    if (res.error) return { error: res.error };
  }
  return { ok: true, marcados: alvos.length };
}
