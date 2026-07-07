"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Download } from "lucide-react";

const MONTHS = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
  "Jul", "Ago", "Set", "Out", "Nov", "Dez",
];

const STATUS_LABELS: Record<string, string> = {
  pendente: "Pendente",
  pendente_diretor: "Aguard. Diretor",
  aprovado: "Aprovado",
  rejeitado: "Rejeitado",
  aguardando_complementacao: "Complementação",
  estornado: "Estornado",
  agendado: "Enviado Pgto",
  travado: "Travado",
  inativado_csc: "Inativado CSC",
  aguardando_aprovacao_fornecedor: "Aguard. Fornec.",
};

const STATUS_CLS: Record<string, string> = {
  pendente: "bg-yellow-100 text-yellow-800",
  pendente_diretor: "bg-orange-100 text-orange-800",
  aprovado: "bg-green-100 text-green-800",
  rejeitado: "bg-red-100 text-red-800",
  aguardando_complementacao: "bg-blue-100 text-blue-800",
  estornado: "bg-gray-100 text-gray-700",
  agendado: "bg-purple-100 text-purple-800",
  travado: "bg-orange-100 text-orange-800",
  inativado_csc: "bg-gray-100 text-gray-500",
};

const PAYMENT_LABELS: Record<string, string> = {
  boleto: "Boleto", pix: "PIX", transferencia: "Transferência",
  cartao_credito: "Cartão", dinheiro: "Dinheiro",
};

type Person = { name: string | null; email: string } | null;

type Req = {
  id: string;
  request_number: number;
  title: string;
  description: string | null;
  amount: number;
  status: string;
  due_date: string | null;
  created_at: string;
  payment_method: string | null;
  reference_month: number | null;
  reference_year: number | null;
  sector_id: string | null;
  ctrl_sectors?: { name: string } | { name: string }[] | null;
  ctrl_expense_types?: { name: string } | { name: string }[] | null;
  ctrl_suppliers?: { name: string } | { name: string }[] | null;
  creator?: Person;
  approver?: Person;
};

function resolve<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}
function personName(p: Person): string {
  if (!p) return "";
  return p.name ?? p.email ?? "";
}

const fmt = new Intl.NumberFormat("pt-BR", { style: "decimal", minimumFractionDigits: 2, maximumFractionDigits: 2 });

function dayPart(iso: string): string {
  return iso.slice(0, 10);
}
function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(dayPart(iso) + "T00:00:00").toLocaleDateString("pt-BR");
}
function inRange(day: string, from: string, to: string): boolean {
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}
// Aceita "1.234,56", "1234,56", "1234.56", "250".
function parseNum(raw: string): number {
  const t = (raw ?? "").trim();
  if (!t) return 0;
  const body = t.replace(/[R$\s]/g, "");
  const n = body.includes(",") ? Number(body.replace(/\./g, "").replace(",", ".")) : Number(body);
  return Number.isFinite(n) ? n : 0;
}

type FilterKind = "text" | "select" | "dateRange" | "numRange";

interface Column {
  key: string;
  label: string;
  kind: FilterKind;
  plain: (r: Req) => string; // texto p/ filtro, opções de select e export
  sortVal: (r: Req) => string | number;
  cell?: (r: Req) => ReactNode; // render custom (default = plain)
  rawDate?: (r: Req) => string | null; // p/ dateRange (YYYY-MM-DD ou null)
  right?: boolean;
}

