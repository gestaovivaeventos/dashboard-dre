"use client";

import { useMemo, useState } from "react";
import { Download } from "lucide-react";

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

type Req = {
  id: string;
  request_number: number;
  title: string;
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
  creator?: { name: string | null; email: string } | null;
};

type Sector = { id: string; name: string };

function resolve<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

const fmt = new Intl.NumberFormat("pt-BR", { style: "decimal", minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Data (criação/vencimento) → "dd/mm/aaaa". due_date é DATE ('YYYY-MM-DD');
// created_at é timestamp ISO. Compara-se pela parte da data (YYYY-MM-DD).
function dayPart(iso: string): string {
  return iso.slice(0, 10);
}
function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(dayPart(iso) + "T00:00:00").toLocaleDateString("pt-BR");
}
// Retorna true se `day` (YYYY-MM-DD) está dentro de [from, to] (limites opcionais).
function inRange(day: string, from: string, to: string): boolean {
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

export function RelatoriosClient({ requests, sectors }: { requests: Req[]; sectors: Sector[] }) {
  const [sectorFilter, setSectorFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const [dueFrom, setDueFrom] = useState("");
  const [dueTo, setDueTo] = useState("");
  const [exporting, setExporting] = useState(false);

  const hasFilters =
    sectorFilter || statusFilter || createdFrom || createdTo || dueFrom || dueTo;

  const filtered = useMemo(() => {
    return requests.filter((r) => {
      if (sectorFilter && r.sector_id !== sectorFilter) return false;
      if (statusFilter && r.status !== statusFilter) return false;
      // Criação (created_at)
      if ((createdFrom || createdTo) && !inRange(dayPart(r.created_at), createdFrom, createdTo)) {
        return false;
      }
      // Vencimento (due_date) — sem vencimento é excluído quando há filtro de vencimento
      if (dueFrom || dueTo) {
        if (!r.due_date) return false;
        if (!inRange(dayPart(r.due_date), dueFrom, dueTo)) return false;
      }
      return true;
    });
  }, [requests, sectorFilter, statusFilter, createdFrom, createdTo, dueFrom, dueTo]);

  const total = filtered.reduce((s, r) => s + Number(r.amount), 0);
  const byStatus = filtered.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + Number(r.amount);
    return acc;
  }, {});

  function clearFilters() {
    setSectorFilter("");
    setStatusFilter("");
    setCreatedFrom("");
    setCreatedTo("");
    setDueFrom("");
    setDueTo("");
  }

  async function handleExport() {
    if (filtered.length === 0) return;
    setExporting(true);
    try {
      const XLSX = await import("xlsx");
      const rows = filtered.map((r) => ({
        "#": r.request_number,
        "Título": r.title,
        "Solicitante": r.creator?.name ?? r.creator?.email ?? "",
        "Setor": resolve(r.ctrl_sectors)?.name ?? "",
        "Tipo": resolve(r.ctrl_expense_types)?.name ?? "",
        "Método": r.payment_method ? PAYMENT_LABELS[r.payment_method] ?? r.payment_method : "",
        "Competência":
          r.reference_month && r.reference_year
            ? `${MONTHS[r.reference_month - 1]}/${r.reference_year}`
            : "",
        "Valor": Number(r.amount),
        "Status": STATUS_LABELS[r.status] ?? r.status,
        "Criação": formatDate(r.created_at),
        "Vencimento": r.due_date ? formatDate(r.due_date) : "",
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Requisições");
      const stamp = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `relatorio-compras-${stamp}.xlsx`);
    } finally {
      setExporting(false);
    }
  }

  const INPUT = "rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring";
  const DATE = INPUT + " [color-scheme:light] dark:[color-scheme:dark]";

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/30 p-4">
        <div className="space-y-1">
          <label className="block text-xs font-medium text-muted-foreground">Setor</label>
          <select value={sectorFilter} onChange={(e) => setSectorFilter(e.target.value)} className={INPUT}>
            <option value="">Todos os setores</option>
            {sectors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        <div className="space-y-1">
          <label className="block text-xs font-medium text-muted-foreground">Status</label>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={INPUT}>
            <option value="">Todos os status</option>
            {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>

        <div className="space-y-1">
          <label className="block text-xs font-medium text-muted-foreground">Criação</label>
          <div className="flex items-center gap-2">
            <input type="date" value={createdFrom} onChange={(e) => setCreatedFrom(e.target.value)} className={DATE} />
            <span className="text-muted-foreground text-sm">até</span>
            <input type="date" value={createdTo} onChange={(e) => setCreatedTo(e.target.value)} className={DATE} />
          </div>
        </div>

        <div className="space-y-1">
          <label className="block text-xs font-medium text-muted-foreground">Vencimento</label>
          <div className="flex items-center gap-2">
            <input type="date" value={dueFrom} onChange={(e) => setDueFrom(e.target.value)} className={DATE} />
            <span className="text-muted-foreground text-sm">até</span>
            <input type="date" value={dueTo} onChange={(e) => setDueTo(e.target.value)} className={DATE} />
          </div>
        </div>

        {hasFilters && (
          <button onClick={clearFilters} className="pb-1.5 text-sm text-muted-foreground hover:text-foreground">
            Limpar filtros
          </button>
        )}

        <button
          onClick={handleExport}
          disabled={exporting || filtered.length === 0}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50 transition-colors"
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
          <p className="text-xs text-muted-foreground">{filtered.length} req.</p>
        </div>
        {Object.entries(byStatus).slice(0, 3).map(([s, v]) => (
          <div key={s} className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground uppercase font-medium">{STATUS_LABELS[s] ?? s}</p>
            <p className="text-xl font-bold mt-1">{fmt.format(v)}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          Nenhuma requisição encontrada com os filtros aplicados.
        </div>
      ) : (
        <div className="rounded-lg border overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                {["#", "Título", "Setor", "Tipo", "Método", "Mês/Ano", "Valor", "Status", "Criação", "Vencimento"].map((h) => (
                  <th key={h} className="px-4 py-3 text-left font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((req) => {
                const sector = resolve(req.ctrl_sectors);
                const expType = resolve(req.ctrl_expense_types);
                const badge = STATUS_CLS[req.status];
                return (
                  <tr key={req.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">#{req.request_number}</td>
                    <td className="px-4 py-2.5 max-w-[200px]">
                      <p className="font-medium truncate">{req.title}</p>
                      {req.creator && <p className="text-xs text-muted-foreground">{req.creator.name ?? req.creator.email}</p>}
                    </td>
                    <td className="px-4 py-2.5 text-xs">{sector?.name ?? "—"}</td>
                    <td className="px-4 py-2.5 text-xs">{expType?.name ?? "—"}</td>
                    <td className="px-4 py-2.5 text-xs">{req.payment_method ? PAYMENT_LABELS[req.payment_method] : "—"}</td>
                    <td className="px-4 py-2.5 text-xs">
                      {req.reference_month && req.reference_year
                        ? `${MONTHS[req.reference_month - 1]}/${req.reference_year}`
                        : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium whitespace-nowrap">{fmt.format(Number(req.amount))}</td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${badge ?? "bg-gray-100 text-gray-700"}`}>
                        {STATUS_LABELS[req.status] ?? req.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                      {formatDate(req.created_at)}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                      {formatDate(req.due_date)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t bg-muted/20">
                <td colSpan={6} className="px-4 py-2.5 text-sm font-semibold">Total</td>
                <td className="px-4 py-2.5 text-right font-bold">{fmt.format(total)}</td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
