"use client";

// Tabela com filtro por coluna no estilo do Excel: clicar no funil abre uma
// lista de valores com busca e caixas de seleção, e os filtros se combinam.
//
// Duas decisões dão a sensação de "é o Excel mesmo":
//
//  1. A lista de valores de uma coluna é calculada sobre as linhas que passam
//     por TODAS AS OUTRAS colunas. Filtrou Tipo = "Conta corrente"? O popover
//     de Empresa passa a oferecer só as empresas que têm conta corrente. Sem
//     isso o usuário escolhe um valor e a tabela fica vazia, que é o jeito
//     errado de descobrir que a combinação não existe.
//  2. O "Selecionar tudo" da seleção de linhas marca o que está FILTRADO, com
//     estado indeterminado — nunca linhas escondidas. Somar uma linha que não
//     está na tela seria um erro silencioso no card de total.
//
// Genérico de propósito: a primeira tela é o Caixa Real, mas nada aqui conhece
// saldo ou empresa.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, Check, Filter, Search, X } from "lucide-react";

export interface FilterColumn<T> {
  key: string;
  label: string;
  /** Texto usado no filtro, na lista de valores e no export. */
  plain: (row: T) => string;
  /** Valor de ordenação. Número ordena como número. */
  sortVal: (row: T) => string | number;
  /** Render da célula. Sem isto, mostra `plain`. */
  cell?: (row: T) => ReactNode;
  /** Valor numérico para o export em XLSX (vira número, não texto). */
  numeric?: (row: T) => number | null;
  /** "values" (lista de checkboxes, padrão) ou "number" (faixa mín/máx). */
  kind?: "values" | "number";
  align?: "left" | "right";
  /** Classe extra no <th>/<td> (largura, whitespace…). */
  className?: string;
}

type ValueFilters = Record<string, Set<string>>;
type RangeFilters = Record<string, { min: string; max: string }>;

export interface FilterTableState {
  values: ValueFilters;
  ranges: RangeFilters;
}

interface Props<T> {
  rows: T[];
  columns: FilterColumn<T>[];
  rowKey: (row: T) => string;
  /** Liga a coluna de seleção. */
  selectable?: boolean;
  selected?: Set<string>;
  onSelectedChange?: (next: Set<string>) => void;
  /** Recebe as linhas filtradas+ordenadas a cada mudança (para cards e export). */
  onVisibleChange?: (rows: T[]) => void;
  /** Linha fixa no rodapé (totais). Recebe as linhas visíveis. */
  footer?: (visible: T[]) => ReactNode;
  emptyMessage?: string;
  /** Destaca a linha (ex.: saldo desatualizado). */
  rowClassName?: (row: T) => string | undefined;
  /**
   * Filtro já aplicado ao abrir, por chave de coluna → valores aceitos.
   * Aparece como chip e sai em um clique, como qualquer outro — a tela nunca
   * esconde linhas sem dizer. Lido só na montagem.
   */
  initialValues?: Record<string, string[]>;
}

// Aceita "1.234,56", "1234,56", "1234.56", "250".
function parseNum(raw: string): number | null {
  const t = (raw ?? "").trim();
  if (!t) return null;
  const body = t.replace(/[R$\s]/g, "");
  const n = body.includes(",")
    ? Number(body.replace(/\./g, "").replace(",", "."))
    : Number(body);
  return Number.isFinite(n) ? n : null;
}

