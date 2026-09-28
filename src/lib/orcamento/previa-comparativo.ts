// =============================================================================
// A Prévia lado a lado: orçado × aprovado, com diferença e percentual.
//
// Regras puras, porque as três telas que as usam (a tabela, o drilldown e o
// Excel) precisam dar o MESMO número — e porque "quanto por cento de 0" é uma
// daquelas contas que cada lugar resolve de um jeito e ninguém percebe até o
// relatório sair com "Infinity%".
// =============================================================================

/** Uma célula da comparação: o par e o que ele significa. */
export interface Comparacao {
  orcado: number;
  aprovado: number;
  /** aprovado − orçado. NEGATIVO quando ainda falta aprovar. */
  diferenca: number;
  /**
   * Quanto do orçado já foi aprovado, em %. `null` quando não há base de
   * comparação (orçado zero) — e `null` é diferente de 0: um é "não dá para
   * dizer", o outro é "nada aprovado". A tela mostra "—" no primeiro.
   */
  percentual: number | null;
}

export function comparar(orcado: number, aprovado: number): Comparacao {
  return {
    orcado,
    aprovado,
    diferenca: aprovado - orcado,
    // Orçado zero com aprovado zero é o caso comum (linha vazia): dizer 0%
    // sugeriria que algo foi reprovado. Orçado zero com aprovado diferente de
    // zero não deveria existir, e se existir a porcentagem também não ajuda.
    percentual: orcado === 0 ? null : (aprovado / orcado) * 100,
  };
}

/** A comparação de uma linha inteira, mês a mês mais o ano. */
export function compararSeries(
  orcado: readonly number[],
  aprovado: readonly number[],
): { meses: Comparacao[]; ano: Comparacao } {
  const meses = Array.from({ length: 12 }, (_, m) =>
    comparar(orcado[m] ?? 0, aprovado[m] ?? 0),
  );
  const soma = (xs: readonly number[]) => xs.reduce((a, b) => a + (b ?? 0), 0);
  return { meses, ano: comparar(soma(orcado), soma(aprovado)) };
}

// ─── Abrir e fechar linhas (como na DRE) ─────────────────────────────────────

/** O mínimo que a regra de visibilidade precisa saber de cada linha. */
export interface LinhaArvore {
  id: string;
  code: string;
  level: number;
  hasChildren: boolean;
}

/**
 * A linha aparece, dado o conjunto de linhas FECHADAS?
 *
 * Some quando qualquer ANCESTRAL está fechado — não só o pai direto. A árvore
 * chega achatada e ordenada por código, então o ancestral é o último código
 * que prefixa o desta linha; fechar "7" tem de esconder "7.2.1" e não apenas
 * "7.2". Trabalhar por `level` sozinho erraria: dois ramos distintos podem ter
 * o mesmo nível.
 */
export function linhasVisiveis<T extends LinhaArvore>(
  linhas: readonly T[],
  fechadas: ReadonlySet<string>,
): T[] {
  if (fechadas.size === 0) return [...linhas];
  // Códigos fechados, para testar por prefixo. `${code}.` evita que "7" esconda
  // "70" — que é outra conta, não uma filha.
  const prefixos: string[] = [];
  linhas.forEach((l) => {
    if (fechadas.has(l.id)) prefixos.push(`${l.code}.`);
  });
  return linhas.filter((l) => {
    if (fechadas.has(l.id)) return true; // a própria fechada continua visível
    return !prefixos.some((p) => l.code.startsWith(p));
  });
}

/** Alterna uma linha no conjunto das fechadas. */
export function alternarFechada(
  fechadas: ReadonlySet<string>,
  id: string,
): Set<string> {
  const proxima = new Set(fechadas);
  if (proxima.has(id)) proxima.delete(id);
  else proxima.add(id);
  return proxima;
}

/** Todas as linhas que têm filhos — o "fechar tudo". */
export function todasFechaveis<T extends LinhaArvore>(linhas: readonly T[]): Set<string> {
  return new Set(linhas.filter((l) => l.hasChildren).map((l) => l.id));
}
