"use client";

import { useMemo, useState, useTransition } from "react";
import { Eye, Loader2, MessageCircle, Pencil, RefreshCw, Search, X } from "lucide-react";

import {
  sendToPayment,
  previewPrevisaoMatches,
  inactivateRequests,
  getRequestAttachmentUrl,
  type PrevisaoMatch,
} from "@/lib/ctrl/actions/requests";
import { resyncContaPagar } from "@/lib/ctrl/actions/contapagar-launch";
import { PaymentInfoThreadModal } from "@/components/ctrl/payment-info-thread-modal";
import { EditExpenseRoutingModal } from "@/components/ctrl/edit-expense-routing-modal";
import {
  RequestDetailModal,
  resolveSupplier,
  fmt,
  type Supplier,
  type RequestDetail,
} from "@/components/ctrl/request-detail-modal";
import { useRouter } from "next/navigation";

export type ContasRequest = RequestDetail;

type Tab = "aprovado" | "info_pagamento_pendente" | "agendado" | "inativado_csc";

const TAB_LABELS: Record<Tab, string> = {
  aprovado: "Aguardando Envio",
  info_pagamento_pendente: "Info Pendente",
  agendado: "Enviados",
  inativado_csc: "Inativados",
};

interface Props {
  requests: ContasRequest[];
  ctrlRoles: string[];
  companies: { id: string; name: string }[];
  // Cadastros para o modal de correção de setor/tipo (só carregados quando o
  // usuário pode editar). Vazios para quem não pode.
  sectors: { id: string; name: string }[];
  expenseTypes: { id: string; name: string }[];
}

function PaymentInfo({ supplier }: { supplier: Supplier | null }) {
  if (!supplier) return <span className="text-xs text-muted-foreground">Sem fornecedor</span>;
  if (supplier.chave_pix) {
    return (
      <div>
        <p className="text-xs font-medium text-green-700 dark:text-green-400">PIX</p>
        <p className="text-xs font-mono text-muted-foreground break-all">{supplier.chave_pix}</p>
      </div>
    );
  }
  if (supplier.banco) {
    return (
      <div>
        <p className="text-xs text-muted-foreground">
          {supplier.banco}{supplier.agencia ? ` · Ag. ${supplier.agencia}` : ""}
        </p>
        <p className="text-xs font-mono text-muted-foreground">CC {supplier.conta_corrente ?? "—"}</p>
        {supplier.titular_banco && <p className="text-xs text-muted-foreground">{supplier.titular_banco}</p>}
      </div>
    );
  }
  return <span className="text-xs text-muted-foreground">Dados não informados</span>;
}

