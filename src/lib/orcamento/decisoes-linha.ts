import type { SupabaseClient } from "@supabase/supabase-js";

import {
  estadoDoItem,
  gestorPodeEditar,
  podeDecidir,
  type ValidacaoAlvoTipo,
  type ValidacaoEstado,
  type ValidacaoStatus,
} from "@/lib/orcamento/validacao-diretoria";

// =============================================================================
// Ler a decisão da diretoria de um conjunto de linhas, para as TELAS DE
// CONSTRUÇÃO mostrarem o estado e os botões ✓ / ✗ / 💬 em cada linha.
//
// Existe porque a mesma leitura aparece no Pessoal, na Média e no Valor fixo, e
// os três precisam concordar: estado, comentário e trava saem da mesma conta.
// Três cópias divergiriam no dia em que uma regra mudasse — e a trava é
// justamente a regra que não pode divergir entre a tela e a action de escrita.
//
// Módulo sem "use server" de propósito: um arquivo de server actions só pode
// exportar função async, e `estadoDaLinha` é síncrona.
// =============================================================================

export interface DecisaoLinha {
  status: ValidacaoStatus;
  comentario: string | null;
  decididoEm: string;
}

/** O que cada linha carrega para a tela. */
export interface EstadoDaLinha {
  estado: ValidacaoEstado;
  /** O que o diretor pediu que mude — só no 'revisar'. */
  comentario: string | null;
  /** Fechada para o construtor (aprovada ou reprovada). DERIVA do status. */
  travado: boolean;
}

/**
 * Decisões gravadas para estes alvos, por `alvo_id`.
 *
 * Tabela ausente (migration pendente) ou erro vira mapa VAZIO: a tela abre com
 * tudo pendente em vez de quebrar. A validação não pode ser o motivo de uma
 * tela de construção parar de carregar.
 */
export async function lerDecisoes(
  supabase: SupabaseClient,
  companyId: string,
  year: number,
  alvoTipo: ValidacaoAlvoTipo,
  alvoIds: readonly string[],
): Promise<Map<string, DecisaoLinha>> {
  const mapa = new Map<string, DecisaoLinha>();
  const ids = Array.from(new Set(alvoIds.filter(Boolean)));
  if (ids.length === 0) return mapa;

  const { data } = await supabase
    .from("orcamento_validacoes")
    .select("alvo_id, status, comentario, decidido_em")
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("alvo_tipo", alvoTipo)
    .in("alvo_id", ids);

  ((data ?? []) as Array<Record<string, unknown>>).forEach((v) => {
    mapa.set(v.alvo_id as string, {
      status: v.status as ValidacaoStatus,
      comentario: (v.comentario as string | null) ?? null,
      decididoEm: v.decidido_em as string,
    });
  });
  return mapa;
}

/**
 * Estado efetivo de uma linha para quem está olhando.
 *
 * A trava DERIVA do status — não há coluna. Não recrie `diretoria_travado`:
 * ele era escrito e liberado à mão, e foi ele que deixou colaboradores presos
 * sem saída pela tela.
 *
 * Quem decide (admin, diretoria) nunca se trava: é ele quem mexe no que já foi
 * decidido. E a decisão VENCIDA (linha alterada depois dela) não trava — o item
 * voltou a ser pendente.
 */
export function estadoDaLinha(
  decisao: DecisaoLinha | null | undefined,
  atualizadoEm: string | null | undefined,
  papel: string,
): EstadoDaLinha {
  const estado = estadoDoItem(decisao ?? null, atualizadoEm ?? null);
  return {
    estado,
    comentario: decisao?.comentario ?? null,
    travado: !podeDecidir(papel) && !gestorPodeEditar(estado),
  };
}
