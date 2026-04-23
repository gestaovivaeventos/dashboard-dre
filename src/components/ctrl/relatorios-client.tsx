"use client";

import { useMemo, useState } from "react";

const MONTHS = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
  "Jul", "Ago", "Set", "Out", "Nov", "Dez",
];

const STATUS_LABELS: Record<string, string> = {
  pendente: "Pendente",
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
  ctrl_sectors?: { name: string } | { name: string }[] | null;
  ctrl_expense_types?: { name: string } | { name: string }[] | null;
  creator?: { name: string | null; email: string } | null;
};

type Sector = { id: string; name: string };

function resolve<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

const fmt = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function RelatoriosClient({ requests, sectors }: { requests: Req[]; sectors: Sector[] }) {
  const now = new Date();
  const [sectorFilter, setSectorFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [monthFrom, setMonthFrom] = useState(1);
  const [monthTo, setMonthTo] = useState(12);
  const [yearFilter, setYearFilter] = useState(now.getFullYear());

  const filtered = useMemo(() => {
    return requests.filter((r) => {
      if (sectorFilter) {
        const sec = resolve(r.ctrl_sectors);
        if (!sec || sec.name !== sectors.find((s) => s.id === sectorFilter)?.name) {
          // Filter by sector id match — compare via stored id (workaround: compare name)
          const found = sectors.find((s) => s.id === sectorFilter);
          if (!found || resolve(r.ctrl_sectors)?.name !== found.name) return false;
        }
      }
      if (statusFilter && r.status !== statusFilter) return false;
      if (r.reference_year && r.reference_year !== yearFilter) return false;
      if (r.reference_month) {
        if (r.reference_month < monthFrom || r.reference_month > monthTo) return false;
      }
      return true;
    });
  }, [requests, sectorFilter, statusFilter, yearFilter, monthFrom, monthTo, sectors]);

  const total = filtered.reduce((s, r) => s + Number(r.amount), 0);
  const byStatus = filtered.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + Number(r.amount);
    return acc;
  }, {});

  const INPUT = "rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring";

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 rounded-lg border bg-muted/30 p-4">
        <select value={sectorFilter} onChange={(e) => setSectorFilter(e.target.value)} className={INPUT}>
          <option value="">Todos os setores</option>
          {sectors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>

        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={INPUT}>
          <option value="">Todos os status</option>
          {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>

        <select value={yearFilter} onChange={(e) => setYearFilter(Number(e.target.value))} className={INPUT}>
          {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>

        <div className="flex items-center gap-2">
          <select value={monthFrom} onChange={(e) => setMonthFrom(Number(e.target.value))} className={INPUT}>
            {MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
          </select>
          <span className="text-muted-foreground text-sm">até</span>
          <select value={monthTo} onChange={(e) => setMonthTo(Number(e.target.value))} className={INPUT}>
            {MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
          </select>
        </div>

        <button
          onClick={() => { setSectorFilter(""); setStatusFilter(""); setMonthFrom(1); setMonthTo(12); setYearFilter(now.getFullYear()); }}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Limpar filtros
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
                {["#", "Título", "Setor", "Tipo", "Método", "Mês/Ano", "Valor", "Status", "Data"].map((h) => (
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
                      {new Date(req.created_at).toLocaleDateString("pt-BR")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t bg-muted/20">
                <td colSpan={6} className="px-4 py-2.5 text-sm font-semibold">Total</td>
                <td className="px-4 py-2.5 text-right font-bold">{fmt.format(total)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
