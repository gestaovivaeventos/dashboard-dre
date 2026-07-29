"use client";

// Cabeçalho de tabela estilo "filtro do Excel": cada coluna vira um botão que
// abre um menu com Ordenar (crescente/decrescente) + uma lista de valores com
// caixas de seleção (marca só o que quer ver), com busca. Reutilizável por
// qualquer tabela client-side.
//
// Uso:
//   const cols = [{ key: "status", type: "text", label: (r) => paidLabel(r) }, ...]
//   const { rows, headerProps, hasFilters, clearAll } = useExcelTable(baseRows, cols);
//   <th><ExcelHeaderCell label="Status" {...headerProps("status")} /></th>
//   {rows.map(...)}

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ListFilter, Search } from "lucide-react";

export type ColType = "text" | "number" | "date";

export interface ExcelColumn<T> {
  key: string;
  /** Valor bruto usado para ORDENAR (número, data ISO ou texto). */
  getValue: (row: T) => string | number | null | undefined;
  /** Rótulo exibido na lista de valores e usado para FILTRAR. Default: String(getValue). */
  label?: (row: T) => string;
  type?: ColType; // default "text"
}

interface SortState {
  key: string;
  dir: "asc" | "desc";
}

const EMPTY_LABEL = "(vazio)";

export function useExcelTable<T>(rows: T[], columns: ExcelColumn<T>[]) {
  const colMap = useMemo(() => {
    const m = new Map<string, ExcelColumn<T>>();
    for (const c of columns) m.set(c.key, c);
    return m;
    // colunas são estáticas por render; recalcula só se a referência mudar
  }, [columns]);

  const [sort, setSort] = useState<SortState | null>(null);
  // Conjunto de rótulos SELECIONADOS por coluna. Chave ausente = sem filtro.
  const [filters, setFilters] = useState<Record<string, Set<string>>>({});
  const [openKey, setOpenKey] = useState<string | null>(null);

  function labelOf(col: ExcelColumn<T>, row: T): string {
    if (col.label) return col.label(row) || EMPTY_LABEL;
    const v = col.getValue(row);
    return v === null || v === undefined || v === "" ? EMPTY_LABEL : String(v);
  }

  // Valores distintos por coluna (a partir das linhas recebidas).
  const distinctByCol = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const col of columns) {
      const set = new Set<string>();
      for (const r of rows) set.add(labelOf(col, r));
      out[col.key] = Array.from(set).sort((a, b) =>
        a.localeCompare(b, "pt-BR", { numeric: true, sensitivity: "base" }),
      );
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, columns]);

  const processed = useMemo(() => {
    let out = rows;

    // Filtros por coluna (chave presente = só os rótulos selecionados passam).
    for (const key of Object.keys(filters)) {
      const selected = filters[key];
      const col = colMap.get(key);
      if (!col || !selected) continue;
      out = out.filter((r) => selected.has(labelOf(col, r)));
    }

    // Ordenação (uma coluna por vez). Nulos/vazios vão para o fim.
    if (sort) {
      const col = colMap.get(sort.key);
      if (col) {
        const dir = sort.dir === "asc" ? 1 : -1;
        const type = col.type ?? "text";
        out = [...out].sort((a, b) => {
          const va = col.getValue(a);
          const vb = col.getValue(b);
          const na = va === null || va === undefined || va === "";
          const nb = vb === null || vb === undefined || vb === "";
          if (na && nb) return 0;
          if (na) return 1;
          if (nb) return -1;
          let cmp: number;
          if (type === "number") {
            cmp = Number(va) - Number(vb);
          } else if (type === "date") {
            cmp = new Date(String(va)).getTime() - new Date(String(vb)).getTime();
          } else {
            cmp = String(va).localeCompare(String(vb), "pt-BR", { numeric: true });
          }
          return cmp * dir;
        });
      }
    }

    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, filters, sort, colMap]);

  function applyFilter(key: string, selected: Set<string>) {
    const all = distinctByCol[key] ?? [];
    setFilters((f) => {
      const next = { ...f };
      // Tudo selecionado = sem filtro (remove a chave).
      if (selected.size >= all.length) delete next[key];
      else next[key] = selected;
      return next;
    });
    setOpenKey(null);
  }

  function clearFilter(key: string) {
    setFilters((f) => {
      const n = { ...f };
      delete n[key];
      return n;
    });
    setOpenKey(null);
  }

  function clearAll() {
    setFilters({});
    setSort(null);
    setOpenKey(null);
  }

  function headerProps(key: string) {
    return {
      colKey: key,
      type: (colMap.get(key)?.type ?? "text") as ColType,
      distinct: distinctByCol[key] ?? [],
      selected: filters[key] ?? null,
      sortDir: sort?.key === key ? sort.dir : null,
      open: openKey === key,
      onToggleOpen: () => setOpenKey((k) => (k === key ? null : key)),
      onClose: () => setOpenKey(null),
      onSort: (dir: "asc" | "desc") => {
        setSort({ key, dir });
        setOpenKey(null);
      },
      onApply: (selected: Set<string>) => applyFilter(key, selected),
      onClear: () => clearFilter(key),
    };
  }

  return {
    rows: processed,
    headerProps,
    hasFilters: Object.keys(filters).length > 0 || sort !== null,
    clearAll,
  };
}

