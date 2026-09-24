// =============================================================================
// Regras da VALIDAÇÃO pela diretoria. Módulo PURO (client + server).
//
// Spec: docs/superpowers/specs/2026-09-22-orcamento-ciclo-validacao-design.md §7, §8
//
// Três regras vivem aqui, e todas as três se quebram por engano ao mexer numa
// tela ou numa action:
//
//  1. o que a diretoria pode tocar em cada método (gate POR CAMPO, não por
//     action — em média e valor fixo ela só troca o índice);
//  2. a TRAVA: item alterado pelo diretor fica travado para o construtor, salvo
//     se ele marcar "Permitir que o gestor ajuste";
//  3. item CANCELADO não entra em número nenhum — inclusive o item do
//     planejamento, que vive dentro do jsonb da proposta.
// =============================================================================

import type { OrcamentoMetodo } from "@/lib/orcamento/metodos";
import type { OrcamentoPapel } from "@/lib/supabase/types";

/**
 * Chave textual de um item para a REVISÃO linha a linha (tabela
 * `orcamento_revisoes`). Precisa ser estável entre recargas e única no ciclo.
 *
 * O planejamento usava `categoria:setor:descrição` porque o item vivia dentro
 * de um jsonb e não tinha id — e a descrição era o menos instável dos apoios
 * (o índice pulava quando a proposta era reordenada, e o visto ia parar no item
 * errado). Desde 23/09/2026 a despesa é linha de tabela: a chave é o id, como
 * nos outros métodos. Vistos gravados no formato antigo deixam de casar, o que
 * é aceitável — eles são por RODADA do ciclo, não permanentes.
 */
export function chaveDoAlvo(
  metodo: OrcamentoMetodo,
  ref: { id?: string | null; categoryCode?: string | null; setorId?: string | null; descricao?: string | null },
): string {
  switch (metodo) {
    case "pessoal":
      return `colab:${ref.id ?? ""}`;
    case "media":
      return `media:${ref.id ?? ""}`;
    case "valor_fixo":
      return `vf:${ref.id ?? ""}`;
    case "planejamento_socios":
      return `ps:${ref.id ?? ""}`;
    default:
      return `${metodo}:${ref.id ?? ""}`;
  }
}

/**
 * Campos que a DIRETORIA pode alterar em cada método.
 *
 * Média e valor fixo são construídos pelo administrador (são contratos e séries
 * históricas, não escolhas de gestor): a diretoria no máximo troca o índice de
 * correção aplicado. Qualquer outra mudança ali vira SOLICITAÇÃO, não edição —
 * decisão do dono do projeto em 22/09/2026.
 *
 * `null` = todos os campos liberados (pessoal e planejamento, onde o gestor
 * planejou e a diretoria discute o mérito).
 */
const CAMPOS_DA_DIRETORIA: Record<OrcamentoMetodo, readonly string[] | null> = {
  pessoal: null,
  planejamento_socios: null,
  media: ["indice_key"],
  valor_fixo: ["indice_key", "mes_reajuste"],
  viagens_ve: null,
  marketing_ve: null,
  endomarketing_ve: null,
};

/**
 * A diretoria pode alterar ESTES campos neste método?
 *
 * Recebe as chaves que a gravação vai tocar (já filtradas pelo diff) e devolve
 * as recusadas. Lista vazia = pode gravar.
 *
 * Gate por CAMPO e não por action de propósito: `setMediaIndice` e
 * `setMediaValor` são a mesma tela para o usuário, e bloquear a action inteira
 * tiraria do diretor a única coisa que ele PODE fazer ali.
 */
export function camposRecusadosParaDiretoria(
  metodo: OrcamentoMetodo,
  campos: readonly string[],
): string[] {
  const permitidos = CAMPOS_DA_DIRETORIA[metodo];
  if (permitidos === null) return [];
  return campos.filter((c) => !permitidos.includes(c));
}

/** Rótulo dos campos que a diretoria pode tocar, para a mensagem de recusa. */
export function camposPermitidosLabel(metodo: OrcamentoMetodo): string {
  const permitidos = CAMPOS_DA_DIRETORIA[metodo];
  if (permitidos === null) return "todos";
  const nomes: Record<string, string> = {
    indice_key: "o índice de correção",
    mes_reajuste: "o mês de reajuste",
  };
  return permitidos.map((c) => nomes[c] ?? c).join(" e ");
}

/** Métodos em que a diretoria pode CANCELAR um item. */
const METODOS_COM_CANCELAMENTO: ReadonlySet<OrcamentoMetodo> = new Set<OrcamentoMetodo>([
  "pessoal",
  "planejamento_socios",
]);

/**
 * Cancelar existe neste método?
 *
 * Só onde o item é uma escolha do gestor (uma contratação, um item planejado).
 * Média e valor fixo são séries e contratos do administrador — ali a diretoria
 * solicita, não cancela.
 */
export function podeCancelarNoMetodo(metodo: OrcamentoMetodo): boolean {
  return METODOS_COM_CANCELAMENTO.has(metodo);
}

// ─── A trava ─────────────────────────────────────────────────────────────────

export interface ItemTravavel {
  diretoria_travado?: boolean | null;
}

/**
 * O construtor pode escrever neste item?
 *
 * A trava só vale para quem NÃO é a diretoria nem o admin: o diretor que travou
 * continua podendo alterar, e o admin conserta o que precisa ser consertado.
 *
 * No planejamento a trava mora na DESPESA desde 23/09/2026. Antes ficava na
 * linha categoria × setor, por falta de linha própria do item (foi o que a
 * migration 20260924120000 corrigiu no modelo antigo).
 */
export function podeEscreverNoItem(
  papel: OrcamentoPapel,
  item: ItemTravavel | null | undefined,
): { pode: boolean; motivo?: string } {
  if (papel === "admin" || papel === "validador") return { pode: true };
  if (!item?.diretoria_travado) return { pode: true };
  return {
    pode: false,
    motivo:
      "Este item foi alterado pela diretoria e está travado. Use “Pedir liberação” para solicitar o ajuste.",
  };
}

// ─── Item cancelado ──────────────────────────────────────────────────────────

/**
 * O CANCELAMENTO do planejamento não tem mais função pura.
 *
 * `itemPropostaAtivo` e `marcarItemProposta` viviam aqui porque o item era um
 * objeto dentro do jsonb `orcamento_planejamento_socios.proposta`: cancelar era
 * reescrever o array inteiro, e o índice precisava de uma trava contra corrida
 * (a tela mandava a posição que tinha visto, e a lista podia ter mudado).
 *
 * Com a despesa virando linha (`orcamento_planejamento_despesas`), cancelar é
 * um UPDATE por id e a Prévia filtra por `cancelado = false` na própria
 * consulta. Não recrie a marcação em jsonb.
 */

