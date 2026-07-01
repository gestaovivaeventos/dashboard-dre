"use client";

import { Eye, FileText, Loader2, MessageCircle, Receipt, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { InfoThreadModal } from "@/components/ctrl/payment-info-thread-modal";
import {
  RequestDetailModal,
  fmt,
  type RequestDetail,
} from "@/components/ctrl/request-detail-modal";
import {
  getRequestAttachmentUrl,
  getRequestComprovantes,
  type RequestComprovante,
} from "@/lib/ctrl/actions/requests";

interface Props {
  requests: RequestDetail[];
}

export function RequisicoesTable({ requests }: Props) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<RequestDetail | null>(null);
  const [attachmentLoading, setAttachmentLoading] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [infoModal, setInfoModal] = useState<{
    id: string;
    number: number;
    title: string;
    mode: "answer" | "view";
  } | null>(null);
  // Modal de resposta à complementação pedida pelo aprovador.
  const [complementModal, setComplementModal] = useState<{
    id: string;
    number: number;
    title: string;
  } | null>(null);
  // Modal de comprovantes (anexos do título no Omie).
  const [comprovanteModal, setComprovanteModal] = useState<{
    id: string;
    number: number;
    title: string;
  } | null>(null);

  async function openAttachment(requestId: string) {
    setAttachmentLoading(true);
    setAttachmentError(null);
    try {
      const result = await getRequestAttachmentUrl(requestId);
      if ("error" in result && result.error) {
        setAttachmentError(result.error);
        setTimeout(() => setAttachmentError(null), 4000);
        return;
      }
      if ("url" in result && result.url) {
        window.open(result.url, "_blank", "noopener,noreferrer");
      }
    } finally {
      setAttachmentLoading(false);
    }
  }

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
                <th className="px-4 py-3">Anexos</th>
                <th className="px-4 py-3">Criado em</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((req) => {
                const hasPaymentInfo = req.status === "info_pagamento_pendente";
                const needsComplement = req.status === "aguardando_complementacao";
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
                    <td className="px-4 py-3">
                      {req.omie_contapagar_codigo ? (
                        <button
                          type="button"
                          onClick={() =>
                            setComprovanteModal({
                              id: req.id,
                              number: req.request_number,
                              title: req.title,
                            })
                          }
                          className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-muted"
                          title="Ver anexos do Omie"
                        >
                          <Receipt className="h-3.5 w-3.5" />
                          Anexos
                        </button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {req.created_at
                        ? new Date(req.created_at).toLocaleDateString("pt-BR")
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => setDetail(req)}
                          className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-muted"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          Detalhes
                        </button>
                        {needsComplement && (
                          <button
                            type="button"
                            onClick={() =>
                              setComplementModal({
                                id: req.id,
                                number: req.request_number,
                                title: req.title,
                              })
                            }
                            className="inline-flex items-center gap-1 rounded-md bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-800 hover:bg-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-950/60"
                            title="Responder à pergunta do aprovador"
                          >
                            <MessageCircle className="h-3.5 w-3.5" />
                            Responder
                          </button>
                        )}
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
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {attachmentError && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md bg-destructive px-4 py-2 text-sm text-destructive-foreground shadow-lg">
          {attachmentError}
        </div>
      )}

      {detail && (
        <RequestDetailModal
          req={detail}
          onClose={() => setDetail(null)}
          onOpenAttachment={openAttachment}
          attachmentLoading={attachmentLoading}
        />
      )}

      {infoModal && (
        <InfoThreadModal
          requestId={infoModal.id}
          requestNumber={infoModal.number}
          requestTitle={infoModal.title}
          mode={infoModal.mode}
          onClose={() => setInfoModal(null)}
          onSubmitted={() => router.refresh()}
        />
      )}

      {complementModal && (
        <InfoThreadModal
          variant="complement"
          mode="answer"
          requestId={complementModal.id}
          requestNumber={complementModal.number}
          requestTitle={complementModal.title}
          onClose={() => setComplementModal(null)}
          onSubmitted={() => {
            setComplementModal(null);
            router.refresh();
          }}
        />
      )}

      {comprovanteModal && (
        <ComprovantesModal
          requestId={comprovanteModal.id}
          requestNumber={comprovanteModal.number}
          requestTitle={comprovanteModal.title}
          onClose={() => setComprovanteModal(null)}
        />
      )}
    </div>
  );
}

// ── Comprovantes (anexos do título no Omie) ───────────────────────────────────

function ComprovantesModal({
  requestId,
  requestNumber,
  requestTitle,
  onClose,
}: {
  requestId: string;
  requestNumber: number;
  requestTitle: string;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [comprovantes, setComprovantes] = useState<RequestComprovante[]>([]);

  useEffect(() => {
    let active = true;
    getRequestComprovantes(requestId).then((res) => {
      if (!active) return;
      if ("error" in res) {
        setError(res.error);
      } else {
        setComprovantes(res.comprovantes);
      }
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [requestId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-xl border bg-background shadow-lg">
        <div className="border-b px-6 py-4 flex items-center justify-between">
          <div>
            <h3 className="font-semibold">Anexos — Requisição #{requestNumber}</h3>
            <p className="text-sm text-muted-foreground">{requestTitle}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-6 py-4">
          {loading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Buscando anexos no Omie...
            </p>
          ) : error ? (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          ) : comprovantes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum anexo neste título no Omie.
            </p>
          ) : (
            <ul className="divide-y rounded-md border">
              {comprovantes.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <span className="flex min-w-0 items-center gap-2 text-sm">
                    <Receipt className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{c.nome}</span>
                  </span>
                  {c.url ? (
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-muted"
                    >
                      Abrir
                    </a>
                  ) : (
                    <span className="shrink-0 text-xs text-muted-foreground">indisponível</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t px-6 py-4 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  pendente: "Pendente",
  pendente_diretor: "Aguard. Diretor",
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
    pendente_diretor: { label: "Aguard. Diretor", className: "bg-orange-100 text-orange-800" },
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
