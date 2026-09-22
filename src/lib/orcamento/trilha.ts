// =============================================================================
// A trilha do orçamento: o registro de TODA escrita do módulo.
//
// Módulo PURO (client + server): tipos, rótulos e o diff de campos. A gravação
// fica em `actions/trilha.ts`.
//
// Por que registrar sempre, e não só durante a validação: custa uma linha por
// escrita e é o que faz "ver tudo o que foi feito" ser completo — a tela de
// retorno filtra por fase='validacao', mas a linha do tempo mostra o ciclo
// inteiro. Uma trilha que só existe numa fase não responde "quem mudou isso?".
// =============================================================================

import type { OrcamentoMetodo } from "@/lib/orcamento/metodos";
import type { OrcamentoPapel } from "@/lib/supabase/types";
import type { TrilhaFase } from "@/lib/orcamento/ciclo";

/** O que a alteração atingiu. Uma por granularidade natural de cada método. */
export type AlvoTipo =
  | "colaborador"
  | "planejamento_item"
  | "valor_fixo_contrato"
  | "media_linha"
  | "categoria_setor"
  | "ciclo";

export type TrilhaAcao =
  | "criou"
  | "alterou"
  | "cancelou"
  | "reativou"
  | "excluiu"
  | "moveu_categoria"
  | "moveu_setor"
  | "solicitou"
  | "liberou"
  | "contestou"
  | "marcou_ciente"
  | "atendeu"
  | "entregou_setor"
  | "desfez_entrega"
  | "enviou_validacao"
  | "concluiu_validacao"
  | "reenviou"
  | "concluiu"
  | "publicou"
  | "reabriu";

export type TrilhaResolucao = "pendente" | "atendida" | "contestada" | "liberada";

export const ACAO_LABEL: Record<TrilhaAcao, string> = {
  criou: "criou",
  alterou: "alterou",
  cancelou: "cancelou",
  reativou: "reativou",
  excluiu: "excluiu",
  moveu_categoria: "moveu de categoria",
  moveu_setor: "moveu de setor",
  solicitou: "solicitou ajuste",
  liberou: "liberou para ajuste",
  contestou: "pediu liberação",
  marcou_ciente: "marcou como ciente",
  atendeu: "atendeu",
  entregou_setor: "entregou o setor",
  desfez_entrega: "desfez a entrega",
  enviou_validacao: "enviou para validação",
  concluiu_validacao: "concluiu a validação",
  reenviou: "reenviou para validação",
  concluiu: "concluiu o orçamento",
  publicou: "publicou no Budget e Forecast",
  reabriu: "reabriu o orçamento",
};

export const ALVO_LABEL: Record<AlvoTipo, string> = {
  colaborador: "colaborador",
  planejamento_item: "item do planejamento",
  valor_fixo_contrato: "contrato",
  media_linha: "linha por média",
  categoria_setor: "categoria",
  ciclo: "ciclo",
};

/** Ações que a diretoria pratica — as que travam o item para o construtor. */
const ACOES_DE_DIRETORIA: ReadonlySet<TrilhaAcao> = new Set<TrilhaAcao>([
  "alterou",
  "cancelou",
  "reativou",
  "moveu_categoria",
  "moveu_setor",
  "excluiu",
]);

/**
 * A alteração TRAVA o item para o construtor?
 *
 * Regra: toda alteração do VALIDADOR num item o trava, salvo se ele marcar
 * "Permitir que o gestor ajuste". Solicitação (`solicitou`) nunca trava — ela
 * pressupõe que o construtor vá editar. Ação do próprio construtor, nunca.
 */
export function travaOItem(
  papel: OrcamentoPapel,
  acao: TrilhaAcao,
  permiteAlteracao: boolean | null | undefined,
): boolean {
  if (papel !== "validador") return false;
  if (!ACOES_DE_DIRETORIA.has(acao)) return false;
  return permiteAlteracao !== true;
}

/** Ações que criam uma pendência para o outro lado responder. */
export function abrePendencia(acao: TrilhaAcao): boolean {
  return acao === "solicitou" || acao === "contestou";
}

