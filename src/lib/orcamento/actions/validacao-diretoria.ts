"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { autorizarLeitura } from "@/lib/orcamento/auth";
import { isSchemaMissing } from "@/lib/orcamento/errors";
import { isValidBudgetYear } from "@/lib/orcamento/years";
import { registrarAlteracao } from "@/lib/orcamento/actions/trilha";
import type { OrcamentoMetodo } from "@/lib/orcamento/metodos";
import {
  contarValidacoes,
  estadoDoItem,
  motivoDaTrava,
  podeDecidir,
  type ContagemValidacao,
  type ValidacaoAlvoTipo,
  type ValidacaoStatus,
} from "@/lib/orcamento/validacao-diretoria";

// =============================================================================
// Ações da DIRETORIA na validação — versão simples (25/09/2026).
//
// Três botões por item na prévia do setor: ✓ aprovar, ✗ reprovar e 💬 revisar
// (com o comentário dizendo o que mudar). Uma linha por item; decidir de novo
// sobrescreve, e o histórico fica na trilha, que já registra tudo.
//
// O que NÃO existe aqui, de propósito: fase, rodada, versão congelada, entrega
// por setor, liberação de item e pedido de liberação. Foi esse conjunto que
// tornou a validação anterior complexa demais para o uso real.
// =============================================================================

const PATH = "/orcamento";

/** De qual método é cada tipo de alvo — o contador do card é por método. */
const METODO_DO_ALVO: Record<ValidacaoAlvoTipo, OrcamentoMetodo> = {
  colaborador: "pessoal",
  media_linha: "media",
  valor_fixo_contrato: "valor_fixo",
  planejamento_item: "planejamento_socios",
  viagem: "viagens",
};

export interface DecidirInput {
  companyId: string;
  year: number;
  alvoTipo: ValidacaoAlvoTipo;
  alvoId: string;
  /** Setor do item — recorta o contador do gestor. */
  setorId: string | null;
  /** Nome do item no momento da decisão, para a trilha e para a tela. */
  alvoRotulo: string;
  status: ValidacaoStatus;
  /** Obrigatório em 'revisar': devolver sem dizer o quê não ajuda ninguém. */
  comentario?: string | null;
}

/**
 * Grava (ou troca) a decisão sobre um item.
 *
 * Só a diretoria e o admin decidem, e o escopo da decisão é a EMPRESA, não os
 * setores do decisor — por isso o guard é `autorizarLeitura` (alcance da
 * empresa) e não `autorizarEscrita`.
 *
 * A diferença não é detalhe: o diretor também MONTA o orçamento do setor dele,
 * e `setoresDeEscrita` o restringe a esses setores desde que o ciclo saiu (sem
 * janela de validação, ele virou um construtor como os outros). Usar o escopo
 * de escrita aqui faria o diretor tomar "só pode alterar os setores vinculados
 * a você" na maioria dos itens que ele precisa verificar — construir e decidir
 * são alcances diferentes. É o mesmo enquadramento do Compras, onde o diretor
 * aprova qualquer setor mas só é notificado dos setores dele.
 *
 * Quando o roteamento por diretor entrar, é aqui que ele recorta.
 */
