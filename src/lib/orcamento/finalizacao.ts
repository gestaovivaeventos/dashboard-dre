import type { OrcamentoMetodo } from "@/lib/orcamento/metodos";

// =============================================================================
// Finalizar Orçamento — a identidade da FATIA que o administrador fecha.
//
// A unidade é (método × categoria × setor), decidida em 30/09/2026. Um clique:
//   1. TRAVA aquela fatia para todo mundo, inclusive para o próprio admin —
//      reabrir é o único caminho de volta, e é dele também;
//   2. publica no Budget do Financeiro só o que a diretoria APROVOU.
//
// Módulo PURO: a mesma chave é montada no servidor (que grava e publica) e na
// tela (que decide se mostra "Finalizar" ou "Reabrir"). Divergir aqui daria
// tela dizendo "aberto" sobre fatia travada — e o usuário levaria a recusa só
// ao tentar salvar.
// =============================================================================

export const METODOS_FINALIZAVEIS: readonly OrcamentoMetodo[] = [
  "pessoal",
  "media",
  "valor_fixo",
  "planejamento_socios",
] as const;

export function isMetodoFinalizavel(v: unknown): v is OrcamentoMetodo {
  return typeof v === "string" && (METODOS_FINALIZAVEIS as readonly string[]).includes(v);
}

/**
 * No PESSOAL a fatia é o quadro do setor inteiro, não uma categoria.
 *
 * O motor da folha é linear por colaborador e o mesmo colaborador aparece em
 * Salários, Encargos e Benefícios — fechar "Salários" sozinho publicaria
 * pedaço de gente, e foi por isso que a validação também decide a pessoa
 * inteira. Por isso `category_code` vai vazio no pessoal.
 */
export const CATEGORIA_METODO_INTEIRO = "";

export interface AlvoFinalizacao {
  metodo: OrcamentoMetodo;
  /** Código da categoria da Omie; vazio no pessoal (ver acima). */
  categoryCode: string;
  /** Setor da fatia. `null` é valor legítimo: empresa que não orça por setor. */
  setorId: string | null;
}

/** O setor nulo precisa de um lugar na chave — o mesmo sentinela do índice. */
const SEM_SETOR = "00000000-0000-0000-0000-000000000000";

/** Chave de comparação em memória (Set/Map), não vai para o banco. */
export function chaveFinalizacao(alvo: AlvoFinalizacao): string {
  return [alvo.metodo, alvo.categoryCode, alvo.setorId ?? SEM_SETOR].join("|");
}

/**
 * A `source` da fatia em `budget_uploads_raw` e em `orcamento_budget_detalhe`.
 *
 * Determinística de propósito — e não o id da finalização —, por três motivos
 * que se somam: refinalizar sobrescreve a própria fatia sem consultar nada;
 * reabrir é um DELETE por source; e duas fatias que caiam na MESMA conta da
 * DRE não colidem no índice único de `budget_uploads_raw`
 * (company_id, year, month, label, source), que é exatamente o caso de duas
 * categorias mapeadas para a mesma linha.
 *
 * O `reprocess.ts` do Financeiro SOMA todas as sources, então cada finalização
 * "vai preenchendo" o Budget sem apagar as anteriores — que é o comportamento
 * pedido, e o oposto do publicador antigo (ele apagava tudo e republicava).
 */
export function sourceFinalizacao(alvo: AlvoFinalizacao): string {
  return `orc:${alvo.metodo}:${alvo.categoryCode || "-"}:${alvo.setorId ?? "-"}`;
}

/** Toda source gerada aqui — usada para varrer o que é do módulo. */
export const PREFIXO_SOURCE_FINALIZACAO = "orc:";

/** Linha de finalização como a tela e o servidor a enxergam. */
export interface Finalizacao extends AlvoFinalizacao {
  id: string;
  totalPublicado: number;
  itensPublicados: number;
  /** Quantos itens NÃO entraram (reprovados/pendentes) no momento do fecho. */
  itensFora: number;
  finalizadoEm: string;
}

/** Índice por chave, para a tela perguntar "esta fatia está fechada?". */
export function indexarFinalizacoes(
  linhas: readonly Finalizacao[] | null | undefined,
): Map<string, Finalizacao> {
  const m = new Map<string, Finalizacao>();
  for (const f of linhas ?? []) m.set(chaveFinalizacao(f), f);
  return m;
}

export function finalizacaoDe(
  indice: Map<string, Finalizacao>,
  alvo: AlvoFinalizacao,
): Finalizacao | null {
  return indice.get(chaveFinalizacao(alvo)) ?? null;
}

export const TRAVA_FINALIZADO =
  "Este orçamento foi finalizado e está fechado para edição. Um administrador precisa reabri-lo.";

/**
 * A fatia está fechada para ESTA escrita?
 *
 * Devolve a mensagem de recusa ou `null`. **Ninguém passa por cima, nem o
 * admin** — foi o pedido explícito: quem quer editar reabre primeiro, e aí o
 * fecho fica visível na tela em vez de ser contornado em silêncio. É a
 * diferença para `travaDaValidacao`, onde diretoria e admin sempre passam.
 *
 * Tabela ausente (migration pendente) não trava nada: quem chama passa um
 * índice vazio, e a mesma tolerância da validação vale aqui — o módulo não
 * pode parar de aceitar escrita por causa de um recurso acessório.
 */
export function travaDaFinalizacao(
  indice: Map<string, Finalizacao>,
  alvo: AlvoFinalizacao,
): string | null {
  return indice.has(chaveFinalizacao(alvo)) ? TRAVA_FINALIZADO : null;
}

/**
 * Resumo para o hub: quantas fatias de cada método estão fechadas.
 *
 * Só conta o que existe — a tela não sabe quantas fatias "caberiam" sem
 * recalcular a prévia, e um "3 de ?" não ajudaria ninguém.
 */
export function contarFinalizadasPorMetodo(
  linhas: readonly Finalizacao[] | null | undefined,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of linhas ?? []) out[f.metodo] = (out[f.metodo] ?? 0) + 1;
  return out;
}
