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

// ── Estado serializável da tabela ──────────────────────────────────────────
// É o que se guarda para lembrar os filtros de alguém (JSON no banco). A
// convenção do Set vale aqui: chave ausente = sem filtro; array vazio = nada
// passa. Ordenação e faixas numéricas vão junto — "o último filtro" inclui
// como a pessoa deixou a tabela ordenada.

export interface FilterTableSnapshot {
  values: Record<string, string[]>;
  ranges: Record<string, { min: string; max: string }>;
  sortKey: string | null;
  sortDir: "asc" | "desc";
}

export const EMPTY_SNAPSHOT: FilterTableSnapshot = {
  values: {},
  ranges: {},
  sortKey: null,
  sortDir: "asc",
};

/**
 * Valida um JSON vindo de fora (banco, request) e devolve um snapshot são.
 * Qualquer coisa fora do formato é descartada campo a campo — um valor
 * corrompido não pode derrubar a tela nem travar a pessoa num filtro que ela
 * não consegue tirar.
 */
export function parseSnapshot(raw: unknown): FilterTableSnapshot {
  if (!raw || typeof raw !== "object") return EMPTY_SNAPSHOT;
  const r = raw as Record<string, unknown>;

  const values: Record<string, string[]> = {};
  if (r.values && typeof r.values === "object") {
    for (const [key, list] of Object.entries(r.values as Record<string, unknown>)) {
      if (Array.isArray(list) && list.every((v) => typeof v === "string")) {
        values[key] = list as string[];
      }
    }
  }

  const ranges: Record<string, { min: string; max: string }> = {};
  if (r.ranges && typeof r.ranges === "object") {
    for (const [key, range] of Object.entries(r.ranges as Record<string, unknown>)) {
      if (range && typeof range === "object") {
        const { min, max } = range as Record<string, unknown>;
        const m = typeof min === "string" ? min : "";
        const x = typeof max === "string" ? max : "";
        if (m || x) ranges[key] = { min: m, max: x };
      }
    }
  }

  return {
    values,
    ranges,
    sortKey: typeof r.sortKey === "string" && r.sortKey ? r.sortKey : null,
    sortDir: r.sortDir === "desc" ? "desc" : "asc",
  };
}

/** Igualdade estrutural, para não salvar o que não mudou. */
export function snapshotsEqual(a: FilterTableSnapshot, b: FilterTableSnapshot): boolean {
  return stableJson(a) === stableJson(b);
}

/** JSON com chaves ordenadas e listas de valores ordenadas: mesma escolha, mesma string. */
export function stableJson(s: FilterTableSnapshot): string {
  const values: Record<string, string[]> = {};
  for (const k of Object.keys(s.values).sort()) values[k] = s.values[k].slice().sort();
  const ranges: Record<string, { min: string; max: string }> = {};
  for (const k of Object.keys(s.ranges).sort()) ranges[k] = s.ranges[k];
  return JSON.stringify({ values, ranges, sortKey: s.sortKey, sortDir: s.sortDir });
}
