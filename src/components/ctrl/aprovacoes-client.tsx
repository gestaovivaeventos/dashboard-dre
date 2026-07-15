"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  approveRequest,
  rejectRequest,
  reverseRequest,
  batchApproveRequests,
  getApprovalHistory,
  type ApprovalHistoryEntry,
} from "@/lib/ctrl/actions/requests";
import { InfoThreadModal } from "@/components/ctrl/payment-info-thread-modal";
import { isForcedDirectorRouting } from "@/lib/ctrl/routing";

type Req = {
  id: string;
  request_number: number;
  title: string;
  amount: number;
  status: string;
  // Etapa de origem guardada quando entra em complementação (gerente/diretor),
  // usada para decidir a aprovação de dentro da própria aba de Complementação.
  complement_return_status?: string | null;
  approval_tier: string | null;
  sector_id?: string | null;
  description: string | null;
  justification: string | null;
  observations: string | null;
  payment_method: string | null;
  due_date: string | null;
  created_at: string;
  created_by: string;
  ctrl_sectors?: { name: string } | { name: string }[] | null;
  ctrl_expense_types?: { name: string } | { name: string }[] | null;
  ctrl_suppliers?: { name: string } | null;
  creator?: { name: string | null; email: string } | null;
  approver?: { name: string | null } | null;
};

type Tab = "pendente" | "aguardando_complementacao" | "aprovado" | "rejeitado" | "estornado";

