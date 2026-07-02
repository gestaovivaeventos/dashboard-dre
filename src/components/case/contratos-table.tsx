"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Paperclip, FileSignature, PenLine, RefreshCw, Search } from "lucide-react";

import type { ContractListRow } from "@/lib/case/queries";
import { resyncContract } from "@/lib/case/actions/contract-launch";
import { getContractAttachmentUrl, getSaleContractUrl, resendSignature } from "@/lib/case/actions/contracts";

const fmt = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const STATUS_STYLE: Record<string, string> = {
  lancado: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  assinado: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  aguardando_assinatura: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  parcial: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  erro: "bg-red-500/15 text-red-700 dark:text-red-300",
  rascunho: "bg-slate-500/15 text-slate-600 dark:text-slate-300",
  cancelado: "bg-slate-500/15 text-slate-500",
};

const STATUS_LABEL: Record<string, string> = {
  lancado: "Lançado",
  assinado: "Assinado",
  aguardando_assinatura: "Aguardando assinatura",
  parcial: "Parcial",
  erro: "Erro",
  rascunho: "Rascunho",
  cancelado: "Cancelado",
};

export function ContratosTable({ contracts }: { contracts: ContractListRow[] }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  const filtered = contracts.filter((c) => {
    const q = search.toLowerCase().trim();
    if (!q) return true;
    return (
      c.band_name.toLowerCase().includes(q) ||
      c.client_name.toLowerCase().includes(q) ||
      (c.event_name ?? "").toLowerCase().includes(q) ||
      String(c.contract_number).includes(q)
    );
  });

  async function handleResync(id: string) {
    setBusyId(id);
    const res = await resyncContract(id);
    setBusyId(null);
    if ("error" in res) {
      alert(res.error);
      return;
    }
    startTransition(() => router.refresh());
  }

  async function handleOpenAttachment(id: string) {
    const res = await getContractAttachmentUrl(id);
    if ("error" in res) {
      alert(res.error);
      return;
    }
    window.open(res.url, "_blank");
  }

  async function handleOpenSale(id: string) {
    const res = await getSaleContractUrl(id);
    if ("error" in res) {
      alert(res.error);
      return;
    }
    window.open(res.url, "_blank");
  }

  async function handleResend(id: string) {
    setBusyId(id);
    const res = await resendSignature(id);
    setBusyId(null);
    alert("error" in res ? res.error : "Assinatura reenviada ao cliente.");
  }

  return (
    <div className="space-y-3">
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por artista, cliente, evento…"
          className="h-9 w-full rounded-md border border-border bg-surface-1 pl-9 pr-3 text-sm text-ink-primary outline-none focus:ring-2 focus:ring-amber-500/40"
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-2 text-left text-xs uppercase tracking-wide text-ink-muted">
              <th className="px-3 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium">Artista / Cliente</th>
              <th className="px-3 py-2 font-medium">Evento</th>
              <th className="px-3 py-2 text-right font-medium">Venda (R$)</th>
              <th className="px-3 py-2 text-right font-medium">Custódia (R$)</th>
              <th className="px-3 py-2 text-right font-medium">Serviços (R$)</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Ações</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-ink-muted">
                  Nenhum contrato encontrado.
                </td>
              </tr>
            )}
            {filtered.map((c) => (
              <tr key={c.id} className="border-b border-border/60 last:border-0">
                <td className="px-3 py-2 tabular-nums text-ink-muted">{c.contract_number}</td>
                <td className="px-3 py-2">
                  <div className="font-medium text-ink-primary">{c.band_name}</div>
                  <div className="text-xs text-ink-muted">{c.client_name}</div>
                </td>
                <td className="px-3 py-2">
                  <div className="text-ink-primary">{c.event_name ?? "—"}</div>
                  <div className="text-xs text-ink-muted">
                    {c.event_date ? new Date(c.event_date + "T00:00:00").toLocaleDateString("pt-BR") : ""}
                  </div>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt.format(c.total_venda)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt.format(c.valor_custodia)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt.format(c.valor_servicos)}</td>
                <td className="px-3 py-2">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                      STATUS_STYLE[c.status] ?? STATUS_STYLE.rascunho
                    }`}
                  >
                    {STATUS_LABEL[c.status] ?? c.status}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1">
                    {c.attachment_path && (
                      <button type="button" title="Contrato do artista" onClick={() => handleOpenAttachment(c.id)} className="rounded p-1.5 text-ink-secondary hover:bg-surface-2 hover:text-ink-primary">
                        <Paperclip className="h-4 w-4" />
                      </button>
                    )}
                    {c.sale_contract_path && (
                      <button type="button" title="Contrato de venda (PDF)" onClick={() => handleOpenSale(c.id)} className="rounded p-1.5 text-ink-secondary hover:bg-surface-2 hover:text-ink-primary">
                        <FileSignature className="h-4 w-4" />
                      </button>
                    )}
                    {c.status === "aguardando_assinatura" && (
                      <button type="button" title="Reenviar assinatura ao cliente" disabled={busyId === c.id} onClick={() => handleResend(c.id)} className="rounded p-1.5 text-ink-secondary hover:bg-surface-2 hover:text-ink-primary disabled:opacity-50">
                        <PenLine className="h-4 w-4" />
                      </button>
                    )}
                    {(c.status === "erro" || c.status === "parcial" || c.status === "assinado") && (
                      <button
                        type="button"
                        title="Reenviar ao Omie"
                        disabled={busyId === c.id || pending}
                        onClick={() => handleResync(c.id)}
                        className="inline-flex items-center gap-1 rounded p-1.5 text-ink-secondary hover:bg-surface-2 hover:text-ink-primary disabled:opacity-50"
                      >
                        <RefreshCw className={`h-4 w-4 ${busyId === c.id ? "animate-spin" : ""}`} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