export function FilterTable<T>({
  rows,
  columns,
  rowKey,
  selectable = false,
  selected,
  onSelectedChange,
  onVisibleChange,
  footer,
  emptyMessage = "Nenhum resultado.",
  rowClassName,
  initialValues,
}: Props<T>) {
  const [values, setValues] = useState<ValueFilters>(() => {
    const initial: ValueFilters = {};
    for (const [key, list] of Object.entries(initialValues ?? {})) {
      if (list.length > 0) initial[key] = new Set(list);
    }
    return initial;
  });
  const [ranges, setRanges] = useState<RangeFilters>({});
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [openKey, setOpenKey] = useState<string | null>(null);

  const colByKey = useMemo(
    () => new Map(columns.map((c) => [c.key, c])),
    [columns],
  );

  /** A linha passa no filtro de UMA coluna? */
  const passesColumn = useCallback(
    (row: T, col: FilterColumn<T>): boolean => {
      if (col.kind === "number") {
        const range = ranges[col.key];
        if (!range || (!range.min && !range.max)) return true;
        const value = col.numeric?.(row) ?? null;
        if (value === null) return false;
        const min = parseNum(range.min);
        const max = parseNum(range.max);
        if (min !== null && value < min) return false;
        if (max !== null && value > max) return false;
        return true;
      }
      const set = values[col.key];
      if (!set || set.size === 0) return true;
      return set.has(col.plain(row));
    },
    [values, ranges],
  );

  /** Linhas que passam em todas as colunas, exceto (opcionalmente) uma. */
  const rowsPassingExcept = useCallback(
    (exceptKey: string | null): T[] =>
      rows.filter((row) =>
        columns.every((col) => (col.key === exceptKey ? true : passesColumn(row, col))),
      ),
    [rows, columns, passesColumn],
  );

  const filtered = useMemo(() => rowsPassingExcept(null), [rowsPassingExcept]);

  const visible = useMemo(() => {
    if (!sortKey) return filtered;
    const col = colByKey.get(sortKey);
    if (!col) return filtered;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const va = col.sortVal(a);
      const vb = col.sortVal(b);
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb), "pt-BR", { numeric: true }) * dir;
    });
  }, [filtered, sortKey, sortDir, colByKey]);

  useEffect(() => {
    onVisibleChange?.(visible);
  }, [visible, onVisibleChange]);

  const activeChips = useMemo(() => {
    const chips: Array<{ key: string; label: string; detail: string }> = [];
    for (const col of columns) {
      if (col.kind === "number") {
        const r = ranges[col.key];
        if (r && (r.min || r.max)) {
          const detail = r.min && r.max ? `${r.min} a ${r.max}` : r.min ? `≥ ${r.min}` : `≤ ${r.max}`;
          chips.push({ key: col.key, label: col.label, detail });
        }
        continue;
      }
      const set = values[col.key];
      if (set && set.size > 0) {
        chips.push({
          key: col.key,
          label: col.label,
          detail: set.size === 1 ? Array.from(set)[0] : `${set.size} selecionados`,
        });
      }
    }
    return chips;
  }, [columns, values, ranges]);

  function clearColumn(key: string) {
    setValues((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setRanges((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function clearAll() {
    setValues({});
    setRanges({});
  }

  function toggleSort(key: string) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  // ── Seleção ──────────────────────────────────────────────────────────────
  const selectedSet = selected ?? new Set<string>();
  const visibleKeys = useMemo(() => visible.map(rowKey), [visible, rowKey]);
  const selectedVisible = visibleKeys.filter((k) => selectedSet.has(k)).length;
  const allVisibleSelected = visibleKeys.length > 0 && selectedVisible === visibleKeys.length;
  const someVisibleSelected = selectedVisible > 0 && !allVisibleSelected;

  function toggleAllVisible() {
    const next = new Set(selectedSet);
    if (allVisibleSelected) visibleKeys.forEach((k) => next.delete(k));
    else visibleKeys.forEach((k) => next.add(k));
    onSelectedChange?.(next);
  }

  function toggleRow(key: string) {
    const next = new Set(selectedSet);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onSelectedChange?.(next);
  }

  const colSpan = columns.length + (selectable ? 1 : 0);

  return (
    <div className="space-y-2">
      {activeChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {activeChips.map((chip) => (
            <span
              key={chip.key}
              className="inline-flex items-center gap-1 rounded-full border border-viva-200 bg-viva-50 px-2.5 py-1 text-xs font-medium text-viva-700"
            >
              {chip.label}: {chip.detail}
              <button
                type="button"
                onClick={() => clearColumn(chip.key)}
                className="rounded-full p-0.5 hover:bg-viva-100"
                aria-label={`Remover filtro ${chip.label}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={clearAll}
            className="ml-1 text-xs text-ink-muted underline-offset-2 hover:text-ink-primary hover:underline"
          >
            Limpar tudo
          </button>
        </div>
      )}

      <div className="overflow-x-auto rounded-viva-lg border border-border bg-surface-1">
        <table className="w-full min-w-[820px] border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-surface-2">
            <tr>
              {selectable && (
                <th className="w-10 border-b border-border px-3 py-2.5">
                  <CheckBox
                    checked={allVisibleSelected}
                    indeterminate={someVisibleSelected}
                    onChange={toggleAllVisible}
                    label="Selecionar todas as linhas filtradas"
                  />
                </th>
              )}
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`border-b border-border px-3 py-2.5 text-[11px] font-semibold uppercase tracking-label text-ink-muted ${
                    col.align === "right" ? "text-right" : "text-left"
                  } ${col.className ?? ""}`}
                >
                  <HeaderCell
                    column={col}
                    sorted={sortKey === col.key ? sortDir : null}
                    active={
                      col.kind === "number"
                        ? Boolean(ranges[col.key]?.min || ranges[col.key]?.max)
                        : (values[col.key]?.size ?? 0) > 0
                    }
                    open={openKey === col.key}
                    onToggleOpen={() => setOpenKey((k) => (k === col.key ? null : col.key))}
                    onClose={() => setOpenKey(null)}
                    onSort={(dir) => {
                      setSortKey(col.key);
                      setSortDir(dir);
                    }}
                    onHeaderClick={() => toggleSort(col.key)}
                    options={
                      col.kind === "number"
                        ? []
                        : distinctValues(rowsPassingExcept(col.key), col, values[col.key])
                    }
                    selectedValues={values[col.key] ?? new Set()}
                    onValuesChange={(next) =>
                      setValues((prev) => {
                        const copy = { ...prev };
                        if (next.size === 0) delete copy[col.key];
                        else copy[col.key] = next;
                        return copy;
                      })
                    }
                    range={ranges[col.key] ?? { min: "", max: "" }}
                    onRangeChange={(next) =>
                      setRanges((prev) => ({ ...prev, [col.key]: next }))
                    }
                    onClear={() => clearColumn(col.key)}
                  />
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={colSpan} className="px-3 py-10 text-center text-sm text-ink-muted">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              visible.map((row) => {
                const key = rowKey(row);
                const isSelected = selectedSet.has(key);
                return (
                  <tr
                    key={key}
                    onClick={selectable ? () => toggleRow(key) : undefined}
                    className={`border-b border-border/60 transition-colors last:border-0 ${
                      isSelected ? "bg-viva-50/60" : "hover:bg-surface-2/60"
                    } ${selectable ? "cursor-pointer" : ""} ${rowClassName?.(row) ?? ""}`}
                  >
                    {selectable && (
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <CheckBox
                          checked={isSelected}
                          onChange={() => toggleRow(key)}
                          label="Selecionar conta"
                        />
                      </td>
                    )}
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={`px-3 py-2 ${
                          col.align === "right" ? "text-right tabular-nums" : "text-left"
                        } ${col.className ?? ""}`}
                      >
                        {col.cell ? col.cell(row) : col.plain(row)}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>

          {footer && visible.length > 0 && (
            <tfoot className="sticky bottom-0 bg-surface-2">
              <tr className="border-t-2 border-border">{footer(visible)}</tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

/**
 * Valores distintos da coluna nas linhas informadas, em ordem pt-BR.
 * Os já selecionados entram mesmo que não apareçam mais — senão o usuário
 * não conseguiria DESmarcar o valor que esvaziou a tabela.
 */
function distinctValues<T>(
  rows: T[],
  col: FilterColumn<T>,
  selected: Set<string> | undefined,
): string[] {
  const set = new Set<string>();
  for (const row of rows) set.add(col.plain(row));
  selected?.forEach((v) => set.add(v));
  return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));
}

// ── Cabeçalho de coluna ────────────────────────────────────────────────────

interface HeaderCellProps {
  column: { key: string; label: string; kind?: "values" | "number"; align?: "left" | "right" };
  sorted: "asc" | "desc" | null;
  active: boolean;
  open: boolean;
  onToggleOpen: () => void;
  onClose: () => void;
  onSort: (dir: "asc" | "desc") => void;
  onHeaderClick: () => void;
  options: string[];
  selectedValues: Set<string>;
  onValuesChange: (next: Set<string>) => void;
  range: { min: string; max: string };
  onRangeChange: (next: { min: string; max: string }) => void;
  onClear: () => void;
}

function HeaderCell({
  column,
  sorted,
  active,
  open,
  onToggleOpen,
  onClose,
  onSort,
  onHeaderClick,
  options,
  selectedValues,
  onValuesChange,
  range,
  onRangeChange,
  onClear,
}: HeaderCellProps) {
  const anchorRef = useRef<HTMLButtonElement>(null);

  return (
    <div
      className={`flex items-center gap-1 ${
        column.align === "right" ? "justify-end" : "justify-start"
      }`}
    >
      <button
        type="button"
        onClick={onHeaderClick}
        className="inline-flex items-center gap-1 rounded-viva-sm px-0.5 py-0.5 uppercase tracking-label hover:text-ink-primary"
        title="Ordenar por esta coluna"
      >
        {column.label}
        {sorted === "asc" && <ArrowUp className="h-3 w-3" />}
        {sorted === "desc" && <ArrowDown className="h-3 w-3" />}
      </button>
      <button
        ref={anchorRef}
        type="button"
        onClick={onToggleOpen}
        aria-label={`Filtrar ${column.label}`}
        className={`rounded-viva-sm p-1 transition-colors ${
          active
            ? "bg-viva-100 text-viva-700"
            : "text-ink-disabled hover:bg-surface-3 hover:text-ink-secondary"
        }`}
      >
        <Filter className={`h-3 w-3 ${active ? "fill-current" : ""}`} />
      </button>

      {open && (
        <FilterPopover
          anchorRef={anchorRef}
          onClose={onClose}
          isNumber={column.kind === "number"}
          options={options}
          selectedValues={selectedValues}
          onValuesChange={onValuesChange}
          range={range}
          onRangeChange={onRangeChange}
          onSort={onSort}
          onClear={onClear}
        />
      )}
    </div>
  );
}

// ── Popover ────────────────────────────────────────────────────────────────

interface PopoverProps {
  anchorRef: React.RefObject<HTMLElement>;
  onClose: () => void;
  isNumber: boolean;
  options: string[];
  selectedValues: Set<string>;
  onValuesChange: (next: Set<string>) => void;
  range: { min: string; max: string };
  onRangeChange: (next: { min: string; max: string }) => void;
  onSort: (dir: "asc" | "desc") => void;
  onClear: () => void;
}

/**
 * Renderizado em portal com posição fixa: o contêiner da tabela precisa de
 * `overflow-x-auto` para rolar na horizontal, e qualquer popover posicionado
 * dentro dele seria cortado.
 */
function FilterPopover({
  anchorRef,
  onClose,
  isNumber,
  options,
  selectedValues,
  onValuesChange,
  range,
  onRangeChange,
  onSort,
  onClear,
}: PopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [search, setSearch] = useState("");

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const width = 260;
    // Não deixa escapar pela direita da janela.
    const left = Math.min(rect.left, window.innerWidth - width - 12);
    setPos({ top: rect.bottom + 6, left: Math.max(12, left) });
  }, [anchorRef]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [anchorRef, onClose]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [options, search]);

  // "Selecionar tudo" opera sobre o que a busca está mostrando — é o que o
  // Excel faz, e é o que torna "buscar + marcar tudo" um gesto só.
  const allShownSelected =
    shown.length > 0 && shown.every((o) => selectedValues.size === 0 || selectedValues.has(o));

  function toggleAllShown() {
    const next = new Set(selectedValues);
    if (selectedValues.size === 0) {
      // Nada marcado = "todos". Marcar tudo explicitamente não muda nada, mas
      // desmarcar precisa partir do conjunto completo.
      options.forEach((o) => next.add(o));
      shown.forEach((o) => next.delete(o));
    } else if (allShownSelected) {
      shown.forEach((o) => next.delete(o));
    } else {
      shown.forEach((o) => next.add(o));
    }
    onValuesChange(next);
  }

  if (!pos) return null;

  return createPortal(
    <div
      ref={panelRef}
      style={{ top: pos.top, left: pos.left, width: 260 }}
      className="fixed z-50 overflow-hidden rounded-viva-lg border border-border bg-surface-1 shadow-viva-lg"
    >
      <div className="flex items-center gap-1 border-b border-border p-1.5">
        <button
          type="button"
          onClick={() => onSort("asc")}
          className="flex flex-1 items-center justify-center gap-1 rounded-viva-sm px-2 py-1.5 text-xs text-ink-secondary hover:bg-surface-2"
        >
          <ArrowUp className="h-3 w-3" /> Crescente
        </button>
        <button
          type="button"
          onClick={() => onSort("desc")}
          className="flex flex-1 items-center justify-center gap-1 rounded-viva-sm px-2 py-1.5 text-xs text-ink-secondary hover:bg-surface-2"
        >
          <ArrowDown className="h-3 w-3" /> Decrescente
        </button>
      </div>

      {isNumber ? (
        <div className="space-y-2 p-3">
          <label className="block text-[11px] uppercase tracking-label text-ink-muted">
            Valor mínimo
            <input
              value={range.min}
              onChange={(e) => onRangeChange({ ...range, min: e.target.value })}
              inputMode="decimal"
              placeholder="0,00"
              className="mt-1 w-full rounded-viva-sm border border-border bg-surface-0 px-2 py-1.5 text-sm text-ink-primary outline-none focus:ring-2 focus:ring-viva-200"
            />
          </label>
          <label className="block text-[11px] uppercase tracking-label text-ink-muted">
            Valor máximo
            <input
              value={range.max}
              onChange={(e) => onRangeChange({ ...range, max: e.target.value })}
              inputMode="decimal"
              placeholder="0,00"
              className="mt-1 w-full rounded-viva-sm border border-border bg-surface-0 px-2 py-1.5 text-sm text-ink-primary outline-none focus:ring-2 focus:ring-viva-200"
            />
          </label>
        </div>
      ) : (
        <>
          <div className="relative border-b border-border p-1.5">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-disabled" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar…"
              className="w-full rounded-viva-sm border border-border bg-surface-0 py-1.5 pl-8 pr-2 text-sm text-ink-primary outline-none focus:ring-2 focus:ring-viva-200"
            />
          </div>

          <div className="max-h-56 overflow-y-auto py-1">
            {shown.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-ink-muted">Nenhum valor.</p>
            ) : (
              <>
                <button
                  type="button"
                  onClick={toggleAllShown}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm font-medium text-ink-primary hover:bg-surface-2"
                >
                  <CheckBox
                    checked={selectedValues.size === 0 || allShownSelected}
                    readOnlyBox
                    label=""
                  />
                  (Selecionar tudo)
                </button>
                {shown.map((option) => {
                  // Nenhum valor marcado significa "sem filtro" = todos marcados.
                  const checked = selectedValues.size === 0 || selectedValues.has(option);
                  return (
                    <button
                      key={option}
                      type="button"
                      onClick={() => {
                        const next =
                          selectedValues.size === 0 ? new Set(options) : new Set(selectedValues);
                        if (next.has(option)) next.delete(option);
                        else next.add(option);
                        // Tudo marcado = sem filtro; guarda vazio para o chip sumir.
                        onValuesChange(next.size === options.length ? new Set() : next);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-ink-secondary hover:bg-surface-2"
                    >
                      <CheckBox checked={checked} readOnlyBox label="" />
                      <span className="truncate">{option || "(vazio)"}</span>
                    </button>
                  );
                })}
              </>
            )}
          </div>
        </>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-border p-1.5">
        <button
          type="button"
          onClick={() => {
            onClear();
            setSearch("");
          }}
          className="rounded-viva-sm px-2 py-1.5 text-xs text-ink-muted hover:bg-surface-2 hover:text-ink-primary"
        >
          Limpar
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-viva-sm bg-viva-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-viva-600"
        >
          Concluir
        </button>
      </div>
    </div>,
    document.body,
  );
}

// ── Checkbox ───────────────────────────────────────────────────────────────

function CheckBox({
  checked,
  indeterminate = false,
  onChange,
  label,
  readOnlyBox = false,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange?: () => void;
  label: string;
  /** Só o desenho (o clique é tratado pelo botão que o contém). */
  readOnlyBox?: boolean;
}) {
  const box = (
    <span
      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] border transition-colors ${
        checked || indeterminate
          ? "border-viva-500 bg-viva-500 text-white"
          : "border-border bg-surface-0"
      }`}
    >
      {indeterminate ? (
        <span className="h-0.5 w-2 rounded-full bg-white" />
      ) : checked ? (
        <Check className="h-3 w-3" strokeWidth={3} />
      ) : null}
    </span>
  );

  if (readOnlyBox) return box;

  return (
    <button
      type="button"
      onClick={onChange}
      aria-label={label}
      aria-checked={indeterminate ? "mixed" : checked}
      role="checkbox"
      className="flex items-center"
    >
      {box}
    </button>
  );
}
