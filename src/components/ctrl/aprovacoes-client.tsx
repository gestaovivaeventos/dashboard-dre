"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Clock, MessageSquare, RotateCcw, X } from "lucide-react";

import {
  approveRequest,
  rejectRequest,
  requestInfo,
  reverseRequest,
  batchApproveRequests,
  answerComplement,
} from "@/lib/ctrl/actions/requests";
import { cn } from "@/lib/utils";

type Req = {
  id: string;
  request_number: number;
  title: string;
  amount: number;
  status: string;
  approval_tier: string | null;
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
  pendente:                  { label: "Pendente",          cls: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300" },
  pendente_diretor:          { label: "Aguardando Diretor", cls: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300" },
  aprovado:                  { label: "Aprovado",          cls: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300" },
  rejeitado:                 { label: "Rejeitado",         cls: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300" },
  aguardando_complementacao: { label: "Complementação",    cls: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300" },
  estornado:                 { label: "Estornado",         cls: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400" },
  agendado:                  { label: "Agendado",          cls: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300" },
};

const PAYMENT_LABELS: Record<string, string> = {
  boleto: "Boleto", pix: "PIX", transferencia: "Transferência",
  cartao_credito: "Cartão de Crédito", dinheiro: "Dinheiro", pix_copia_cola: "PIX Copia e Cola",
};

const fmt = new Intl.NumberFormat("pt-BR", { style: "decimal", minimumFractionDigits: 2, maximumFractionDigits: 2 });

function resolve<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function daysWaiting(createdAt: string): number {
  const diff = Date.now() - new Date(createdAt).getTime();
  return Math.max(0, Math.floor(diff / 86_400_000));
}

type AlcadaFilter = "all" | "nivel_2" | "nivel_3";

interface Props {
  requests: Req[];
  ctrlRoles: string[];
}

export function AprovacoesClient({ requests, ctrlRoles }: Props) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>("pendente");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [alcada, setAlcada] = useState<AlcadaFilter>("all");
  const [modal, setModal] = useState<{ req: Req; mode: "reject" | "info" | "reverse" | "answer" } | null>(null);
  const [textInput, setTextInput] = useState("");
  const [feedback, setFeedback] = useState<{ msg: string; ok: boolean } | null>(null);
  const [isPending, startTransition] = useTransition();

  const hasRole = (...roles: string[]) => ctrlRoles.some((r) => roles.includes(r));
  const canApprove = hasRole("gerente", "diretor", "csc", "admin");
  const canReverse = hasRole("diretor", "admin");

  // Etapa atual da requisição e se o usuário pode agir nela.
  // pendente → etapa do gerente (gerente/diretor/csc/admin podem aprovar);
  // pendente_diretor → etapa do diretor (só diretor/csc/admin).
  const isPendingStatus = (s: string) => s === "pendente" || s === "pendente_diretor";
  const canActOn = (r: Req) =>
    r.status === "pendente_diretor"
      ? hasRole("diretor", "csc", "admin")
      : r.status === "pendente"
      ? canApprove
      : false;

  // Aba "Pendentes" agrupa as duas etapas; aplica o filtro de alçada.
  const tabRequests = useMemo(() => {
    const base =
      activeTab === "pendente"
        ? requests.filter((r) => isPendingStatus(r.status))
        : requests.filter((r) => r.status === activeTab);
    if (activeTab !== "pendente" || alcada === "all") return base;
    return base.filter((r) => r.approval_tier === alcada);
  }, [requests, activeTab, alcada]);

  const pendentes = requests.filter((r) => isPendingStatus(r.status));
  const actionablePendentes = tabRequests.filter(canActOn);
  const allSelected =
    activeTab === "pendente" &&
    actionablePendentes.length > 0 &&
    actionablePendentes.every((r) => selected.has(r.id));

  const counts: Record<Tab, number> = {
    pendente: pendentes.length,
    aguardando_complementacao: requests.filter((r) => r.status === "aguardando_complementacao").length,
    aprovado: requests.filter((r) => r.status === "aprovado").length,
    rejeitado: requests.filter((r) => r.status === "rejeitado").length,
    estornado: requests.filter((r) => r.status === "estornado").length,
  };

  // Detalhe = item escolhido ou o primeiro da lista corrente.
  const selectedReq =
    tabRequests.find((r) => r.id === selectedId) ?? tabRequests[0] ?? null;

  function notify(msg: string, ok = true) {
    setFeedback({ msg, ok });
    setTimeout(() => setFeedback(null), 4000);
  }

  function toggleSelect(id: string) {
    setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  function openModal(req: Req, mode: "reject" | "info" | "reverse" | "answer") {
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

  function switchTab(tab: Tab) {
    setActiveTab(tab);
    setSelected(new Set());
    setSelectedId(null);
    if (tab !== "pendente") setAlcada("all");
  }

  return (
    <div className="space-y-4">
      {/* Feedback */}
      {feedback && (
        <div className={cn(
          "rounded-md px-4 py-2 text-sm",
          feedback.ok
            ? "bg-green-50 text-green-800 dark:bg-green-950/30 dark:text-green-300"
            : "bg-destructive/10 text-destructive",
        )}>
          {feedback.msg}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto rounded-lg border border-border bg-surface-2 p-1">
        {(Object.keys(TAB_LABELS) as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => switchTab(tab)}
            className={cn(
              "flex-1 min-w-max whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              activeTab === tab
                ? "bg-surface-0 text-ink-primary shadow-sm"
                : "text-ink-muted hover:text-ink-primary",
            )}
          >
            {TAB_LABELS[tab]}
            {counts[tab] > 0 && (
              <span
                className={cn(
                  "ml-1.5 rounded-full px-1.5 py-0.5 text-xs tabular-nums",
                  activeTab === tab ? "text-viva-500" : "bg-surface-3 text-ink-muted",
                )}
                style={activeTab === tab ? { backgroundColor: "var(--accent-soft)" } : undefined}
              >
                {counts[tab]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Filtro de alçada + batch (apenas Pendentes) */}
      {activeTab === "pendente" && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">Alçada:</span>
          {([
            ["all", "Todas"],
            ["nivel_2", "Nível 2 (Gerente)"],
            ["nivel_3", "Nível 3 (Diretor)"],
          ] as [AlcadaFilter, string][]).map(([val, label]) => (
            <button
              key={val}
              onClick={() => { setAlcada(val); setSelected(new Set()); }}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                alcada === val
                  ? "border-viva-500 text-viva-500"
                  : "border-border text-ink-secondary hover:bg-surface-2",
              )}
              style={alcada === val ? { backgroundColor: "var(--accent-soft)" } : undefined}
            >
              {label}
            </button>
          ))}

          {canApprove && actionablePendentes.length > 0 && (
            <div className="ml-auto flex items-center gap-3">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-secondary">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={() =>
                    setSelected(
                      allSelected ? new Set() : new Set(actionablePendentes.map((r) => r.id)),
                    )
                  }
                  className="h-4 w-4 rounded border-gray-300"
                />
                Selecionar todas
              </label>
              {selected.size > 0 && (
                <button
                  onClick={handleBatchApprove}
                  disabled={isPending}
                  className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                >
                  {isPending ? "Aprovando..." : `Aprovar (${selected.size})`}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Master-detail */}
      {tabRequests.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-ink-muted">
          Nenhuma requisição nesta categoria.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,380px)_1fr]">
          {/* Master list */}
          <div className="overflow-hidden rounded-lg border border-border bg-surface-1">
            <ul className="max-h-[70vh] divide-y divide-border overflow-y-auto">
              {tabRequests.map((req) => {
                const supplier = resolve(req.ctrl_suppliers);
                const isSel = selectedReq?.id === req.id;
                const canSelectThis = activeTab === "pendente" && canActOn(req);
                const isNivel3 = req.approval_tier === "nivel_3";
                const badge = STATUS_BADGE[req.status];

                return (
                  <li key={req.id} className="relative">
                    <button
                      type="button"
                      onClick={() => setSelectedId(req.id)}
                      style={isSel ? { backgroundColor: "var(--accent-soft)" } : undefined}
                      className={cn(
                        "flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors",
                        !isSel && "hover:bg-surface-2",
                      )}
                    >
                      {isSel && (
                        <span aria-hidden className="absolute left-0 top-2 bottom-2 w-[2px] rounded-sm bg-viva-500" />
                      )}
                      {canSelectThis && (
                        <input
                          type="checkbox"
                          checked={selected.has(req.id)}
                          onChange={() => toggleSelect(req.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[11px] text-ink-muted">#{req.request_number}</span>
                          {isNivel3 && (
                            <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-red-700 dark:bg-red-900/30 dark:text-red-300">
                              Fora orç.
                            </span>
                          )}
                        </div>
                        <p className="truncate text-sm font-medium text-ink-primary">{req.title}</p>
                        <div className="mt-0.5 flex items-center justify-between gap-2">
                          <span className="truncate text-xs text-ink-muted">
                            {supplier?.name ?? "—"}
                          </span>
                          <span className="shrink-0 text-xs font-semibold tabular-nums text-ink-secondary">
                            {fmt.format(req.amount)}
                          </span>
                        </div>
                      </div>
                      {badge && (
                        <span className={cn("ml-1 shrink-0 self-center rounded-full px-2 py-0.5 text-[10px] font-semibold", badge.cls)}>
                          {badge.label}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Detail panel */}
          {selectedReq ? (
            <DetailPanel
              req={selectedReq}
              actionable={canActOn(selectedReq)}
              canReverse={canReverse}
              isPending={isPending}
              onApprove={() => handleAction(() => approveRequest(selectedReq.id))}
              onInfo={() => openModal(selectedReq, "info")}
              onReject={() => openModal(selectedReq, "reject")}
              onAnswer={() => openModal(selectedReq, "answer")}
              onReverse={() => openModal(selectedReq, "reverse")}
            />
          ) : (
            <div className="flex items-center justify-center rounded-lg border border-dashed border-border p-10 text-sm text-ink-muted">
              Selecione uma requisição à esquerda.
            </div>
          )}
        </div>
      )}

      {/* Modal de ação com texto (rejeitar / pedir info / estornar / responder) */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={closeModal}>
          <div
            className="w-full max-w-lg rounded-xl border border-border bg-surface-1 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <div>
                <h3 className="font-semibold text-ink-primary">
                  {modal.mode === "reject" && "Rejeitar requisição"}
                  {modal.mode === "info" && "Pedir informação"}
                  {modal.mode === "reverse" && "Estornar requisição"}
                  {modal.mode === "answer" && "Responder complementação"}
                </h3>
                <p className="text-sm text-ink-muted">#{modal.req.request_number} · {modal.req.title}</p>
              </div>
              <button onClick={closeModal} aria-label="Fechar" className="text-ink-muted hover:text-ink-primary">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="px-6 py-4">
              <p className="mb-2 text-sm text-ink-muted">
                {modal.mode === "reject" && "Informe o motivo da rejeição (obrigatório):"}
                {modal.mode === "info" && "Qual informação você precisa do solicitante?"}
                {modal.mode === "reverse" && "Informe o motivo do estorno (obrigatório):"}
                {modal.mode === "answer" && "Informe a resposta para o aprovador:"}
              </p>
              <textarea
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                rows={4}
                autoFocus
                placeholder={
                  modal.mode === "reject" ? "Ex: Despesa não autorizada no orçamento..."
                  : modal.mode === "info" ? "Ex: Qual o CNPJ do fornecedor?"
                  : modal.mode === "reverse" ? "Ex: Pagamento duplicado..."
                  : "Ex: O fornecedor emite NF..."
                }
                className="w-full resize-none rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-ink-primary outline-none focus:border-viva-500"
              />
            </div>

            <div className="flex justify-end gap-3 border-t border-border px-6 py-4">
              <button onClick={closeModal} className="rounded-md border border-border px-4 py-2 text-sm font-medium text-ink-secondary hover:bg-surface-2">
                Cancelar
              </button>
              {modal.mode === "reject" && (
                <button
                  onClick={() => handleAction(() => rejectRequest(modal.req.id, textInput))}
                  disabled={isPending || !textInput.trim()}
                  className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {isPending ? "Rejeitando..." : "Confirmar rejeição"}
                </button>
              )}
              {modal.mode === "info" && (
                <button
                  onClick={() => handleAction(() => requestInfo(modal.req.id, textInput))}
                  disabled={isPending || !textInput.trim()}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {isPending ? "Enviando..." : "Enviar pergunta"}
                </button>
              )}
              {modal.mode === "reverse" && (
                <button
                  onClick={() => handleAction(() => reverseRequest(modal.req.id, textInput))}
                  disabled={isPending || !textInput.trim()}
                  className="rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  {isPending ? "Estornando..." : "Confirmar estorno"}
                </button>
              )}
              {modal.mode === "answer" && (
                <button
                  onClick={() => handleAction(() => answerComplement(modal.req.id, textInput))}
                  disabled={isPending || !textInput.trim()}
                  className="rounded-md bg-viva-500 px-4 py-2 text-sm font-medium text-white hover:bg-viva-600 disabled:opacity-50"
                >
                  {isPending ? "Enviando..." : "Enviar resposta"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Painel de detalhe ─────────────────────────────────────────────────────────

function DetailPanel({
  req,
  actionable,
  canReverse,
  isPending,
  onApprove,
  onInfo,
  onReject,
  onAnswer,
  onReverse,
}: {
  req: Req;
  actionable: boolean;
  canReverse: boolean;
  isPending: boolean;
  onApprove: () => void;
  onInfo: () => void;
  onReject: () => void;
  onAnswer: () => void;
  onReverse: () => void;
}) {
  const sector = resolve(req.ctrl_sectors);
  const expType = resolve(req.ctrl_expense_types);
  const supplier = resolve(req.ctrl_suppliers);
  const isNivel3 = req.approval_tier === "nivel_3";
  const dias = daysWaiting(req.created_at);
  const badge = STATUS_BADGE[req.status];

  return (
    <div className="flex flex-col rounded-lg border border-border bg-surface-1">
      {/* Cabeçalho: valor grande + status */}
      <div className="border-b border-border p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-xs text-ink-muted">#{req.request_number}</p>
            <h3 className="mt-0.5 text-base font-semibold leading-tight text-ink-primary">{req.title}</h3>
          </div>
          {badge && (
            <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold", badge.cls)}>
              {badge.label}
            </span>
          )}
        </div>
        <p className="mt-3 text-3xl font-bold tabular-nums text-ink-primary">{fmt.format(req.amount)}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
              isNivel3
                ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"
                : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
            )}
          >
            {isNivel3 ? "Fora do orçamento · Diretor" : "Dentro do orçamento · Gerente"}
          </span>
          <span className="inline-flex items-center gap-1 text-[11px] text-ink-muted">
            <Clock className="h-3 w-3" />
            {dias === 0 ? "hoje" : `há ${dias} dia${dias > 1 ? "s" : ""}`}
          </span>
        </div>
      </div>

      {/* Campos */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 p-5 text-sm">
        <Field label="Solicitante" value={req.creator?.name ?? req.creator?.email ?? "—"} />
        <Field label="Fornecedor" value={supplier?.name ?? "—"} />
        <Field label="Setor" value={sector?.name ?? "—"} />
        <Field label="Tipo de despesa" value={expType?.name ?? "—"} />
        <Field
          label="Pagamento"
          value={req.payment_method ? PAYMENT_LABELS[req.payment_method] ?? req.payment_method : "—"}
        />
        <Field
          label="Vencimento"
          value={req.due_date ? new Intl.DateTimeFormat("pt-BR").format(new Date(req.due_date + "T00:00:00")) : "—"}
        />
        <Field label="Criada em" value={new Date(req.created_at).toLocaleString("pt-BR")} full />
        {req.description && <Field label="Descrição" value={req.description} full />}
        {req.justification && <Field label="Justificativa" value={req.justification} full />}
        {req.observations && <Field label="Observações" value={req.observations} full />}
      </div>

      {/* Ações */}
      <div className="mt-auto flex flex-wrap gap-2 border-t border-border p-5">
        {actionable && (
          <>
            <button
              onClick={onApprove}
              disabled={isPending}
              className="inline-flex items-center gap-1.5 rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              <Check className="h-4 w-4" /> Aprovar
            </button>
            <button
              onClick={onInfo}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-4 py-2 text-sm font-medium text-ink-secondary hover:bg-surface-2"
            >
              <MessageSquare className="h-4 w-4" /> Pedir info
            </button>
            <button
              onClick={onReject}
              className="inline-flex items-center gap-1.5 rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950/20"
            >
              <X className="h-4 w-4" /> Devolver
            </button>
          </>
        )}
        {req.status === "aguardando_complementacao" && (
          <button
            onClick={onAnswer}
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            <MessageSquare className="h-4 w-4" /> Responder
          </button>
        )}
        {canReverse && req.status === "aprovado" && (
          <button
            onClick={onReverse}
            className="inline-flex items-center gap-1.5 rounded-md border border-amber-500 px-4 py-2 text-sm font-medium text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/20"
          >
            <RotateCcw className="h-4 w-4" /> Estornar
          </button>
        )}
        {!actionable &&
          req.status !== "aguardando_complementacao" &&
          !(canReverse && req.status === "aprovado") && (
            <p className="text-sm text-ink-muted">Sem ações disponíveis para esta requisição.</p>
          )}
      </div>
    </div>
  );
}

function Field({ label, value, full }: { label: string; value: string; full?: boolean }) {
  return (
    <div className={full ? "col-span-2" : undefined}>
      <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</p>
      <p className="mt-0.5 whitespace-pre-wrap break-words text-ink-primary">{value}</p>
    </div>
  );
}