// ── Célula de cabeçalho ────────────────────────────────────────────────────────

interface ExcelHeaderCellProps {
  label: string;
  colKey: string;
  type: ColType;
  distinct: string[];
  selected: Set<string> | null;
  sortDir: "asc" | "desc" | null;
  open: boolean;
  align?: "left" | "right" | "center";
  /** Lado em que o menu abre (evita estourar a borda direita). Default = align. */
  menuSide?: "left" | "right";
  onToggleOpen: () => void;
  onClose: () => void;
  onSort: (dir: "asc" | "desc") => void;
  onApply: (selected: Set<string>) => void;
  onClear: () => void;
}

const SORT_LABELS: Record<ColType, [string, string]> = {
  text: ["A → Z", "Z → A"],
  number: ["Menor → maior", "Maior → menor"],
  date: ["Mais antigo → recente", "Mais recente → antigo"],
};

export function ExcelHeaderCell({
  label,
  type,
  distinct,
  selected,
  sortDir,
  open,
  align = "left",
  menuSide,
  onToggleOpen,
  onClose,
  onSort,
  onApply,
  onClear,
}: ExcelHeaderCellProps) {
  const side = menuSide ?? (align === "right" ? "right" : "left");
  const [local, setLocal] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  // Ao abrir, inicializa as caixas: filtro atual (se houver) ou tudo marcado.
  useEffect(() => {
    if (open) {
      setLocal(selected ? new Set(selected) : new Set(distinct));
      setQ("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Fecha ao clicar fora.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, onClose]);

  const filterActive = selected != null;
  const [ascLabel, descLabel] = SORT_LABELS[type];

  const visible = q.trim()
    ? distinct.filter((d) => d.toLowerCase().includes(q.trim().toLowerCase()))
    : distinct;
  const allVisibleChecked = visible.length > 0 && visible.every((d) => local.has(d));

  const justify =
    align === "right" ? "justify-end" : align === "center" ? "justify-center" : "justify-start";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={onToggleOpen}
        className={`flex w-full items-center gap-1 ${justify} text-left font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground`}
      >
        <span className="truncate">{label}</span>
        {sortDir === "asc" && <ArrowUp className="h-3 w-3 shrink-0 text-foreground" />}
        {sortDir === "desc" && <ArrowDown className="h-3 w-3 shrink-0 text-foreground" />}
        <ListFilter
          className={`h-3.5 w-3.5 shrink-0 ${
            filterActive ? "text-violet-600 dark:text-violet-400" : "text-muted-foreground/40"
          }`}
        />
      </button>

      {open && (
        <div
          className={`absolute z-40 mt-1 w-60 rounded-md border bg-background p-2 text-xs font-normal normal-case tracking-normal text-foreground shadow-lg ${
            side === "right" ? "right-0" : "left-0"
          }`}
        >
          {/* Ordenar */}
          <button
            type="button"
            onClick={() => onSort("asc")}
            className={`flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-muted ${
              sortDir === "asc" ? "text-violet-600 dark:text-violet-400" : ""
            }`}
          >
            <ArrowUp className="h-3.5 w-3.5" />
            {ascLabel}
          </button>
          <button
            type="button"
            onClick={() => onSort("desc")}
            className={`flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-muted ${
              sortDir === "desc" ? "text-violet-600 dark:text-violet-400" : ""
            }`}
          >
            <ArrowDown className="h-3.5 w-3.5" />
            {descLabel}
          </button>

          <div className="my-1.5 border-t" />

          {/* Busca dentro dos valores */}
          <div className="relative mb-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar valor..."
              className="w-full rounded border bg-background py-1.5 pl-7 pr-2 outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          {/* Selecionar tudo (dos visíveis) */}
          <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 font-medium hover:bg-muted">
            <input
              type="checkbox"
              checked={allVisibleChecked}
              onChange={() =>
                setLocal((prev) => {
                  const n = new Set(prev);
                  if (allVisibleChecked) visible.forEach((d) => n.delete(d));
                  else visible.forEach((d) => n.add(d));
                  return n;
                })
              }
              className="h-3.5 w-3.5 rounded border-gray-300"
            />
            (Selecionar tudo)
          </label>

          <div className="max-h-52 overflow-y-auto">
            {visible.map((d) => (
              <label
                key={d}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-muted"
              >
                <input
                  type="checkbox"
                  checked={local.has(d)}
                  onChange={() =>
                    setLocal((prev) => {
                      const n = new Set(prev);
                      if (n.has(d)) n.delete(d);
                      else n.add(d);
                      return n;
                    })
                  }
                  className="h-3.5 w-3.5 shrink-0 rounded border-gray-300"
                />
                <span className="truncate" title={d}>
                  {d}
                </span>
              </label>
            ))}
            {visible.length === 0 && (
              <p className="px-2 py-2 text-muted-foreground">Nenhum valor</p>
            )}
          </div>

          <div className="mt-1.5 flex items-center justify-between gap-2 border-t pt-2">
            <button
              type="button"
              onClick={onClear}
              className="rounded px-2 py-1 font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              Limpar
            </button>
            <button
              type="button"
              onClick={() => onApply(local)}
              className="rounded bg-violet-600 px-3 py-1 font-medium text-white hover:bg-violet-700"
            >
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