const TAB_LABELS: Record<Tab, string> = {
  pendente: "Pendentes",
  aguardando_complementacao: "Complementação",
  aprovado: "Aprovadas",
  rejeitado: "Rejeitadas",
  estornado: "Estornadas",
};

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  pendente:                    { label: "Pendente",        cls: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300" },
  pendente_diretor:            { label: "Aguardando Diretor", cls: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300" },
  aprovado:                    { label: "Aprovado",        cls: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300" },
  rejeitado:                   { label: "Rejeitado",       cls: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300" },
  aguardando_complementacao:   { label: "Complementação",  cls: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300" },
  estornado:                   { label: "Estornado",       cls: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400" },
  agendado:                    { label: "Agendado",        cls: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300" },
};

const PAYMENT_LABELS: Record<string, string> = {
  boleto: "Boleto", pix: "PIX", transferencia: "Transferência",
  cartao_credito: "Cartão de Crédito", dinheiro: "Dinheiro",
};

const fmt = new Intl.NumberFormat("pt-BR", { style: "decimal", minimumFractionDigits: 2, maximumFractionDigits: 2 });

function resolve<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

type SortField = "setor" | "data";
type SortDir = "asc" | "desc";

interface Props {
  requests: Req[];
  ctrlRoles: string[];
  // Ids de requisições em complementação aguardando análise do aprovador
  // (último turno foi resposta do solicitante). Alimenta o alerta da aba.
  awaitingApproverIds?: string[];
}

export function AprovacoesClient({ requests, ctrlRoles, awaitingApproverIds = [] }: Props) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>("pendente");
  const [sortField, setSortField] = useState<SortField>("data");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [modal, setModal] = useState<{ req: Req; mode: "reject" | "reverse" | "detail" } | null>(null);
  // Conversa de complementação (pedir info / responder) — thread completa.
  const [threadModal, setThreadModal] = useState<{ req: Req; mode: "ask" | "answer" } | null>(null);
  const [textInput, setTextInput] = useState("");
  const [feedback, setFeedback] = useState<{ msg: string; ok: boolean } | null>(null);
  const [isPending, startTransition] = useTransition();

  const hasRole = (...roles: string[]) => ctrlRoles.some((r) => roles.includes(r));
  const canApprove = hasRole("gerente", "diretor", "csc", "admin");
  const canReverse = hasRole("diretor", "admin");

  const awaitingSet = new Set(awaitingApproverIds);

  // Etapa atual da requisição e se o usuário pode agir nela.
  // pendente → etapa do gerente (gerente/diretor/csc/admin podem aprovar);
  // pendente_diretor → etapa do diretor (só diretor/csc/admin).
  // aguardando_complementacao → o aprovador decide aqui mesmo, usando a etapa de
  // origem (complement_return_status) para saber quem pode aprovar.
  const isPendingStatus = (s: string) => s === "pendente" || s === "pendente_diretor";
  const canActOn = (r: Req) => {
    const stage =
      r.status === "aguardando_complementacao"
        ? r.complement_return_status ?? "pendente"
        : r.status;
    return stage === "pendente_diretor"
      ? hasRole("diretor", "csc", "admin")
      : stage === "pendente"
      ? canApprove
      : false;
  };

  // Aba "Pendentes" agrupa as duas etapas de pendência.
  const filteredRequests =
    activeTab === "pendente"
      ? requests.filter((r) => isPendingStatus(r.status))
      : requests.filter((r) => r.status === activeTab);

  const sectorName = (r: Req) => resolve(r.ctrl_sectors)?.name ?? "";
  const tabRequests = [...filteredRequests].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    if (sortField === "setor") {
      const cmp = sectorName(a).localeCompare(sectorName(b), "pt-BR", { sensitivity: "base" });
      return cmp !== 0 ? cmp * dir : 0;
    }
    return (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * dir;
  });

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  }
  const pendentes = requests.filter((r) => isPendingStatus(r.status));
  // Só dá pra selecionar/aprovar em lote as que o usuário pode agir nesta etapa.
  const actionablePendentes = pendentes.filter(canActOn);
  const allSelected =
    actionablePendentes.length > 0 &&
    selected.size === actionablePendentes.length &&
    activeTab === "pendente";

  const counts: Record<Tab, number> = {
    pendente: pendentes.length,
    aguardando_complementacao: requests.filter((r) => r.status === "aguardando_complementacao").length,
    aprovado: requests.filter((r) => r.status === "aprovado").length,
    rejeitado: requests.filter((r) => r.status === "rejeitado").length,
    estornado: requests.filter((r) => r.status === "estornado").length,
  };

  function notify(msg: string, ok = true) {
    setFeedback({ msg, ok });
    setTimeout(() => setFeedback(null), 4000);
  }

  function toggleSelect(id: string) {
    setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  function openModal(req: Req, mode: "reject" | "reverse" | "detail") {
    setTextInput("");
    setModal({ req, mode });
  }

  function closeModal() {
    setModal(null);
    setTextInput("");
  }

  function handleAction(fn: () => Promise<unknown>) {
    startTransition(async () => {
      const res = await fn() as { ok?: boolean; error?: string } | undefined;
      if (res && "error" in res && res.error) { notify(res.error, false); }
      else { closeModal(); notify("Ação realizada com sucesso."); setSelected(new Set()); router.refresh(); }
    });
  }

  function handleBatchApprove() {
    handleAction(() => batchApproveRequests(Array.from(selected)));
  }

  return (
    <div className="space-y-4">
      {/* Feedback */}
      {feedback && (
        <div className={`rounded-md px-4 py-2 text-sm ${feedback.ok ? "bg-green-50 text-green-800 dark:bg-green-950/30 dark:text-green-300" : "bg-destructive/10 text-destructive"}`}>
          {feedback.msg}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg border bg-muted/40 p-1 overflow-x-auto">
        {(Object.keys(TAB_LABELS) as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => { setActiveTab(tab); setSelected(new Set()); }}
            className={`flex-1 min-w-max rounded-md px-3 py-1.5 text-sm font-medium transition-colors whitespace-nowrap ${
              activeTab === tab
                ? "bg-background shadow text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {TAB_LABELS[tab]}
            {tab === "aguardando_complementacao" && awaitingApproverIds.length > 0 ? (
              // Alerta: há resposta(s) do solicitante aguardando análise.
              <span
                className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-900/40 dark:text-red-300"
                title="Há novas respostas aguardando sua análise"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
                {awaitingApproverIds.length}
              </span>
            ) : counts[tab] > 0 ? (
              <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-xs ${activeTab === tab ? "bg-violet-100 text-violet-700" : "bg-muted text-muted-foreground"}`}>
                {counts[tab]}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {/* Batch actions bar (pendentes) */}
      {activeTab === "pendente" && canApprove && pendentes.length > 0 && (
        <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-4 py-2">
          <label className="flex items-center gap-2 cursor-pointer text-sm">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() => setSelected(allSelected ? new Set() : new Set(actionablePendentes.map((r) => r.id)))}
              className="h-4 w-4 rounded border-gray-300"
            />
            Selecionar todas
          </label>
          {selected.size > 0 && (
            <>
              <span className="text-sm text-muted-foreground">{selected.size} selecionada(s)</span>
              <button
                onClick={handleBatchApprove}
                disabled={isPending}
                className="ml-auto rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
              >
                {isPending ? "Aprovando..." : `Aprovar selecionadas (${selected.size})`}
              </button>
            </>
          )}
        </div>
      )}

      {/* Request table */}
      {tabRequests.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          Nenhuma requisição nesta categoria.
        </div>
      ) : (
        <div className="rounded-lg border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                {activeTab === "pendente" && canApprove && <th className="w-10 px-3 py-2" />}
                <th className="px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">Requisição</th>
                <SortHeader field="setor" label="Setor" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                <th className="px-3 py-2 font-medium text-right">Valor</th>
                <th className="px-3 py-2 font-medium">Vencimento</th>
                <SortHeader field="data" label="Criado em" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                <th className="px-3 py-2 font-medium">Solicitante</th>
                <th className="px-3 py-2 font-medium text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {tabRequests.map((req) => {
                const sector = resolve(req.ctrl_sectors);
                const supplier = resolve(req.ctrl_suppliers);
                const actionable = canActOn(req);
                const canSelectThis = activeTab === "pendente" && actionable;
                // Roteado ao diretor por regra (setor Diretoria / solicitante
                // especial) — não é "fora do orçamento".
                const isForcedDirector = isForcedDirectorRouting({
                  sector_id: req.sector_id,
                  created_by: req.created_by,
                });
                // "Fora do orçamento" só quando o nível 3 vem do orçamento, não
                // do roteamento forçado (cobre também dados antigos, cujo tier
                // foi marcado nível 3 pela regra de setor).
                const isOverBudget = req.approval_tier === "nivel_3" && !isForcedDirector;
                const isSelected = canSelectThis && selected.has(req.id);

                return (
                  <tr
                    key={req.id}
                    className={`align-top transition-colors ${isSelected ? "bg-violet-50 dark:bg-violet-950/20" : "hover:bg-muted/20"}`}
                  >
                    {activeTab === "pendente" && canApprove && (
                      <td className="px-3 py-3">
                        {canSelectThis && (
                          <input
                            type="checkbox"
                            checked={selected.has(req.id)}
                            onChange={() => toggleSelect(req.id)}
                            className="h-4 w-4 rounded border-gray-300"
                          />
                        )}
                      </td>
                    )}
                    <td className="px-3 py-3 font-mono text-xs text-muted-foreground whitespace-nowrap">#{req.request_number}</td>
                    <td className="px-3 py-3 min-w-[200px]">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{req.title}</span>
                        {(() => { const b = STATUS_BADGE[req.status]; return b ? <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${b.cls}`}>{b.label}</span> : null; })()}
                        {isOverBudget && (
                          <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-semibold bg-red-100 text-red-700 dark:bg-red-900/30">
                            Fora do orçamento
                          </span>
                        )}
                        {isForcedDirector && (
                          <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-semibold bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
                            Direto ao Diretor
                          </span>
                        )}
                        {awaitingSet.has(req.id) && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-900/40 dark:text-red-300">
                            <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
                            Nova resposta
                          </span>
                        )}
                      </div>
                      {supplier && (
                        <p className="mt-0.5 text-xs text-muted-foreground">{supplier.name}</p>
                      )}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">{sector?.name ?? "—"}</td>
                    <td className="px-3 py-3 text-right whitespace-nowrap tabular-nums">{fmt.format(req.amount)}</td>
                    <td className="px-3 py-3 whitespace-nowrap text-muted-foreground">
                      {req.due_date ? new Intl.DateTimeFormat("pt-BR").format(new Date(req.due_date + "T00:00:00")) : "—"}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-muted-foreground">{new Date(req.created_at).toLocaleDateString("pt-BR")}</td>
                    <td className="px-3 py-3 whitespace-nowrap text-muted-foreground">{req.creator ? (req.creator.name ?? req.creator.email) : "—"}</td>
                    <td className="px-3 py-3">
                      <div className="flex shrink-0 flex-wrap justify-end gap-2">
                        <button
                          onClick={() => openModal(req, "detail")}
                          className="rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
                        >
                          Detalhes
                        </button>

                        {/* Approver actions on pendente / pendente_diretor */}
                        {actionable && (
                          <>
                            <button
                              onClick={() => handleAction(() => approveRequest(req.id))}
                              disabled={isPending}
                              className="rounded-md bg-green-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
                            >
                              Aprovar
                            </button>
                            <button
                              onClick={() => setThreadModal({ req, mode: "ask" })}
                              className="rounded-md bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700 transition-colors"
                            >
                              Pedir Info
                            </button>
                            <button
                              onClick={() => openModal(req, "reject")}
                              className="rounded-md bg-red-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-red-700 transition-colors"
                            >
                              Rejeitar
                            </button>
                          </>
                        )}

                        {/* Não-aprovador (ex.: o próprio solicitante) responde aqui;
                            o aprovador decide via Aprovar/Rejeitar/Pedir Info acima. */}
                        {req.status === "aguardando_complementacao" && !actionable && (
                          <button
                            onClick={() => setThreadModal({ req, mode: "answer" })}
                            className="rounded-md bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700 transition-colors"
                          >
                            Responder
                          </button>
                        )}

                        {/* Director/admin reversal */}
                        {canReverse && req.status === "aprovado" && (
                          <button
                            onClick={() => openModal(req, "reverse")}
                            className="rounded-md border border-amber-500 text-amber-600 px-2.5 py-1.5 text-xs font-medium hover:bg-amber-50 dark:hover:bg-amber-950/20 transition-colors"
                          >
                            Estornar
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

      {/* Modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl border bg-background shadow-lg">
            {/* Modal header */}
            <div className="border-b px-6 py-4 flex items-center justify-between">
              <div>
                <h3 className="font-semibold">
                  {modal.mode === "detail" && `Requisição #${modal.req.request_number}`}
                  {modal.mode === "reject" && "Rejeitar Requisição"}
                  {modal.mode === "reverse" && "Estornar Requisição"}
                </h3>
                <p className="text-sm text-muted-foreground">{modal.req.title}</p>
              </div>
              <button onClick={closeModal} className="text-muted-foreground hover:text-foreground text-xl leading-none">&times;</button>
            </div>

            {/* Modal body */}
            <div className="px-6 py-4 space-y-4 max-h-[60vh] overflow-y-auto">
              {/* Detail view */}
              {modal.mode === "detail" && (
                <div className="space-y-3 text-sm">
                  <Row label="Valor" value={fmt.format(modal.req.amount)} />
                  <Row label="Status" value={STATUS_BADGE[modal.req.status]?.label ?? modal.req.status} />
                  {modal.req.ctrl_sectors && <Row label="Setor" value={resolve(modal.req.ctrl_sectors)?.name ?? "—"} />}
                  {modal.req.ctrl_expense_types && <Row label="Tipo" value={resolve(modal.req.ctrl_expense_types)?.name ?? "—"} />}
                  {modal.req.ctrl_suppliers && <Row label="Fornecedor" value={resolve(modal.req.ctrl_suppliers)?.name ?? "—"} />}
                  {modal.req.payment_method && <Row label="Pagamento" value={PAYMENT_LABELS[modal.req.payment_method] ?? modal.req.payment_method} />}
                  {modal.req.due_date && <Row label="Vencimento" value={new Intl.DateTimeFormat("pt-BR").format(new Date(modal.req.due_date + "T00:00:00"))} />}
                  {modal.req.approval_tier && (
                    <Row
                      label="Nível de aprovação"
                      value={
                        isForcedDirectorRouting({
                          sector_id: modal.req.sector_id,
                          created_by: modal.req.created_by,
                        })
                          ? "Diretor (direto — regra do setor)"
                          : modal.req.approval_tier === "nivel_3"
                            ? "Diretor (fora do orçamento)"
                            : "Gerente (nível 2)"
                      }
                    />
                  )}
                  {modal.req.creator && <Row label="Solicitante" value={modal.req.creator.name ?? modal.req.creator.email} />}
                  {modal.req.description && <Row label="Descrição" value={modal.req.description} />}
                  {modal.req.justification && <Row label="Justificativa" value={modal.req.justification} />}
                  {modal.req.observations && <Row label="Observações" value={modal.req.observations} />}
                  <Row label="Criado em" value={new Date(modal.req.created_at).toLocaleString("pt-BR")} />

                  <ApprovalHistorySection req={modal.req} />
                </div>
              )}

              {/* Reject / Reverse */}
              {modal.mode !== "detail" && (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    {modal.mode === "reject" && "Informe o motivo da rejeição (obrigatório):"}
                    {modal.mode === "reverse" && "Informe o motivo do estorno (obrigatório):"}
                  </p>
                  <textarea
                    value={textInput}
                    onChange={(e) => setTextInput(e.target.value)}
                    rows={4}
                    placeholder={
                      modal.mode === "reject"
                        ? "Ex: Despesa não autorizada no orçamento..."
                        : "Ex: Pagamento duplicado..."
                    }
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background focus:ring-2 focus:ring-ring focus:ring-offset-2 resize-none"
                  />
                </div>
              )}
            </div>

            {/* Modal footer */}
            <div className="border-t px-6 py-4 flex justify-end gap-3">
              <button onClick={closeModal} className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors">
                Fechar
              </button>
              {modal.mode === "reject" && (
                <button
                  onClick={() => handleAction(() => rejectRequest(modal.req.id, textInput))}
                  disabled={isPending || !textInput.trim()}
                  className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
                >
                  {isPending ? "Rejeitando..." : "Confirmar Rejeição"}
                </button>
              )}
              {modal.mode === "reverse" && (
                <button
                  onClick={() => handleAction(() => reverseRequest(modal.req.id, textInput))}
                  disabled={isPending || !textInput.trim()}
                  className="rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50 transition-colors"
                >
                  {isPending ? "Estornando..." : "Confirmar Estorno"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Conversa de complementação — histórico completo + pedir/responder */}
      {threadModal && (
        <InfoThreadModal
          variant="complement"
          mode={threadModal.mode}
          requestId={threadModal.req.id}
          requestNumber={threadModal.req.request_number}
          requestTitle={threadModal.req.title}
          onClose={() => setThreadModal(null)}
          onSubmitted={() => {
            const wasAsk = threadModal.mode === "ask";
            setThreadModal(null);
            notify(wasAsk ? "Pergunta enviada ao solicitante." : "Resposta enviada.");
            setSelected(new Set());
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function SortHeader({
  field,
  label,
  sortField,
  sortDir,
  onSort,
}: {
  field: SortField;
  label: string;
  sortField: SortField;
  sortDir: SortDir;
  onSort: (field: SortField) => void;
}) {
  const active = sortField === field;
  return (
    <th className="px-3 py-2 font-medium">
      <button
        onClick={() => onSort(field)}
        className={`inline-flex items-center gap-1 transition-colors hover:text-foreground ${active ? "text-foreground" : ""}`}
      >
        {label}
        <span aria-hidden className={active ? "" : "opacity-30"}>{active ? (sortDir === "asc" ? "↑" : "↓") : "↕"}</span>
      </button>
    </th>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="shrink-0 w-36 text-muted-foreground">{label}:</span>
      <span className="font-medium break-words">{value}</span>
    </div>
  );
}

const STAGE_LABEL: Record<"gerente" | "diretor", string> = {
  gerente: "Gerente",
  diretor: "Diretor",
};

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Etapa que ainda aguarda decisão, derivada do status atual da requisição.
// aguardando_complementacao usa a etapa de origem guardada (mesma lógica de
// canActOn). Retorna null quando não há etapa pendente (aprovado/rejeitado/etc).
function pendingStage(req: Req): "gerente" | "diretor" | null {
  const stage =
    req.status === "aguardando_complementacao"
      ? req.complement_return_status ?? "pendente"
      : req.status;
  if (stage === "pendente") return "gerente";
  if (stage === "pendente_diretor") return "diretor";
  return null;
}

// "Histórico de aprovações" — lê os eventos persistentes de decisão (ctrl_history)
// e os exibe em ordem cronológica. Some após aprovação/reload porque a fonte é o
// banco, não o estado da tela. Mostra também a etapa ainda pendente, se houver.
function ApprovalHistorySection({ req }: { req: Req }) {
  const [entries, setEntries] = useState<ApprovalHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setEntries(null);
    setError(null);
    (async () => {
      const res = await getApprovalHistory(req.id);
      if (!alive) return;
      if (res.error) {
        setError(res.error);
        setEntries([]);
        return;
      }
      setEntries(res.entries ?? []);
    })();
    return () => {
      alive = false;
    };
  }, [req.id]);

  const pending = pendingStage(req);

  return (
    <div className="border-t pt-4 mt-4">
      <h4 className="mb-3 text-sm font-semibold">Histórico de aprovações</h4>

      {entries === null ? (
        <p className="text-xs text-muted-foreground">Carregando histórico…</p>
      ) : error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : entries.length === 0 && !pending ? (
        <p className="text-xs text-muted-foreground">
          Nenhuma aprovação registrada ainda.
        </p>
      ) : (
        <div className="space-y-3">
          {entries.map((e) => (
            <ApprovalHistoryItem key={e.id} entry={e} />
          ))}

          {pending && (
            <div className="rounded-md border border-dashed px-3 py-2">
              <p className="text-sm font-semibold">{STAGE_LABEL[pending]}</p>
              <p className="text-xs text-muted-foreground">Pendente de aprovação</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ApprovalHistoryItem({ entry }: { entry: ApprovalHistoryEntry }) {
  const actor = entry.actorName ?? entry.actorEmail ?? "—";

  // Cabeçalho: etapa (Gerente/Diretor) quando houver; senão o tipo da ação.
  const heading = entry.stage
    ? STAGE_LABEL[entry.stage]
    : entry.action === "rejeitado"
    ? "Rejeição"
    : entry.action === "estornado"
    ? "Estorno"
    : "Aprovação";

  const accent =
    entry.action === "aprovado"
      ? "border-green-200 bg-green-50 dark:border-green-900/40 dark:bg-green-950/20"
      : entry.action === "rejeitado"
      ? "border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/20"
      : "border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/20";

  return (
    <div className={`rounded-md border px-3 py-2 ${accent}`}>
      <p className="text-sm font-semibold">{heading}</p>

      {entry.action === "aprovado" && entry.autoApproved ? (
        <>
          <p className="text-sm">Aprovação automática</p>
          <p className="text-sm">Solicitante: {actor}</p>
          <p className="text-xs text-muted-foreground">
            Motivo: solicitante é gerente e a despesa está prevista em orçamento
          </p>
        </>
      ) : entry.action === "aprovado" ? (
        <p className="text-sm">Aprovado por: {actor}</p>
      ) : entry.action === "rejeitado" ? (
        <>
          <p className="text-sm">Rejeitado por: {actor}</p>
          {entry.comment && (
            <p className="text-xs text-muted-foreground">Motivo: {entry.comment}</p>
          )}
        </>
      ) : (
        <>
          <p className="text-sm">Estornado por: {actor}</p>
          {entry.comment && (
            <p className="text-xs text-muted-foreground">Motivo: {entry.comment}</p>
          )}
        </>
      )}

      <p className="mt-0.5 text-xs text-muted-foreground">
        Data: {fmtDateTime(entry.createdAt)}
      </p>
    </div>
  );
}