export function ContasAPagarTable({ requests, ctrlRoles, companies, sectors, expenseTypes }: Props) {
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<Tab>("aprovado");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [payingCompanyId, setPayingCompanyId] = useState("");
  const [showEnviarModal, setShowEnviarModal] = useState(false);
  const [previsaoPreview, setPrevisaoPreview] = useState<PrevisaoMatch[] | null>(null);
  // requestId -> decisão escolhida no diálogo
  const [previsaoDecisoes, setPrevisaoDecisoes] = useState<Record<string, number | "novo">>({});
  const [inactivateReason, setInactivateReason] = useState("");
  const [showInactivateModal, setShowInactivateModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [isPending, startTransition] = useTransition();

  // Detail modal — opened by "Detalhes" button in any row.
  const [detail, setDetail] = useState<ContasRequest | null>(null);
  const [attachmentLoading, setAttachmentLoading] = useState(false);

  // Modal de correção de setor/tipo (perfil Contas a Pagar / admin).
  const [editRouting, setEditRouting] = useState<ContasRequest | null>(null);
  const canEditRouting = ctrlRoles.some((r) => ["contas_a_pagar", "admin"].includes(r));

  // Modal de thread de info — aberto pelo botao "Pedir info" / "Continuar conversa".
  const [infoModal, setInfoModal] = useState<{
    req: ContasRequest;
    mode: "ask" | "view";
  } | null>(null);

  const canAskInfo = ctrlRoles.some((r) => ["contas_a_pagar", "csc", "admin"].includes(r));

  async function openAttachment(requestId: string) {
    setAttachmentLoading(true);
    try {
      const result = await getRequestAttachmentUrl(requestId);
      if ("error" in result && result.error) {
        notify(result.error, false);
        return;
      }
      // Open in new tab — Supabase signed URLs go directly to the file.
      if ("url" in result && result.url) {
        window.open(result.url, "_blank", "noopener,noreferrer");
      }
    } finally {
      setAttachmentLoading(false);
    }
  }

  const canInactivate = ctrlRoles.some((r) => ["csc", "admin"].includes(r));

  // Sempre ordenado pelo nº da requisição, do maior para o menor. A busca filtra
  // por nome do fornecedor, título ou nº da requisição (case-insensitive).
  const tabRequests = useMemo(() => {
    const term = search.trim().toLowerCase();
    const termDigits = term.replace(/\D/g, "");
    return requests
      .filter((r) => r.status === activeTab)
      .filter((r) => {
        if (!term) return true;
        const sup = resolveSupplier(r.ctrl_suppliers);
        if (sup?.name && sup.name.toLowerCase().includes(term)) return true;
        if (r.title.toLowerCase().includes(term)) return true;
        if (termDigits && String(r.request_number).startsWith(termDigits)) return true;
        return false;
      })
      .sort((a, b) => b.request_number - a.request_number);
  }, [requests, activeTab, search]);

  const aprovadas = tabRequests.filter((r) => r.status === "aprovado");
  const allSelected = aprovadas.length > 0 && selected.size === aprovadas.length;

  const counts: Record<Tab, number> = {
    aprovado: requests.filter((r) => r.status === "aprovado").length,
    info_pagamento_pendente: requests.filter((r) => r.status === "info_pagamento_pendente").length,
    agendado: requests.filter((r) => r.status === "agendado").length,
    inativado_csc: requests.filter((r) => r.status === "inativado_csc").length,
  };

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(tabRequests.map((r) => r.id)));
  }

  function toggle(id: string) {
    setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  function notify(msg: string, ok = true) {
    if (ok) setSuccess(msg); else setError(msg);
    setTimeout(() => { setSuccess(null); setError(null); }, 4000);
  }

  function executarEnvio(decisoes?: Record<string, number | "novo">) {
    startTransition(async () => {
      const result = await sendToPayment(Array.from(selected), payingCompanyId, decisoes);
      if (result && "error" in result) {
        notify((result as { error: string }).error, false);
      } else if (result && "results" in result) {
        const failCount = result.results.filter((r) => r.error).length;
        setSelected(new Set());
        setPayingCompanyId("");
        setShowEnviarModal(false);
        setPrevisaoPreview(null);
        setPrevisaoDecisoes({});
        if (failCount > 0) {
          notify(`Enviado; ${failCount} falharam no Omie (mapeamento ou erro). Use Reenviar.`, false);
        } else {
          notify(`${result.results.length} requisição(ões) enviadas e lançadas no Omie.`);
        }
      }
    });
  }

  function handleEnviar() {
    if (selected.size === 0 || !payingCompanyId) return;
    startTransition(async () => {
      const preview = await previewPrevisaoMatches(Array.from(selected), payingCompanyId);
      if ("error" in preview) {
        notify(preview.error, false);
        return;
      }
      const comPrevisao = preview.matches.filter((m) => m.previsao);
      if (comPrevisao.length === 0) {
        executarEnvio();
        return;
      }
      const iniciais: Record<string, number | "novo"> = {};
      for (const m of comPrevisao) iniciais[m.requestId] = m.previsao!.codigo;
      setPrevisaoDecisoes(iniciais);
      setPrevisaoPreview(comPrevisao);
      setShowEnviarModal(false);
    });
  }

  function handleInativar() {
    if (selected.size === 0 || !inactivateReason.trim()) return;
    startTransition(async () => {
      const result = await inactivateRequests(Array.from(selected), inactivateReason);
      if (result && "error" in result) { notify(String((result as { error: string }).error), false); }
      else { setSelected(new Set()); setInactivateReason(""); setShowInactivateModal(false); notify(`${(result as { processed: number }).processed} inativada(s).`); }
    });
  }

  const totalSelected = tabRequests
    .filter((r) => selected.has(r.id))
    .reduce((s, r) => s + Number(r.amount), 0);

  return (
    <div className="space-y-4">
      {/* Feedback */}
      {error && <div className="rounded-md bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</div>}
      {success && <div className="rounded-md bg-green-50 px-4 py-2 text-sm text-green-800 dark:bg-green-950/30 dark:text-green-300">{success}</div>}

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg border bg-muted/40 p-1">
        {(Object.keys(TAB_LABELS) as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => { setActiveTab(tab); setSelected(new Set()); }}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              activeTab === tab ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {TAB_LABELS[tab]}
            {counts[tab] > 0 && (
              <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-xs ${activeTab === tab ? "bg-violet-100 text-violet-700" : "bg-muted text-muted-foreground"}`}>
                {counts[tab]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Busca */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por fornecedor, título ou nº..."
            className="w-full rounded-md border bg-background py-2 pl-9 pr-9 text-sm outline-none focus:ring-2 focus:ring-ring"
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
      </div>

      {/* Content */}
      {tabRequests.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          {search.trim()
            ? `Nenhuma requisição encontrada para "${search.trim()}".`
            : "Nenhuma requisição nesta categoria."}
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                {activeTab === "aprovado" && (
                  <th className="w-10 px-4 py-3">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} className="h-4 w-4 rounded border-gray-300" />
                  </th>
                )}
                {activeTab === "agendado" && canInactivate && (
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={tabRequests.length > 0 && selected.size === tabRequests.length}
                      onChange={() => setSelected(selected.size === tabRequests.length ? new Set() : new Set(tabRequests.map((r) => r.id)))}
                      className="h-4 w-4 rounded border-gray-300"
                    />
                  </th>
                )}
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Requisição</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Fornecedor</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Dados de Pagamento</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Valor</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  {activeTab === "aprovado"
                    ? "Vencimento"
                    : activeTab === "info_pagamento_pendente"
                    ? "Vencimento"
                    : activeTab === "agendado"
                    ? "Empresa / Enviado em"
                    : "Inativado em"}
                </th>
                <th className="w-20 px-4 py-3 text-right font-medium text-muted-foreground"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {tabRequests.map((req) => {
                const sup = resolveSupplier(req.ctrl_suppliers);
                const isSelected = selected.has(req.id);
                const clickable = activeTab === "aprovado" || (activeTab === "agendado" && canInactivate);

                return (
                  <tr
                    key={req.id}
                    onClick={clickable ? () => toggle(req.id) : undefined}
                    className={`transition-colors ${clickable ? "cursor-pointer" : ""} ${isSelected ? "bg-violet-50 dark:bg-violet-950/30" : "hover:bg-muted/20"}`}
                  >
                    {(activeTab === "aprovado" || (activeTab === "agendado" && canInactivate)) && (
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={isSelected} onChange={() => toggle(req.id)} className="h-4 w-4 rounded border-gray-300" />
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <p className="font-medium line-clamp-1">{req.title}</p>
                      <p className="text-xs text-muted-foreground">#{req.request_number}</p>
                    </td>
                    <td className="px-4 py-3">
                      {sup ? (
                        <div>
                          <p className="font-medium">{sup.name}</p>
                          {sup.cnpj_cpf && <p className="text-xs text-muted-foreground">{sup.cnpj_cpf}</p>}
                        </div>
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-3"><PaymentInfo supplier={sup} /></td>
                    <td className="px-4 py-3 text-right font-medium">{fmt.format(Number(req.amount))}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {activeTab === "aprovado" && (
                        req.due_date ? new Intl.DateTimeFormat("pt-BR").format(new Date(req.due_date + "T00:00:00")) : "—"
                      )}
                      {activeTab === "info_pagamento_pendente" && (
                        <div className="flex flex-col gap-1">
                          {req.due_date && (
                            <p>{new Intl.DateTimeFormat("pt-BR").format(new Date(req.due_date + "T00:00:00"))}</p>
                          )}
                          <span className="inline-flex w-fit items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                            <MessageCircle className="h-3 w-3" /> Aguardando resposta
                          </span>
                        </div>
                      )}
                      {activeTab === "agendado" && (
                        <div className="space-y-1">
                          {req.paying_company && <p className="font-medium text-sky-600">{req.paying_company}</p>}
                          {req.sent_to_payment_at && <p>{new Intl.DateTimeFormat("pt-BR").format(new Date(req.sent_to_payment_at))}</p>}
                          <OmieLaunchBadge status={req.omie_launch_status} error={req.omie_launch_error} />
                        </div>
                      )}
                      {activeTab === "inativado_csc" && (
                        <div>
                          {req.inactivated_at && <p>{new Intl.DateTimeFormat("pt-BR").format(new Date(req.inactivated_at))}</p>}
                          {req.inactivation_reason && <p className="text-muted-foreground line-clamp-2">{req.inactivation_reason}</p>}
                        </div>
                      )}
                    </td>
                    <td
                      className="px-4 py-3 text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex flex-col items-end gap-1">
                        <button
                          type="button"
                          onClick={() => setDetail(req)}
                          className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-muted"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          Detalhes
                        </button>
                        {canEditRouting && req.status === "aprovado" && !req.omie_contapagar_codigo && (
                          <button
                            type="button"
                            onClick={() => setEditRouting(req)}
                            className="inline-flex items-center gap-1 rounded-md border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700 hover:bg-sky-100 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300"
                            title="Corrigir setor/tipo de despesa (retorna à aprovação)"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Editar setor/tipo
                          </button>
                        )}
                        {canAskInfo && (req.status === "aprovado" || req.status === "info_pagamento_pendente") && (
                          <button
                            type="button"
                            onClick={() => setInfoModal({ req, mode: "ask" })}
                            className="inline-flex items-center gap-1 rounded-md border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700 hover:bg-violet-100 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300"
                            title={req.status === "info_pagamento_pendente" ? "Continuar conversa" : "Pedir info ao solicitante"}
                          >
                            <MessageCircle className="h-3.5 w-3.5" />
                            {req.status === "info_pagamento_pendente" ? "Continuar" : "Pedir info"}
                          </button>
                        )}
                        {activeTab === "agendado" && req.omie_launch_status === "erro" && ctrlRoles.some((r) => ["contas_a_pagar", "csc", "admin"].includes(r)) && (
                          <ResyncButton requestId={req.id} onDone={() => router.refresh()} />
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

      {/* Action bar — Aprovadas */}
      {activeTab === "aprovado" && tabRequests.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 px-4 py-3">
          {selected.size > 0 ? (
            <span className="text-sm text-muted-foreground">{selected.size} selecionada(s) · {fmt.format(totalSelected)}</span>
          ) : (
            <span className="text-sm text-muted-foreground">Selecione as requisições para enviar ao pagamento.</span>
          )}
          <button
            onClick={() => setShowEnviarModal(true)}
            disabled={selected.size === 0}
            className="ml-auto rounded-md bg-violet-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {`Enviar para Pagamento${selected.size > 0 ? ` (${selected.size})` : ""}`}
          </button>
        </div>
      )}

      {/* Modal — Enviar para pagamento */}
      {showEnviarModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl border bg-background shadow-lg">
            <div className="border-b px-6 py-4">
              <h3 className="font-semibold">Enviar {selected.size} Requisição(ões) para Pagamento</h3>
            </div>
            <div className="px-6 py-4 space-y-4">
              {/* Resumo */}
              <div className="rounded-lg bg-muted/40 px-4 py-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Requisições:</span>
                  <span className="font-medium">{selected.size}</span>
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-muted-foreground">Total:</span>
                  <span className="font-bold text-violet-600">{fmt.format(totalSelected)}</span>
                </div>
              </div>

              {/* Select empresa pagadora */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">
                  Empresa Pagadora <span className="text-destructive">*</span>
                </label>
                <select
                  value={payingCompanyId}
                  onChange={(e) => setPayingCompanyId(e.target.value)}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">Selecione a empresa pagadora</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                {companies.length === 0 && (
                  <p className="text-xs text-destructive">Nenhuma empresa com conexão Omie configurada.</p>
                )}
              </div>
            </div>
            <div className="border-t px-6 py-4 flex justify-end gap-3">
              <button
                onClick={() => { setShowEnviarModal(false); setPayingCompanyId(""); }}
                disabled={isPending}
                className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleEnviar}
                disabled={isPending || !payingCompanyId}
                className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isPending ? "Enviando..." : "Confirmar Envio"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Diálogo — Confirmar edição de previsões */}
      {previsaoPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl rounded-xl border bg-background shadow-lg">
            <div className="border-b px-6 py-4">
              <h3 className="font-semibold">Previsões encontradas no Omie</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Para estes fornecedores existe uma previsão vencendo no mês. Escolha
                editar a previsão (atualiza valor, vencimento e demais campos) ou criar
                um título novo.
              </p>
            </div>
            <div className="max-h-[60vh] overflow-y-auto px-6 py-4 space-y-3">
              {previsaoPreview.map((m) => {
                const decisao = previsaoDecisoes[m.requestId];
                const editar = typeof decisao === "number";
                return (
                  <div key={m.requestId} className="rounded-lg border px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm">
                        <p className="font-medium">
                          #{m.requestNumber} — {m.supplierName}
                        </p>
                        <p className="text-muted-foreground">
                          Previsão vence {m.previsao!.vencimento} · valor atual{" "}
                          {fmt.format(m.previsao!.valorAtual)} → novo {fmt.format(m.amount)}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-1 rounded-md border p-0.5">
                        <button
                          type="button"
                          onClick={() =>
                            setPrevisaoDecisoes((p) => ({ ...p, [m.requestId]: m.previsao!.codigo }))
                          }
                          className={`rounded px-2 py-1 text-xs font-medium ${
                            editar ? "bg-violet-600 text-white" : "text-muted-foreground hover:bg-muted"
                          }`}
                        >
                          Editar previsão
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setPrevisaoDecisoes((p) => ({ ...p, [m.requestId]: "novo" }))
                          }
                          className={`rounded px-2 py-1 text-xs font-medium ${
                            !editar ? "bg-violet-600 text-white" : "text-muted-foreground hover:bg-muted"
                          }`}
                        >
                          Criar novo
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="border-t px-6 py-4 flex justify-end gap-3">
              <button
                onClick={() => {
                  setPrevisaoPreview(null);
                  setPrevisaoDecisoes({});
                }}
                disabled={isPending}
                className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={() => executarEnvio(previsaoDecisoes)}
                disabled={isPending}
                className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
              >
                {isPending ? "Enviando..." : "Confirmar e enviar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Action bar — Enviados (inativar) */}
      {activeTab === "agendado" && canInactivate && selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-4 py-3">
          <span className="text-sm text-muted-foreground">{selected.size} selecionada(s)</span>
          <button
            onClick={() => setShowInactivateModal(true)}
            className="ml-auto rounded-md bg-red-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-700 transition-colors"
          >
            Inativar selecionadas
          </button>
        </div>
      )}

      {/* Inativar modal */}
      {showInactivateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl border bg-background shadow-lg">
            <div className="border-b px-6 py-4">
              <h3 className="font-semibold">Inativar {selected.size} Requisição(ões)</h3>
            </div>
            <div className="px-6 py-4 space-y-2">
              <p className="text-sm text-muted-foreground">Informe o motivo da inativação (obrigatório):</p>
              <textarea
                value={inactivateReason}
                onChange={(e) => setInactivateReason(e.target.value)}
                rows={3}
                placeholder="Ex: Pagamento cancelado..."
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring resize-none"
              />
            </div>
            <div className="border-t px-6 py-4 flex justify-end gap-3">
              <button onClick={() => { setShowInactivateModal(false); setInactivateReason(""); }} className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted">Cancelar</button>
              <button
                onClick={handleInativar}
                disabled={isPending || !inactivateReason.trim()}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {isPending ? "Inativando..." : "Confirmar Inativação"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detail modal */}
      {detail && (
        <RequestDetailModal
          req={detail}
          onClose={() => setDetail(null)}
          onOpenAttachment={openAttachment}
          attachmentLoading={attachmentLoading}
          showApprovalHistory
        />
      )}

      {/* Editar setor/tipo (retorna à aprovação) */}
      {editRouting && (
        <EditExpenseRoutingModal
          req={editRouting}
          sectors={sectors}
          expenseTypes={expenseTypes}
          onClose={() => setEditRouting(null)}
          onSaved={() => {
            setEditRouting(null);
            notify("Requisição atualizada e retornada à aprovação para nova validação.");
            router.refresh();
          }}
        />
      )}

      {/* Payment info thread modal */}
      {infoModal && (
        <PaymentInfoThreadModal
          requestId={infoModal.req.id}
          requestNumber={infoModal.req.request_number}
          requestTitle={infoModal.req.title}
          mode={infoModal.mode}
          onClose={() => setInfoModal(null)}
          onSubmitted={() => router.refresh()}
        />
      )}
    </div>
  );
}

// ── Omie launch badge ────────────────────────────────────────────────────────

function OmieLaunchBadge({
  status,
  error,
}: {
  status?: string | null;
  error?: string | null;
}) {
  if (!status) return null;
  if (status === "recebido") {
    return (
      <span className="inline-flex w-fit items-center rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-green-800 dark:bg-green-950/40 dark:text-green-300">
        Recebido (Omie)
      </span>
    );
  }
  if (status === "lancado") {
    return (
      <span className="inline-flex w-fit items-center rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-800 dark:bg-sky-950/40 dark:text-sky-300">
        Lançado (Omie)
      </span>
    );
  }
  if (status === "previsao_editada") {
    return (
      <span className="inline-flex w-fit items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
        Previsão editada
      </span>
    );
  }
  if (status === "erro") {
    return (
      <span
        title={error ?? undefined}
        className="inline-flex w-fit cursor-help items-center rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-800 dark:bg-red-950/40 dark:text-red-300"
      >
        Falha Omie
      </span>
    );
  }
  return null;
}

// ── Resync button ─────────────────────────────────────────────────────────────

function ResyncButton({ requestId, onDone }: { requestId: string; onDone: () => void }) {
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);

  function handleResync(e: React.MouseEvent) {
    e.stopPropagation();
    startTransition(async () => {
      const result = await resyncContaPagar(requestId);
      if ("error" in result) {
        setFeedback(`Erro: ${result.error}`);
      } else {
        setFeedback(`OK (${result.status})`);
        onDone();
      }
      setTimeout(() => setFeedback(null), 4000);
    });
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <button
        type="button"
        onClick={handleResync}
        disabled={isPending}
        className="inline-flex items-center gap-1 rounded-md border border-orange-200 bg-orange-50 px-2.5 py-1 text-xs font-medium text-orange-700 hover:bg-orange-100 disabled:opacity-50 dark:border-orange-900 dark:bg-orange-950/40 dark:text-orange-300"
      >
        {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        Reenviar ao Omie
      </button>
      {feedback && <p className="text-[10px] text-muted-foreground">{feedback}</p>}
    </div>
  );
}