const COLUMNS: Column[] = [
  {
    key: "num", label: "#", kind: "text",
    plain: (r) => String(r.request_number),
    sortVal: (r) => r.request_number,
    cell: (r) => <span className="font-mono text-xs text-muted-foreground">#{r.request_number}</span>,
  },
  { key: "title", label: "Título", kind: "text", plain: (r) => r.title ?? "", sortVal: (r) => (r.title ?? "").toLowerCase() },
  { key: "description", label: "Descrição", kind: "text", plain: (r) => r.description ?? "", sortVal: (r) => (r.description ?? "").toLowerCase() },
  { key: "requester", label: "Solicitante", kind: "text", plain: (r) => personName(r.creator ?? null), sortVal: (r) => personName(r.creator ?? null).toLowerCase() },
  { key: "approver", label: "Aprovador", kind: "text", plain: (r) => personName(r.approver ?? null), sortVal: (r) => personName(r.approver ?? null).toLowerCase() },
  { key: "sector", label: "Setor", kind: "select", plain: (r) => resolve(r.ctrl_sectors)?.name ?? "", sortVal: (r) => resolve(r.ctrl_sectors)?.name ?? "" },
  { key: "type", label: "Tipo", kind: "select", plain: (r) => resolve(r.ctrl_expense_types)?.name ?? "", sortVal: (r) => resolve(r.ctrl_expense_types)?.name ?? "" },
  { key: "supplier", label: "Fornecedor", kind: "text", plain: (r) => resolve(r.ctrl_suppliers)?.name ?? "", sortVal: (r) => resolve(r.ctrl_suppliers)?.name ?? "" },
  { key: "method", label: "Método", kind: "select", plain: (r) => (r.payment_method ? PAYMENT_LABELS[r.payment_method] ?? r.payment_method : ""), sortVal: (r) => (r.payment_method ? PAYMENT_LABELS[r.payment_method] ?? r.payment_method : "") },
  {
    key: "competencia", label: "Mês/Ano", kind: "select",
    plain: (r) => (r.reference_month && r.reference_year ? `${MONTHS[r.reference_month - 1]}/${r.reference_year}` : ""),
    sortVal: (r) => (r.reference_year ?? 0) * 100 + (r.reference_month ?? 0),
  },
  {
    key: "amount", label: "Valor", kind: "numRange", right: true,
    plain: (r) => fmt.format(Number(r.amount)),
    sortVal: (r) => Number(r.amount),
    cell: (r) => <span className="font-medium">{fmt.format(Number(r.amount))}</span>,
  },
  {
    key: "status", label: "Status", kind: "select",
    plain: (r) => STATUS_LABELS[r.status] ?? r.status,
    sortVal: (r) => STATUS_LABELS[r.status] ?? r.status,
    cell: (r) => (
      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${STATUS_CLS[r.status] ?? "bg-gray-100 text-gray-700"}`}>
        {STATUS_LABELS[r.status] ?? r.status}
      </span>
    ),
  },
  {
    key: "created", label: "Criação", kind: "dateRange",
    plain: (r) => formatDate(r.created_at),
    sortVal: (r) => dayPart(r.created_at),
    rawDate: (r) => dayPart(r.created_at),
  },
  {
    key: "due", label: "Vencimento", kind: "dateRange",
    plain: (r) => formatDate(r.due_date),
    sortVal: (r) => (r.due_date ? dayPart(r.due_date) : ""),
    rawDate: (r) => (r.due_date ? dayPart(r.due_date) : null),
  },
];

const INPUT = "w-full rounded-md border bg-background px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-ring";

export function RelatoriosClient({ requests }: { requests: Req[] }) {
  const [textFilters, setTextFilters] = useState<Record<string, string>>({});
  const [dateFilters, setDateFilters] = useState<Record<string, { from: string; to: string }>>({});
  const [amountRange, setAmountRange] = useState<{ min: string; max: string }>({ min: "", max: "" });
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // Opções dos filtros do tipo select — valores distintos presentes nos dados.
  const selectOptions = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const col of COLUMNS) {
      if (col.kind !== "select") continue;
      const set = new Set<string>();
      for (const r of requests) {
        const v = col.plain(r);
        if (v) set.add(v);
      }
      map[col.key] = Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
    }
    return map;
  }, [requests]);

  const hasFilters =
    Object.values(textFilters).some(Boolean) ||
    Object.values(dateFilters).some((d) => d?.from || d?.to) ||
    amountRange.min ||
    amountRange.max;

  const filtered = useMemo(() => {
    return requests.filter((r) => {
      for (const col of COLUMNS) {
        if (col.kind === "text") {
          const f = textFilters[col.key];
          if (f && !col.plain(r).toLowerCase().includes(f.toLowerCase())) return false;
        } else if (col.kind === "select") {
          const f = textFilters[col.key];
          if (f && col.plain(r) !== f) return false;
        } else if (col.kind === "dateRange") {
          const range = dateFilters[col.key];
          if (range && (range.from || range.to)) {
            const day = col.rawDate?.(r) ?? null;
            if (!day || !inRange(day, range.from, range.to)) return false;
          }
        } else if (col.kind === "numRange") {
          if (amountRange.min && Number(r.amount) < parseNum(amountRange.min)) return false;
          if (amountRange.max && Number(r.amount) > parseNum(amountRange.max)) return false;
        }
      }
      return true;
    });
  }, [requests, textFilters, dateFilters, amountRange]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    const col = COLUMNS.find((c) => c.key === sortKey);
    if (!col) return filtered;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const va = col.sortVal(a);
      const vb = col.sortVal(b);
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb), "pt-BR", { numeric: true }) * dir;
    });
  }, [filtered, sortKey, sortDir]);

  const total = sorted.reduce((s, r) => s + Number(r.amount), 0);
  const byStatus = sorted.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + Number(r.amount);
    return acc;
  }, {});

  function toggleSort(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function setText(key: string, value: string) {
    setTextFilters((prev) => ({ ...prev, [key]: value }));
  }
  function setDate(key: string, field: "from" | "to", value: string) {
    setDateFilters((prev) => {
      const cur = prev[key] ?? { from: "", to: "" };
      return { ...prev, [key]: { ...cur, [field]: value } };
    });
  }
  function clearFilters() {
    setTextFilters({});
    setDateFilters({});
    setAmountRange({ min: "", max: "" });
  }

  const [exporting, setExporting] = useState(false);
  async function handleExport() {
    if (sorted.length === 0) return;
    setExporting(true);
    try {
      const XLSX = await import("xlsx");
      const data = sorted.map((r) => {
        const row: Record<string, string | number> = {};
        for (const col of COLUMNS) {
          row[col.label] = col.key === "amount" ? Number(r.amount) : col.plain(r);
        }
        return row;
      });
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Requisições");
      const stamp = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `relatorio-compras-${stamp}.xlsx`);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Top bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted-foreground">{sorted.length} requisição(ões)</span>
          {hasFilters && (
            <button onClick={clearFilters} className="text-sm text-muted-foreground hover:text-foreground">
              Limpar filtros
            </button>
          )}
        </div>
        <button
          onClick={handleExport}
          disabled={exporting || sorted.length === 0}
          className="inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50 transition-colors"
        >
          <Download className="h-4 w-4" />
          {exporting ? "Exportando…" : "Exportar XLSX"}
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-lg border p-4">
          <p className="text-xs text-muted-foreground uppercase font-medium">Total</p>
          <p className="text-xl font-bold mt-1">{fmt.format(total)}</p>
          <p className="text-xs text-muted-foreground">{sorted.length} req.</p>
        </div>
        {Object.entries(byStatus).slice(0, 3).map(([s, v]) => (
          <div key={s} className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground uppercase font-medium">{STATUS_LABELS[s] ?? s}</p>
            <p className="text-xl font-bold mt-1">{fmt.format(v)}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-lg border overflow-auto">
        <table className="w-full text-sm">
          <thead>
            {/* Cabeçalho clicável (ordenação) */}
            <tr className="border-b bg-muted/40">
              {COLUMNS.map((col) => {
                const active = sortKey === col.key;
                const Arrow = !active ? ArrowUpDown : sortDir === "asc" ? ArrowUp : ArrowDown;
                return (
                  <th key={col.key} className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">
                    <button
                      onClick={() => toggleSort(col.key)}
                      className={`inline-flex items-center gap-1 hover:text-foreground ${active ? "text-foreground" : ""}`}
                    >
                      {col.label}
                      <Arrow className={`h-3.5 w-3.5 ${active ? "" : "opacity-40"}`} />
                    </button>
                  </th>
                );
              })}
            </tr>
            {/* Linha de filtros por coluna */}
            <tr className="border-b bg-background">
              {COLUMNS.map((col) => (
                <th key={col.key} className="px-2 py-1.5 align-top">
                  {col.kind === "text" && (
                    <input
                      value={textFilters[col.key] ?? ""}
                      onChange={(e) => setText(col.key, e.target.value)}
                      placeholder="Filtrar"
                      className={INPUT + " min-w-[90px]"}
                    />
                  )}
                  {col.kind === "select" && (
                    <select
                      value={textFilters[col.key] ?? ""}
                      onChange={(e) => setText(col.key, e.target.value)}
                      className={INPUT + " min-w-[110px]"}
                    >
                      <option value="">Todos</option>
                      {(selectOptions[col.key] ?? []).map((o) => (
                        <option key={o} value={o}>{o}</option>
                      ))}
                    </select>
                  )}
                  {col.kind === "numRange" && (
                    <div className="flex items-center gap-1">
                      <input
                        value={amountRange.min}
                        onChange={(e) => setAmountRange((p) => ({ ...p, min: e.target.value }))}
                        placeholder="mín"
                        className={INPUT + " w-20 text-right"}
                      />
                      <input
                        value={amountRange.max}
                        onChange={(e) => setAmountRange((p) => ({ ...p, max: e.target.value }))}
                        placeholder="máx"
                        className={INPUT + " w-20 text-right"}
                      />
                    </div>
                  )}
                  {col.kind === "dateRange" && (
                    <div className="flex items-center gap-1">
                      <input
                        type="date"
                        value={dateFilters[col.key]?.from ?? ""}
                        onChange={(e) => setDate(col.key, "from", e.target.value)}
                        className={INPUT + " [color-scheme:light] dark:[color-scheme:dark]"}
                      />
                      <input
                        type="date"
                        value={dateFilters[col.key]?.to ?? ""}
                        onChange={(e) => setDate(col.key, "to", e.target.value)}
                        className={INPUT + " [color-scheme:light] dark:[color-scheme:dark]"}
                      />
                    </div>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  Nenhuma requisição encontrada com os filtros aplicados.
                </td>
              </tr>
            ) : (
              sorted.map((r) => (
                <tr key={r.id} className="hover:bg-muted/20 transition-colors">
                  {COLUMNS.map((col) => (
                    <td
                      key={col.key}
                      className={`px-3 py-2 text-xs whitespace-nowrap ${col.right ? "text-right" : ""} ${
                        col.key === "title" || col.key === "description" ? "max-w-[220px] truncate" : ""
                      }`}
                      title={col.key === "title" || col.key === "description" ? col.plain(r) : undefined}
                    >
                      {col.cell ? col.cell(r) : col.plain(r) || <span className="text-muted-foreground">—</span>}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
          <tfoot>
            <tr className="border-t bg-muted/20">
              <td colSpan={COLUMNS.length} className="px-4 py-2.5 text-right text-sm font-semibold">
                Total: {fmt.format(total)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
