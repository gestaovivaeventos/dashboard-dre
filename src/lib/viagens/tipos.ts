// =============================================================================
// TIPO de viagem × categoria da DRE.
//
// Quem cadastra a viagem escolhe um TIPO ("Consultoria", "Treinamento"); o
// de-para tipo → categoria é cadastro do admin, por empresa × ano. A tela fala a
// língua de quem preenche, e o mapeamento para a DRE fica com quem responde pelo
// plano de contas — mesmo enquadramento de `budget_account_mappings`.
//
// A categoria é COPIADA para a viagem no momento da gravação (retrato), nunca
// resolvida na leitura. `desalinhadas()` é o que torna essa escolha honesta: ela
// conta as viagens que ficaram com o mapeamento antigo, para a tela de de-para
// dizer isso em vez de deixar a diferença invisível.
//
// Módulo PURO e testado.
// =============================================================================

import { viagensConflitaCom } from "@/lib/orcamento/metodos";

export interface TipoViagem {
  id: string;
  nome: string;
  /** Categoria da Omie. `null` = ainda não mapeado. */
  categoryCode: string | null;
  ativo: boolean;
}

/** Ordem alfabética pt-BR, a mesma convenção dos grupos de despesa. */
export function ordenarTipos<T extends { nome: string }>(tipos: readonly T[]): T[] {
  return [...tipos].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

/**
 * Os tipos que o cadastro da viagem pode oferecer.
 *
 * Tipo SEM categoria mapeada fica de fora, e isso é a regra principal daqui: uma
 * viagem com tipo não mapeado não entra em conta nenhuma da DRE — ela sairia da
 * Prévia como órfã, e o gestor não teria como saber por quê. Inativo também sai:
 * o admin desativa justamente para parar de oferecer.
 */
export function tiposOferecidos(tipos: readonly TipoViagem[]): TipoViagem[] {
  return ordenarTipos(tipos.filter((t) => t.ativo && !!t.categoryCode));
}

/** A categoria vigente de um tipo, ou `null` (tipo inexistente ou sem mapeamento). */
export function categoriaDoTipo(
  tipos: readonly TipoViagem[],
  tipoId: string | null | undefined,
): string | null {
  if (!tipoId) return null;
  return tipos.find((t) => t.id === tipoId)?.categoryCode ?? null;
}

/**
 * Tipos cadastrados e ainda SEM categoria — o aviso da tela de de-para.
 *
 * Existe porque o estado é legítimo (o admin cadastra o vocabulário do negócio e
 * mapeia depois) mas tem consequência: enquanto estiver assim, o tipo não aparece
 * para quem cadastra viagem. Sem o aviso, o admin concluiria que a tela quebrou.
 */
export function tiposSemCategoria(tipos: readonly TipoViagem[]): TipoViagem[] {
  return ordenarTipos(tipos.filter((t) => t.ativo && !t.categoryCode));
}

export interface ViagemComTipo {
  id: string;
  titulo: string;
  tipoId: string | null;
  /** A categoria em que a viagem FOI orçada (o retrato gravado). */
  categoryCode: string | null;
}

export interface Desalinhada {
  id: string;
  titulo: string;
  tipoNome: string;
  /** A categoria gravada na viagem. */
  categoriaDaViagem: string | null;
  /** A categoria que o de-para dá hoje. */
  categoriaDoTipo: string | null;
}

/**
 * Viagens cujo retrato de categoria não é mais o que o de-para diz.
 *
 * É o preço da categoria ser COPIADA, e o de-para precisa cobrá-lo à vista:
 * remapear um tipo não reclassifica o que já foi orçado (não pode — a `source` da
 * finalização inclui a categoria, e mexer nela deixaria a fatia já publicada
 * órfã no Budget, somando duas vezes em duas contas). Então a tela diz quantas
 * viagens ficaram atrás, e passar a usar o mapeamento novo é abrir cada uma e
 * salvar — ato explícito, igual ao recálculo depois de mudar um parâmetro.
 *
 * Viagem SEM categoria gravada (rascunho que nunca foi salvo com tipo) não conta:
 * ela não está desalinhada, está incompleta.
 */
export function desalinhadas(
  viagens: readonly ViagemComTipo[],
  tipos: readonly TipoViagem[],
): Desalinhada[] {
  const porId = new Map(tipos.map((t) => [t.id, t] as const));
  const out: Desalinhada[] = [];
  for (const v of viagens) {
    if (!v.tipoId || !v.categoryCode) continue;
    const tipo = porId.get(v.tipoId);
    // Tipo apagado do cadastro: a viagem conserva a categoria dela e não é
    // "desalinhada" — não há de-para novo com que comparar.
    if (!tipo || !tipo.categoryCode) continue;
    if (tipo.categoryCode === v.categoryCode) continue;
    out.push({
      id: v.id,
      titulo: v.titulo,
      tipoNome: tipo.nome,
      categoriaDaViagem: v.categoryCode,
      categoriaDoTipo: tipo.categoryCode,
    });
  }
  return out;
}

/** Categorias que o de-para alcança — as contas que vão receber viagem. */
export function categoriasDoDePara(tipos: readonly TipoViagem[]): string[] {
  const set = new Set<string>();
  for (const t of tipos) {
    if (t.ativo && t.categoryCode) set.add(t.categoryCode);
  }
  return Array.from(set).sort();
}

/**
 * Tipos apontando para categoria onde somar viagem DOBRARIA o dinheiro.
 *
 * Viagens é um método ADITIVO: ela soma na conta onde cai, por cima do que já
 * houver. Isso é seguro contra o Planejamento dos gestores (os dois enumeram
 * itens discretos, e o pedido de 01/10/2026 é justamente que somem), mas NÃO
 * contra média e valor fixo: aqueles afirmam ser o valor inteiro da categoria —
 * a média do realizado do ano anterior já contém a viagem daquele ano.
 *
 * A marcação de método em "Método por categoria" **não é mais exigida** para a
 * viagem entrar na Prévia (a categoria vem do retrato de cada viagem). O que
 * esta função procura é só o conflito que dobra.
 */
export function tiposQueDobram(
  tipos: readonly TipoViagem[],
  metodoPorCategoria: ReadonlyMap<string, string | null>,
): Array<{ tipo: TipoViagem; metodo: string }> {
  const out: Array<{ tipo: TipoViagem; metodo: string }> = [];
  for (const t of ordenarTipos(tipos)) {
    if (!t.ativo || !t.categoryCode) continue;
    const metodo = metodoPorCategoria.get(t.categoryCode) ?? null;
    if (metodo && viagensConflitaCom(metodo)) out.push({ tipo: t, metodo });
  }
  return out;
}
