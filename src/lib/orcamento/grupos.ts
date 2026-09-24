// =============================================================================
// Grupos de despesa — o subnível entre a CATEGORIA da DRE e a DESPESA.
//
// "Softwares, Sistemas e Servidores" (categoria) › "Design" (grupo) › "Figma"
// (despesa). O cadastro é do administrador, por EMPRESA e sem ano — a lista
// atravessa os exercícios.
//
// Não confundir com os "Tipos de despesa" do módulo Compras
// (`ctrl_expense_types`): são cadastros distintos, por decisão do dono do
// projeto em 23/09/2026. Se um dia forem unificados, é aqui que a ponte entra.
//
// Módulo PURO (sem "use server"): a ordenação vale na tela de montagem, na
// Prévia e no cadastro, e os três precisam concordar — um grupo que aparece em
// posição diferente em cada tela faz o gestor achar que são grupos diferentes.
// =============================================================================

/**
 * Balde das despesas ainda não classificadas. Não é um grupo cadastrado: é
 * dívida VISÍVEL, no mesmo espírito do setor "Não atribuído". Por isso vai
 * sempre por ÚLTIMO, e não na letra S — misturado à ordem alfabética ele
 * passaria por um grupo de verdade.
 */
export const SEM_GRUPO_LABEL = "Sem grupo";

/**
 * Comparação de nomes em pt-BR ignorando caixa e acento, para "Água" e "ar
 * condicionado" caírem onde o leitor espera. `localeCompare` cru ordenaria por
 * código de caractere e jogaria todo nome acentuado para o fim.
 */
export function compararNomes(a: string, b: string): number {
  return (a ?? "").localeCompare(b ?? "", "pt-BR", { sensitivity: "base" });
}

/** Item com grupo, do jeito que as telas leem. `grupoId` nulo = sem grupo. */
export interface ComGrupo {
  grupoId: string | null;
  grupoNome: string | null;
}

/** Um grupo já montado, com as despesas dele dentro. */
export interface GrupoAgrupado<T> {
  grupoId: string | null;
  /** Nome do grupo, ou SEM_GRUPO_LABEL quando `grupoId` é nulo. */
  nome: string;
  itens: T[];
}

/**
 * Agrupa despesas por grupo, em ordem alfabética, com "Sem grupo" no fim.
 *
 * Chaveia por `grupoId` e não pelo nome: dois grupos podem ser renomeados para
 * nomes parecidos, e o id é o que a despesa realmente aponta. O nome vem do
 * primeiro item que o traz — a leitura já faz o join.
 */
export function agruparPorGrupo<T extends ComGrupo>(itens: T[]): GrupoAgrupado<T>[] {
  const mapa = new Map<string, GrupoAgrupado<T>>();

  itens.forEach((item) => {
    const id = item.grupoId ?? null;
    const chave = id ?? "__sem_grupo__";
    let bucket = mapa.get(chave);
    if (!bucket) {
      bucket = {
        grupoId: id,
        nome: id ? (item.grupoNome ?? "").trim() || SEM_GRUPO_LABEL : SEM_GRUPO_LABEL,
        itens: [],
      };
      mapa.set(chave, bucket);
    }
    bucket.itens.push(item);
  });

  return Array.from(mapa.values()).sort((a, b) => {
    // O balde vai por último, sempre — mesmo que os dois lados sejam ele.
    if (a.grupoId === null && b.grupoId !== null) return 1;
    if (b.grupoId === null && a.grupoId !== null) return -1;
    return compararNomes(a.nome, b.nome);
  });
}

/**
 * Normaliza o nome digitado no cadastro. Espaço duplicado some e as pontas são
 * aparadas: sem isso, "Design " e "Design" passam pelo índice único (que
 * compara `lower(name)` byte a byte) e viram dois grupos indistinguíveis na
 * tela.
 */
export function normalizarNomeGrupo(nome: string): string {
  return (nome ?? "").replace(/\s+/g, " ").trim();
}

// ─── Escopo: onde cada grupo vale ────────────────────────────────────────────
// O grupo é um NOME por empresa; esta camada diz em quais (setor, categoria)
// ele é oferecido. Ver a migration 20260927120000 para o porquê de não ser uma
// coluna no próprio grupo — em resumo: o mesmo "Publicidade" precisa servir a
// vários setores sem virar vários ids, senão a Prévia mostra o subnível
// repetido em vez de compilar.

export interface EscopoGrupo {
  grupoId: string;
  /** Nulo = vale para a categoria em qualquer setor. */
  setorId: string | null;
  categoryCode: string;
}

/** Onde se quer saber quais grupos valem. */
export interface AlvoEscopo {
  categoryCode: string;
  /**
   * Setores em jogo. UM setor na tela de montagem; VÁRIOS quando se olha o
   * consolidado — e aí o resultado é a UNIÃO, que é o "compilar independente do
   * setor". `[null]` é a empresa que não orça por setor.
   */
  setorIds: (string | null)[];
}

/**
 * Filtra os grupos disponíveis num alvo.
 *
 * Grupo SEM NENHUM escopo vale em todo lugar. É o que torna a introdução do
 * escopo aditiva: o que já estava cadastrado continua aparecendo até alguém
 * restringi-lo de propósito.
 */
export function gruposDisponiveis<T extends { id: string }>(
  grupos: readonly T[],
  escopos: readonly EscopoGrupo[],
  alvo: AlvoEscopo,
): T[] {
  const porGrupo = new Map<string, EscopoGrupo[]>();
  escopos.forEach((e) => {
    const lista = porGrupo.get(e.grupoId) ?? [];
    lista.push(e);
    porGrupo.set(e.grupoId, lista);
  });

  const setores = new Set(alvo.setorIds);

  return grupos.filter((g) => {
    const meus = porGrupo.get(g.id);
    if (!meus || meus.length === 0) return true;
    return meus.some(
      (e) =>
        e.categoryCode === alvo.categoryCode &&
        // Escopo sem setor vale para todos; com setor, precisa estar em jogo.
        (e.setorId === null || setores.has(e.setorId)),
    );
  });
}

/** True quando o grupo está explicitamente preso a algum escopo. */
export function grupoTemEscopo(escopos: readonly EscopoGrupo[], grupoId: string): boolean {
  return escopos.some((e) => e.grupoId === grupoId);
}