/** Uma alteração como ela é gravada. */
export interface TrilhaEntradaInput {
  companyId: string;
  year: number;
  cicloId?: string | null;
  versaoId?: string | null;
  categoryCode?: string | null;
  setorId?: string | null;
  metodo?: OrcamentoMetodo | null;
  alvoTipo: AlvoTipo;
  alvoId?: string | null;
  /** Nome do item NO MOMENTO — sobrevive à renomeação e ao item apagado. */
  alvoRotulo?: string | null;
  acao: TrilhaAcao;
  fase: TrilhaFase;
  antes?: Record<string, unknown> | null;
  depois?: Record<string, unknown> | null;
  motivo?: string | null;
  permiteAlteracao?: boolean | null;
  autorId: string;
  autorPapel: OrcamentoPapel;
  resolucao?: TrilhaResolucao | null;
}

/** Uma alteração como ela é lida (linha do tempo / retorno). */
export interface TrilhaEntrada {
  id: string;
  createdAt: string;
  categoryCode: string | null;
  setorId: string | null;
  setorNome: string | null;
  metodo: string | null;
  alvoTipo: AlvoTipo;
  alvoId: string | null;
  alvoRotulo: string | null;
  acao: TrilhaAcao;
  fase: TrilhaFase;
  antes: Record<string, unknown> | null;
  depois: Record<string, unknown> | null;
  motivo: string | null;
  permiteAlteracao: boolean | null;
  autorNome: string | null;
  autorPapel: OrcamentoPapel | null;
  resolucao: TrilhaResolucao | null;
}

/**
 * Diff de dois objetos, campo a campo: devolve só o que MUDOU, em `antes` e
 * `depois`. Guardar a linha inteira faria a trilha crescer sem informação e
 * esconderia a mudança real no meio de vinte campos iguais.
 *
 * Comparação por igualdade frouxa de valor serializado: `null`, `undefined` e
 * ausência são o mesmo "vazio" (o formulário manda null onde o banco tem
 * undefined), e número vindo do Postgres como string ("1500.00") não conta como
 * mudança em relação a 1500.
 */
export function diffCampos(
  antes: Record<string, unknown> | null | undefined,
  depois: Record<string, unknown> | null | undefined,
  /** Campos a ignorar (metadados que mudam em toda gravação). */
  ignorar: readonly string[] = ["updated_at", "updated_by", "created_at"],
): { antes: Record<string, unknown>; depois: Record<string, unknown>; mudou: boolean } {
  const a = antes ?? {};
  const d = depois ?? {};
  const ign = new Set(ignorar);
  const chaves = Array.from(new Set(Object.keys(a).concat(Object.keys(d))));

  const outAntes: Record<string, unknown> = {};
  const outDepois: Record<string, unknown> = {};
  for (const k of chaves) {
    if (ign.has(k)) continue;
    // Chave ausente no `depois` não é mudança: as gravações são parciais
    // (patch), e o que não veio simplesmente não foi tocado.
    if (!(k in d)) continue;
    if (mesmoValor(a[k], d[k])) continue;
    outAntes[k] = normalizar(a[k]);
    outDepois[k] = normalizar(d[k]);
  }
  const mudou = Object.keys(outDepois).length > 0;
  return { antes: outAntes, depois: outDepois, mudou };
}

function normalizar(v: unknown): unknown {
  if (v === undefined) return null;
  return v;
}

function mesmoValor(a: unknown, b: unknown): boolean {
  const va = vazio(a) ? null : a;
  const vb = vazio(b) ? null : b;
  if (va === null && vb === null) return true;
  if (va === null || vb === null) return false;
  if (typeof va === "object" || typeof vb === "object") {
    return JSON.stringify(va) === JSON.stringify(vb);
  }
  // Numérico: "1500.00" === 1500 (o Postgres devolve numeric como string).
  // Restrito a number/string de propósito — sem isso `Number([])` faria uma
  // lista vazia parecer igual a 0, e `Number(true)` igual a "1".
  const numerico = (v: unknown) => typeof v === "number" || typeof v === "string";
  if (numerico(va) && numerico(vb)) {
    const na = Number(va);
    const nb = Number(vb);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na === nb;
  }
  return String(va) === String(vb);
}

function vazio(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

/**
 * Item ATIVO (não cancelado pela diretoria).
 *
 * Filtro único, usado por todos os motores. Cancelar é marca, não exclusão:
 * sem este filtro num só lugar, o item cancelado volta a somar e o orçamento
 * fecha maior — sem erro nenhum, que é o pior tipo de defeito.
 */
export function itemAtivo(row: { cancelado_em?: string | null } | null | undefined): boolean {
  return !row?.cancelado_em;
}
