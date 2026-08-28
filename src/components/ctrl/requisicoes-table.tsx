"use client";

import { Eye, FileText, Loader2, MessageCircle, Pencil, Receipt, RefreshCw, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import {
  DeleteRequestDialog,
  EditRequestModal,
  type CadastroOption,
} from "@/components/ctrl/edit-request-modal";
import { InfoThreadModal } from "@/components/ctrl/payment-info-thread-modal";
import {
  RequestDetailModal,
  fmt,
  resolveNamed,
  resolveSupplier,
  resolveUser,
  valueMatchesSearch,
  type RequestDetail,
} from "@/components/ctrl/request-detail-modal";
import {
  getRequestAttachmentUrl,
  getRequestComprovantes,
  type RequestComprovante,
} from "@/lib/ctrl/actions/requests";
import { refreshPaymentStatuses } from "@/lib/ctrl/actions/payment-status";
import { formatDateBR, formatDayBR } from "@/lib/ctrl/datetime";
import { ExcelHeaderCell, useExcelTable, type ExcelColumn } from "@/components/ctrl/excel-table";

interface Props {
  requests: RequestDetail[];
  /**
   * Liga as colunas Solicitante e Setor. Só faz sentido quando a listagem traz
   * requisições de terceiros (admin/visão completa, ou responsável vendo os
   * setores dele) — para quem vê só as próprias as duas colunas seriam
   * constantes.
   */
  showRequester?: boolean;
  isAdmin?: boolean;
  canReconcile?: boolean;
  sectors?: CadastroOption[];
  expenseTypes?: CadastroOption[];
}

/** Nome (ou e-mail) de quem criou a requisição, para exibição. */
function requesterName(req: RequestDetail): string {
  const creator = resolveUser(req.creator ?? null);
  return creator?.name?.trim() || creator?.email?.trim() || "—";
}

/** Fornecedor da requisição (razão social) ou o favorecido avulso. */
function supplierName(req: RequestDetail): string {
  return resolveSupplier(req.ctrl_suppliers)?.name?.trim() || req.favorecido?.trim() || "—";
}

/** Setor da requisição; em rateio, lista os setores das parcelas. */
function sectorName(req: RequestDetail): string {
  if (req.is_rateio && Array.isArray(req.ctrl_request_sectors)) {
    const parts = req.ctrl_request_sectors
      .map((p) => resolveNamed(p.ctrl_sectors ?? null))
      .filter((n): n is string => Boolean(n));
    if (parts.length) return `Rateio: ${parts.join(", ")}`;
  }
  return resolveNamed(req.ctrl_sectors ?? null) ?? (req.is_rateio ? "Rateio" : "—");
}

// Uma requisição só é considerada "Paga" quando o título foi efetivamente
// baixado no Omie (omie_paid_at preenchido pela reconciliação) — não apenas
// enviada/agendada.
function isPaid(req: RequestDetail): boolean {
  return Boolean(req.omie_paid_at);
}

// Requisição já lançada no Omie (agendada ou com título) não pode ser
// editada/excluída aqui — evita divergência CTRL ↔ Omie.
function isOmieLaunched(req: RequestDetail): boolean {
  return req.status === "agendado" || req.omie_contapagar_codigo != null;
}

export function RequisicoesTable({
  requests,
  showRequester = false,
  isAdmin = false,
  canReconcile = false,
  sectors = [],
  expenseTypes = [],
}: Props) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [reconciling, setReconciling] = useState(false);
  const [reconcileMsg, setReconcileMsg] = useState<{ text: string; ok: boolean } | null>(null);

  async function handleRefreshPayments() {
    setReconciling(true);
    setReconcileMsg(null);
    try {
      const res = await refreshPaymentStatuses();
      if ("error" in res && res.error) {
        setReconcileMsg({ text: res.error, ok: false });
      } else if ("ok" in res) {
        setReconcileMsg({
          text:
            res.paid > 0
              ? `${res.paid} requisição(ões) atualizada(s) para Pago.`
              : `Nenhum novo pagamento confirmado no Omie (${res.checked} verificada${res.checked === 1 ? "" : "s"}).`,
          ok: true,
        });
        router.refresh();
      }
    } catch (e) {
      setReconcileMsg({
        text: e instanceof Error ? e.message : "Falha ao atualizar pagamentos.",
        ok: false,
      });
    } finally {
      setReconciling(false);
      setTimeout(() => setReconcileMsg(null), 6000);
    }
  }
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
  // Edição/exclusão administrativa (admin-only).
  const [editReq, setEditReq] = useState<RequestDetail | null>(null);
  const [deleteReq, setDeleteReq] = useState<RequestDetail | null>(null);

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
      // Busca por VALOR (ex.: "222,60", "1.234,56", "1234").
      if (valueMatchesSearch(r.amount, term)) return true;
      // Solicitante e setor só entram na busca quando estão visíveis na tela.
      if (showRequester && requesterName(r).toLowerCase().includes(term)) return true;
      if (showRequester && sectorName(r).toLowerCase().includes(term)) return true;
      // "Pago" tem precedência sobre o rótulo do status (a requisição paga
      // continua com status 'agendado' por baixo).
      const statusLabel = isPaid(r) ? "Pago" : STATUS_LABEL[r.status] ?? r.status;
      if (statusLabel.toLowerCase().includes(term)) return true;
      return false;
    });
  }, [requests, search, showRequester]);

  // Colunas para o cabeçalho estilo Excel (ordenar + filtrar por valores).
  const columns = useMemo<ExcelColumn<RequestDetail>[]>(
    () => [
      { key: "numero", type: "number", getValue: (r) => r.request_number, label: (r) => `#${r.request_number}` },
      { key: "titulo", type: "text", getValue: (r) => r.title },
      { key: "fornecedor", type: "text", getValue: (r) => supplierName(r) },
      ...(showRequester
        ? ([
            { key: "solicitante", type: "text", getValue: (r) => requesterName(r) },
            { key: "setor", type: "text", getValue: (r) => sectorName(r) },
          ] as ExcelColumn<RequestDetail>[])
        : []),
      { key: "valor", type: "number", getValue: (r) => r.amount, label: (r) => fmt.format(r.amount) },
      {
        key: "vencimento",
        type: "date",
        getValue: (r) => r.due_date ?? null,
        label: (r) => formatDayBR(r.due_date),
      },
      {
        key: "status",
        type: "text",
        getValue: (r) => (isPaid(r) ? "Pago" : STATUS_LABEL[r.status] ?? r.status),
      },
      {
        key: "criado",
        type: "date",
        getValue: (r) => r.created_at ?? null,
        label: (r) => formatDateBR(r.created_at),
      },
    ],
    [showRequester],
  );

  const { rows: displayed, headerProps, hasFilters, clearAll } = useExcelTable(filtered, columns);

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
        <div className="relative flex-1 max-w-md" data-tour="req-busca">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por número, título, valor ou status..."
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
          {displayed.length} de {requests.length} requisição{requests.length === 1 ? "" : "ões"}
        </p>
        {hasFilters && (
          <button
            type="button"
            onClick={clearAll}
            className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
            Limpar filtros
          </button>
        )}
        {canReconcile && (
          <button
            type="button"
            data-tour="req-atualizar-pagamentos"
            onClick={handleRefreshPayments}
            disabled={reconciling}
            title="Consulta no Omie quais títulos já foram efetivamente pagos (baixados) e atualiza o status para Pago."
            className="ml-auto inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-3 py-2 text-xs font-medium hover:bg-muted disabled:opacity-50"
          >
            {reconciling ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Atualizar pagamentos
          </button>
        )}
      </div>

      {reconcileMsg && (
        <div
          className={`rounded-md border px-3 py-2 text-xs ${
            reconcileMsg.ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300"
              : "border-destructive/40 bg-destructive/10 text-destructive"
          }`}
        >
          {reconcileMsg.text}
        </div>
      )}

      {displayed.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {search.trim() || hasFilters
            ? "Nenhuma requisição encontrada para a busca/filtros atuais."
            : "Nenhuma requisição."}
        </div>
      ) : (
        <div className="rounded-lg border overflow-x-auto" data-tour="req-tabela">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left text-xs font-semibold">
                <th className="px-4 py-3"><ExcelHeaderCell label="#" {...headerProps("numero")} /></th>
                <th className="px-4 py-3"><ExcelHeaderCell label="Requisição" {...headerProps("titulo")} /></th>
                <th className="px-4 py-3"><ExcelHeaderCell label="Fornecedor" {...headerProps("fornecedor")} /></th>
                {showRequester && (
                  <>
                    <th className="px-4 py-3"><ExcelHeaderCell label="Solicitante" {...headerProps("solicitante")} /></th>
                    <th className="px-4 py-3"><ExcelHeaderCell label="Setor" {...headerProps("setor")} /></th>
                  </>
                )}
                <th className="px-4 py-3"><ExcelHeaderCell label="Valor" {...headerProps("valor")} /></th>
                <th className="px-4 py-3"><ExcelHeaderCell label="Vencimento" {...headerProps("vencimento")} /></th>
                <th className="px-4 py-3"><ExcelHeaderCell label="Status" {...headerProps("status")} /></th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Anexos</th>
                <th className="px-4 py-3"><ExcelHeaderCell label="Criado em" menuSide="right" {...headerProps("criado")} /></th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ações</th>
              </tr>
            </thead>
            <tbody>
              {displayed.map((req) => {
                const hasPaymentInfo = req.status === "info_pagamento_pendente";
                const needsComplement = req.status === "aguardando_complementacao";
                return (
                  <tr key={req.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-mono text-muted-foreground">
                      #{req.request_number}
                    </td>
                    <td className="px-4 py-3 font-medium">{req.title}</td>
                    <td className="px-4 py-3 text-muted-foreground">{supplierName(req)}</td>
                    {showRequester && (
                      <>
                        <td className="px-4 py-3 text-muted-foreground">
                          {requesterName(req)}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {sectorName(req)}
                        </td>
                      </>
                    )}
                    <td className="px-4 py-3">{fmt.format(req.amount)}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatDayBR(req.due_date)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={req.status} paid={isPaid(req)} />
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
                      {formatDateBR(req.created_at)}
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
                        {isAdmin && (
                          <>
                            <button
                              type="button"
                              onClick={() => setEditReq(req)}
                              disabled={isOmieLaunched(req)}
                              title={
                                isOmieLaunched(req)
                                  ? "Já lançada no Omie — ajuste no Omie primeiro"
                                  : "Editar requisição"
                              }
                              className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              Editar
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteReq(req)}
                              disabled={isOmieLaunched(req)}
                              title={
                                isOmieLaunched(req)
                                  ? "Já lançada no Omie — ajuste no Omie primeiro"
                                  : "Excluir requisição"
                              }
                              className="inline-flex items-center gap-1 rounded-md border border-destructive/40 px-2.5 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Excluir
                            </button>
                          </>
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

      {editReq && (
        <EditRequestModal
          req={editReq}
          sectors={sectors}
          expenseTypes={expenseTypes}
          onClose={() => setEditReq(null)}
          onSaved={() => {
            setEditReq(null);
            router.refresh();
          }}
        />
      )}

      {deleteReq && (
        <DeleteRequestDialog
          req={deleteReq}
          onClose={() => setDeleteReq(null)}
          onDeleted={() => {
            setDeleteReq(null);
            router.refresh();
          }}
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
  pendente: "Aguardando Gerente",
  pendente_diretor: "Aguardando Diretor",
  aprovado: "Aprovado",
  rejeitado: "Rejeitado",
  aguardando_complementacao: "Complementação",
  agendado: "Enviado Pgto",
  aguardando_aprovacao_fornecedor: "Homologação fornec. pendente",
  info_pagamento_pendente: "Info pendente",
};

function StatusBadge({ status, paid }: { status: string; paid?: boolean }) {
  // "Pago" (título baixado no Omie) sobrepõe o rótulo do status subjacente
  // (a requisição segue com status 'agendado' internamente).
  if (paid) {
    return (
      <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
        Pago
      </span>
    );
  }
  const map: Record<string, { label: string; className: string }> = {
    pendente: { label: "Aguardando Gerente", className: "bg-yellow-100 text-yellow-800" },
    pendente_diretor: { label: "Aguardando Diretor", className: "bg-orange-100 text-orange-800" },
    aprovado: { label: "Aprovado", className: "bg-green-100 text-green-800" },
    rejeitado: { label: "Rejeitado", className: "bg-red-100 text-red-800" },
    aguardando_complementacao: { label: "Complementação", className: "bg-blue-100 text-blue-800" },
    agendado: { label: "Enviado Pgto", className: "bg-purple-100 text-purple-800" },
    aguardando_aprovacao_fornecedor: {
      label: "Homologação fornec. pendente",
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
