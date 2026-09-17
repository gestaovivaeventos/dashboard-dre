// Semântica do filtro de valores da FilterTable, isolada e testável.
//
// A distinção que tudo depende:
//
//   ausente (null/undefined) → sem filtro, tudo passa
//   Set com itens            → só esses valores passam
//   Set VAZIO                → NADA passa
//
// Conflar "vazio" com "sem filtro" parece inofensivo e quebra o gesto mais
// comum do Excel: desmarcar "(Selecionar tudo)" para depois marcar dois
// valores. Com a conflação, o primeiro clique não faz nada visível.

/** A linha passa no filtro desta coluna? */
export function passesValueFilter(
  value: string,
  selected: Set<string> | null | undefined,
): boolean {
  if (selected == null) return true;
  return selected.has(value);
}

/**
 * Conjunto marcado hoje, materializado: sem filtro equivale a todos marcados,
 * que é de onde qualquer desmarcação precisa partir.
 */
export function materialize(
  selected: Set<string> | null | undefined,
  allOptions: readonly string[],
): Set<string> {
  return selected == null ? new Set(allOptions) : new Set(selected);
}

/**
 * Normaliza antes de guardar: marcou tudo de novo → volta a "sem filtro", para
 * o chip sumir em vez de anunciar um filtro que não filtra nada.
 */
export function normalize(
  next: Set<string>,
  allOptions: readonly string[],
): Set<string> | null {
  return next.size === allOptions.length ? null : next;
}

/** Marca/desmarca UM valor. */
export function toggleValue(
  selected: Set<string> | null | undefined,
  option: string,
  allOptions: readonly string[],
): Set<string> | null {
  const next = materialize(selected, allOptions);
  if (next.has(option)) next.delete(option);
  else next.add(option);
  return normalize(next, allOptions);
}

/**
 * "Marcar todos" / "Desmarcar todos" — operam sobre o que a BUSCA está
 * mostrando, não sobre todas as opções. É o que torna "buscar + marcar só
 * esses" um gesto único; sem busca, `shown` é a lista inteira e o efeito é
 * literalmente todos.
 */
export function setAllShown(
  selected: Set<string> | null | undefined,
  shown: readonly string[],
  allOptions: readonly string[],
  mark: boolean,
): Set<string> | null {
  const next = materialize(selected, allOptions);
  if (mark) shown.forEach((o) => next.add(o));
  else shown.forEach((o) => next.delete(o));
  return normalize(next, allOptions);
}

/** Todos os valores visíveis estão marcados? (estado dos botões) */
export function allShownSelected(
  selected: Set<string> | null | undefined,
  shown: readonly string[],
): boolean {
  if (shown.length === 0) return false;
  return shown.every((o) => passesValueFilter(o, selected));
}

/** Nenhum dos valores visíveis está marcado? */
export function noneShownSelected(
  selected: Set<string> | null | undefined,
  shown: readonly string[],
): boolean {
  if (shown.length === 0) return false;
  return shown.every((o) => !passesValueFilter(o, selected));
}
