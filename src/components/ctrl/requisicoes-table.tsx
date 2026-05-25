"use client";

import { FileText, MessageCircle, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { PaymentInfoThreadModal } from "@/components/ctrl/payment-info-thread-modal";

interface RequisicaoRow {
  id: string;
  request_number: number;
  title: string;
  amount: number;
  due_date: string | null;
  status: string;
  created_at: string;
}

interface Props {
  requests: RequisicaoRow[];
}

const fmt = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function RequisicoesTable({ requests }: Props) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [infoModal, setInfoModal] = useState<{
    id: string;
    number: number;
    title: string;
    mode: "answer" | "view";
  } | null>(null);

  // Filter by request number (exact prefix), title (substring), or status label.
  // Search is case-insensitive. Number-only search matches the request_number.
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return requests;
    const termDigits = term.replace(/\D/g, "");
    return requests.filter((r) => {
      if (termDigits && String(r.request_number).startsWith(termDigits)) return true;
      if (r.title.toLowerCase().includes(term)) return true;
      const statusLabel = STATUS_LABEL[r.status] ?? r.status;
      if (statusLabel.toLowerCase().includes(term)) return true;
      return false;
    });
  }, [requests, search]);

  if (requests.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
        <FileText className="mb-4 h-12 w-12 text-muted-foreground/40" />
        <h3 className="font-semibold">Nenhuma requisição</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Crie sua primeira requisição de pagamento.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por número, título ou status..."
            className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Limpar busca"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {filtered.length} de {requests.length} requisição{requests.length === 1 ? "" : "ões"}
        </p>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          Nenhuma requisição encontrada para &quot;{search}&quot;.
        </div>
      ) : (
        <div className="rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3">#</th>
                <th className="px-4 py-3">Título</th>
                <th className="px-4 py-3">Valor</th>
                <th className="px-4 py-3">Vencimento</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Criado em</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((req) => {
                const hasPaymentInfo = req.status === "info_pagamento_pendente";
                return (
                  <tr key={req.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-mono text-muted-foreground">
                      #{req.request_number}
                    </td>
                    <td className="px-4 py-3 font-medium">{req.title}</td>
                    <td className="px-4 py-3">{fmt.format(req.amount)}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {req.due_date
                        ? new Date(req.due_date + "T00:00:00").toLocaleDateString("pt-BR")
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={req.status} />
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(req.created_at).toLocaleDateString("pt-BR")}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {hasPaymentInfo && (
                        <button
                          type="button"
                          onClick={() =>
                            setInfoModal({
                              id: req.id,
                              number: req.request_number,
                              title: req.title,
                              mode: "answer",
                            })
                          }
                          className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-950/60"
                          title="Responder ao time de contas a pagar"
                        >
                          <MessageCircle className="h-3.5 w-3.5" />
                          Responder
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {infoModal && (
        <PaymentInfoThreadModal
          requestId={infoModal.id}
          requestNumber={infoModal.number}
          requestTitle={infoModal.title}
          mode={infoModal.mode}
          onClose={() => setInfoModal(null)}
          onSubmitted={() => router.refresh()}
        />
      )}
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  pendente: "Pendente",
  aprovado: "Aprovado",
  rejeitado: "Rejeitado",
  aguardando_complementacao: "Complementação",
  estornado: "Estornado",
  agendado: "Agendado",
  travado: "Travado",
  inativado_csc: "Inativado",
  aguardando_aprovacao_fornecedor: "Aguard. Fornec.",
  info_pagamento_pendente: "Info pendente",
};

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    pendente: { label: "Pendente", className: "bg-yellow-100 text-yellow-800" },
    aprovado: { label: "Aprovado", className: "bg-green-100 text-green-800" },
    rejeitado: { label: "Rejeitado", className: "bg-red-100 text-red-800" },
    aguardando_complementacao: { label: "Complementação", className: "bg-blue-100 text-blue-800" },
    estornado: { label: "Estornado", className: "bg-gray-100 text-gray-800" },
    agendado: { label: "Agendado", className: "bg-purple-100 text-purple-800" },
    travado: { label: "Travado", className: "bg-orange-100 text-orange-800" },
    inativado_csc: { label: "Inativado", className: "bg-gray-100 text-gray-500" },
    aguardando_aprovacao_fornecedor: {
      label: "Aguard. Fornec.",
      className: "bg-indigo-100 text-indigo-800",
    },
    info_pagamento_pendente: {
      label: "Info pendente",
      className: "bg-amber-100 text-amber-800",
    },
  };
  const config = map[status] ?? { label: status, className: "bg-gray-100 text-gray-800" };
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${config.className}`}
    >
      {config.label}
    </span>
  );
}