export async function decidirItem(
  input: DecidirInput,
): Promise<{ ok?: true; error?: string; needsMigration?: boolean }> {
  const { companyId, year, alvoTipo, alvoId, setorId, status } = input;
  if (!companyId || !alvoId) return { error: "Item inválido." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const comentario = (input.comentario ?? "").trim();
  if (status === "revisar" && !comentario) {
    return { error: "Escreva o que o gestor precisa revisar." };
  }

  const supabase = createAdminClientIfAvailable() ?? (await createClient());
  const auth = await autorizarLeitura(supabase, companyId, year);
  if (!auth.ok) return { error: auth.error };
  if (!podeDecidir(auth.user.papel)) {
    return { error: "Só a diretoria aprova ou reprova itens do orçamento." };
  }

  const { error } = await supabase.from("orcamento_validacoes").upsert(
    {
      company_id: companyId,
      year,
      metodo: METODO_DO_ALVO[alvoTipo],
      setor_id: setorId,
      alvo_tipo: alvoTipo,
      alvo_id: alvoId,
      alvo_rotulo: input.alvoRotulo,
      status,
      // Comentário só faz sentido no 'revisar'; aprovar/reprovar limpa o que
      // houvesse, senão um pedido velho fica pendurado num item já resolvido.
      comentario: status === "revisar" ? comentario : null,
      decidido_em: new Date().toISOString(),
      decidido_por: auth.user.userId,
    },
    { onConflict: "company_id,year,alvo_tipo,alvo_id" },
  );
  if (error) {
    if (isSchemaMissing(error.message)) return { needsMigration: true };
    return { error: error.message };
  }

  await registrarAlteracao({
    companyId,
    year,
    setorId,
    metodo: METODO_DO_ALVO[alvoTipo],
    alvoTipo:
      alvoTipo === "colaborador"
        ? "colaborador"
        : alvoTipo === "media_linha"
          ? "media_linha"
          : alvoTipo === "valor_fixo_contrato"
            ? "valor_fixo_contrato"
            : "planejamento_item",
    alvoId,
    alvoRotulo: input.alvoRotulo,
    acao: status === "aprovado" ? "reativou" : status === "reprovado" ? "cancelou" : "solicitou",
    depois: { status },
    motivo: comentario || null,
    autorId: auth.user.userId,
    autorPapel: auth.user.papel,
  });

  revalidatePath(PATH);
  return { ok: true };
}

/** Tira a decisão, devolvendo o item para a fila. */
export async function limparDecisao(params: {
  companyId: string;
  year: number;
  alvoTipo: ValidacaoAlvoTipo;
  alvoId: string;
}): Promise<{ ok?: true; error?: string }> {
  const { companyId, year, alvoTipo, alvoId } = params;
  if (!companyId || !alvoId) return { error: "Item inválido." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());
  // Mesmo escopo de `decidirItem`: desfazer é decidir de novo.
  const auth = await autorizarLeitura(supabase, companyId, year);
  if (!auth.ok) return { error: auth.error };
  if (!podeDecidir(auth.user.papel)) {
    return { error: "Só a diretoria altera uma decisão." };
  }

  const { error } = await supabase
    .from("orcamento_validacoes")
    .delete()
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("alvo_tipo", alvoTipo)
    .eq("alvo_id", alvoId);
  if (error) return { error: error.message };

  revalidatePath(PATH);
  return { ok: true };
}

// ─── Contadores dos cards ────────────────────────────────────────────────────

export type ContagemPorMetodo = Partial<Record<OrcamentoMetodo, ContagemValidacao>>;

/**
 * Quantos itens de cada método estão em cada estado, **no recorte de quem
 * pergunta** — o gestor vê só os setores dele, a diretoria e o admin veem tudo.
 *
 * O contador vem das DECISÕES gravadas cruzadas com o total de itens de cada
 * método; o pendente é a diferença. Contar assim evita reconstruir a Prévia
 * inteira só para exibir um número no card.
 */
export async function contarValidacoesPorMetodo(
  companyId: string,
  year: number,
): Promise<{ contagens?: ContagemPorMetodo; error?: string }> {
  if (!companyId || !isValidBudgetYear(year)) return { contagens: {} };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());
  const auth = await autorizarLeitura(supabase, companyId, year);
  if (!auth.ok) return { error: auth.error };

  const noEscopo = <T extends { setor_id?: string | null }>(linhas: T[]): T[] =>
    auth.setores === null
      ? linhas
      : linhas.filter((l) => l.setor_id && auth.setores!.includes(l.setor_id));

  // Totais por método: quantos itens EXISTEM para validar.
  const [colabs, medias, contratos, despesas, decisoes] = await Promise.all([
    supabase
      .from("orcamento_pessoal_colaboradores")
      .select("id, setor_id, updated_at")
      .eq("company_id", companyId)
      .eq("year", year)
      .is("cancelado_em", null),
    supabase
      .from("orcamento_media_categorias")
      .select("category_code, setor_id, updated_at")
      .eq("company_id", companyId)
      .eq("year", year),
    supabase
      .from("orcamento_valor_fixo_categorias")
      .select("id, setor_id, updated_at")
      .eq("company_id", companyId)
      .eq("year", year),
    supabase
      .from("orcamento_planejamento_despesas")
      .select("id, setor_id, updated_at")
      .eq("company_id", companyId)
      .eq("year", year)
      .eq("cancelado", false),
    supabase
      .from("orcamento_validacoes")
      .select("alvo_tipo, alvo_id, status, decidido_em")
      .eq("company_id", companyId)
      .eq("year", year),
  ]);

  const porAlvo = new Map<string, { status: ValidacaoStatus; decididoEm: string }>();
  ((decisoes.data ?? []) as Array<Record<string, unknown>>).forEach((r) => {
    porAlvo.set(`${r.alvo_tipo as string}|${r.alvo_id as string}`, {
      status: r.status as ValidacaoStatus,
      decididoEm: r.decidido_em as string,
    });
  });

  const monta = (
    linhas: Array<Record<string, unknown>>,
    alvoTipo: ValidacaoAlvoTipo,
    chaveDe: (r: Record<string, unknown>) => string,
  ): ContagemValidacao =>
    contarValidacoes(
      noEscopo(linhas as Array<{ setor_id?: string | null }>).map((r) => {
        const row = r as Record<string, unknown>;
        return {
          atualizadoEm: (row.updated_at as string | null) ?? null,
          validacao: porAlvo.get(`${alvoTipo}|${chaveDe(row)}`) ?? null,
        };
      }),
    );

  return {
    contagens: {
      pessoal: monta(
        (colabs.data ?? []) as Array<Record<string, unknown>>,
        "colaborador",
        (r) => r.id as string,
      ),
      media: monta(
        (medias.data ?? []) as Array<Record<string, unknown>>,
        "media_linha",
        (r) => `${r.category_code as string}|${(r.setor_id as string | null) ?? ""}`,
      ),
      valor_fixo: monta(
        (contratos.data ?? []) as Array<Record<string, unknown>>,
        "valor_fixo_contrato",
        (r) => r.id as string,
      ),
      planejamento_socios: monta(
        (despesas.data ?? []) as Array<Record<string, unknown>>,
        "planejamento_item",
        (r) => r.id as string,
      ),
    },
  };
}


