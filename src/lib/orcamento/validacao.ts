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
 * O item do planejamento usa a DESCRIÇÃO, não o índice: índice muda quando
 * alguém reordena a proposta, e o visto pularia de item — o diretor veria
 * "revisado" no que não olhou.
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
      return `ps:${ref.categoryCode ?? ""}:${ref.setorId ?? "-"}:${(ref.descricao ?? "").trim()}`;
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
 * Item da PROPOSTA do planejamento que conta para o orçamento.
 *
 * O item do planejamento não é uma linha de tabela: ele vive dentro do jsonb
 * `orcamento_planejamento_socios.proposta`. Cancelar, aqui, é marcar
 * `cancelado: true` no próprio objeto — e é ESTE filtro que a Prévia precisa
 * aplicar, não o `cancelado_em` da tabela `_itens` (que guarda a BASE da
 * entrevista, não o orçamento).
 */
export function itemPropostaAtivo(item: { cancelado?: unknown } | null | undefined): boolean {
  return item?.cancelado !== true;
}

/**
 * Marca (ou desmarca) o cancelamento do item na posição `indice` de uma lista
 * de itens da proposta. Função pura: devolve a lista NOVA.
 *
 * `descricaoEsperada` é uma trava contra corrida: a tela manda o índice que ela
 * viu, e se a lista mudou nesse meio-tempo o cancelamento cairia no item
 * errado. Sem conferir, o diretor cancelaria "Trello" achando que cancelou
 * "Google Ads".
 */
export function marcarItemProposta(
  itens: readonly Record<string, unknown>[],
  indice: number,
  descricaoEsperada: string,
  marca: { cancelado: boolean; motivo?: string | null; por?: string | null },
): { itens: Record<string, unknown>[]; error?: string } {
  if (!Number.isInteger(indice) || indice < 0 || indice >= itens.length) {
    return { itens: [...itens], error: "Item não encontrado na proposta." };
  }
  const atual = itens[indice];
  const desc = typeof atual.descricao === "string" ? atual.descricao.trim() : "";
  if (desc !== descricaoEsperada.trim()) {
    return {
      itens: [...itens],
      error: "A proposta mudou desde que a tela carregou. Recarregue e tente de novo.",
    };
  }
  const novos = itens.map((it, i) => {
    if (i !== indice) return { ...it };
    if (!marca.cancelado) {
      // Reativar: some com as marcas em vez de gravar `cancelado: false`, para
      // o item voltar a ser exatamente o que era.
      const { cancelado, cancelado_motivo, cancelado_por, ...resto } = it;
      void cancelado;
      void cancelado_motivo;
      void cancelado_por;
      return resto;
    }
    return {
      ...it,
      cancelado: true,
      cancelado_motivo: marca.motivo ?? null,
      cancelado_por: marca.por ?? null,
    };
  });
  return { itens: novos };
}