/**
 * O item está travado para ESTE usuário?
 *
 * Devolve a mensagem de recusa, ou `null` quando pode editar. A trava deriva
 * do status — não há coluna de trava, e foi de propósito: o
 * `diretoria_travado` do modelo antigo era escrito e liberado à mão, e foi ele
 * que deixou colaboradores presos sem nenhuma saída pela tela.
 *
 * Diretoria e admin passam sempre: são eles que mexem no que já foi decidido.
 * A decisão VENCIDA (item alterado depois dela) não trava — o item voltou a
 * ser pendente.
 */
export async function travaDaValidacao(params: {
  companyId: string;
  year: number;
  alvoTipo: ValidacaoAlvoTipo;
  alvoId: string;
  /** `updated_at` do item, para saber se a decisão venceu. */
  atualizadoEm: string | null;
  papel: string;
}): Promise<string | null> {
  if (podeDecidir(params.papel)) return null;

  const supabase = createAdminClientIfAvailable() ?? (await createClient());
  const { data, error } = await supabase
    .from("orcamento_validacoes")
    .select("status, decidido_em")
    .eq("company_id", params.companyId)
    .eq("year", params.year)
    .eq("alvo_tipo", params.alvoTipo)
    .eq("alvo_id", params.alvoId)
    .maybeSingle();
  // Sem tabela (migration pendente) ou sem decisão: nada trava. A validação
  // nunca pode ser o motivo de o módulo parar de aceitar escrita.
  if (error || !data) return null;

  const estado = estadoDoItem(
    { status: data.status as ValidacaoStatus, decididoEm: data.decidido_em as string },
    params.atualizadoEm,
  );
  return motivoDaTrava(estado);
}

