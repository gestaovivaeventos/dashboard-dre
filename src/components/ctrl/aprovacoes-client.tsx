"use client";

import { useState, useTransition } from "react";

import {
  approveRequest,
  rejectRequest,
  requestInfo,
  reverseRequest,
  batchApproveRequests,
  answerComplement,
} from "@/lib/ctrl/actions/requests";

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
  pendente:                    { label: "Pendente",        cls: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300" },
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

const fmt = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function resolve<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

interface Props {
  requests: Req[];
  ctrlRoles: string[];
}

export function AprovacoesClient({ requests, ctrlRoles }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("pendente");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [modal, setModal] = useState<{ req: Req; mode: "reject" | "info" | "reverse" | "detail" | "answer" } | null>(null);
  const [textInput, setTextInput] = useState("");
  const [feedback, setFeedback] = useState<{ msg: string; ok: boolean } | null>(null);
  const [isPending, startTransition] = useTransition();

  const hasRole = (...roles: string[]) => ctrlRoles.some((r) => roles.includes(r));
  const canApprove = hasRole("gerente", "diretor", "csc", "admin");
  const canReverse = hasRole("diretor", "admin");

  const tabRequests = requests.filter((r) => r.status === activeTab);
  const pendentes = requests.filter((r) => r.status === "pendente");
  const allSelected = pendentes.length > 0 && selected.size === pendentes.length && activeTab === "pendente";

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

  function openModal(req: Req, mode: "reject" | "info" | "reverse" | "detail" | "answer") {
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
      else { closeModal(); notify("Ação realizada com sucesso."); setSelected(new Set()); }
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
            {counts[tab] > 0 && (
              <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-xs ${activeTab === tab ? "bg-violet-100 text-violet-700" : "bg-muted text-muted-foreground"}`}>
                {counts[tab]}
              </span>
            )}
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
              onChange={() => setSelected(allSelected ? new Set() : new Set(pendentes.map((r) => r.id)))}
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

      {/* Request list */}
      {tabRequests.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          Nenhuma requisição nesta categoria.
        </div>
      ) : (
        <div className="rounded-lg border divide-y">
          {tabRequests.map((req) => {
            const sector = resolve(req.ctrl_sectors);
            const expType = resolve(req.ctrl_expense_types);
            const canSelectThis = activeTab === "pendente" && canApprove;
            const isNivel3 = req.approval_tier === "nivel_3";
            const gerente = ctrlRoles.includes("gerente");

            return (
              <div
                key={req.id}
                className={`p-4 space-y-2 transition-colors ${canSelectThis && selected.has(req.id) ? "bg-violet-50 dark:bg-violet-950/20" : "hover:bg-muted/20"}`}
              >
                {/* Header row */}
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0">
                    {canSelectThis && (
                      <input
                        type="checkbox"
                        checked={selected.has(req.id)}
                        onChange={() => toggleSelect(req.id)}
                        disabled={gerente && isNivel3}
                        className="mt-0.5 h-4 w-4 rounded border-gray-300 shrink-0"
                      />
                    )}
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground">#{req.request_number}</span>
                        <span className="font-medium truncate">{req.title}</span>
                        {(() => { const b = STATUS_BADGE[req.status]; return b ? <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${b.cls}`}>{b.label}</span> : null; })()}
                        {isNivel3 && (
                          <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-semibold bg-red-100 text-red-700 dark:bg-red-900/30">
                            Diretor
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                        <span>{fmt.format(req.amount)}</span>
                        {sector && <span>{sector.name}</span>}
                        {expType && <span>{expType.name}</span>}
                        {req.payment_method && <span>{PAYMENT_LABELS[req.payment_method] ?? req.payment_method}</span>}
                        {req.due_date && <span>Vence {new Intl.DateTimeFormat("pt-BR").format(new Date(req.due_date + "T00:00:00"))}</span>}
                        <span>{new Date(req.created_at).toLocaleDateString("pt-BR")}</span>
                        {req.creator && <span>por {req.creator.name ?? req.creator.email}</span>}
                      </div>
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <button
                      onClick={() => openModal(req, "detail")}
                      className="rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
                    >
                      Detalhes
                    </button>

                    {/* Approver actions on pendente */}
                    {canApprove && req.status === "pendente" && !(gerente && isNivel3) && (
                      <>
                        <button
                          onClick={() => handleAction(() => approveRequest(req.id))}
                          disabled={isPending}
                          className="rounded-md bg-green-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
                        >
                          Aprovar
                        </button>
                        <button
                          onClick={() => openModal(req, "info")}
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

                    {/* Requester answers complement */}
                    {req.status === "aguardando_complementacao" && (
                      <button
                        onClick={() => openModal(req, "answer")}
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
                </div>
              </div>
            );
          })}
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
                  {modal.mode === "info" && "Pedir Informação"}
                  {modal.mode === "reverse" && "Estornar Requisição"}
                  {modal.mode === "answer" && "Responder Complementação"}
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
                  {modal.req.approval_tier && <Row label="Nível de aprovação" value={modal.req.approval_tier === "nivel_3" ? "Diretor (nível 3)" : "Gerente (nível 2)"} />}
                  {modal.req.creator && <Row label="Solicitante" value={modal.req.creator.name ?? modal.req.creator.email} />}
                  {modal.req.description && <Row label="Descrição" value={modal.req.description} />}
                  {modal.req.justification && <Row label="Justificativa" value={modal.req.justification} />}
                  {modal.req.observations && <Row label="Observações" value={modal.req.observations} />}
                  <Row label="Criado em" value={new Date(modal.req.created_at).toLocaleString("pt-BR")} />
                </div>
              )}

              {/* Reject / Info / Reverse / Answer */}
              {modal.mode !== "detail" && (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    {modal.mode === "reject" && "Informe o motivo da rejeição (obrigatório):"}
                    {modal.mode === "info" && "Qual informação você precisa do solicitante?"}
                    {modal.mode === "reverse" && "Informe o motivo do estorno (obrigatório):"}
                    {modal.mode === "answer" && "Informe a resposta para o aprovador:"}
                  </p>
                  <textarea
                    value={textInput}
                    onChange={(e) => setTextInput(e.target.value)}
                    rows={4}
                    placeholder={
                      modal.mode === "reject" ? "Ex: Despesa não autorizada no orçamento..."
                      : modal.mode === "info" ? "Ex: Qual o CNPJ do fornecedor?"
                      : modal.mode === "reverse" ? "Ex: Pagamento duplicado..."
                      : "Ex: O fornecedor emite NF..."
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
              {modal.mode === "info" && (
                <button
                  onClick={() => handleAction(() => requestInfo(modal.req.id, textInput))}
                  disabled={isPending || !textInput.trim()}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {isPending ? "Enviando..." : "Enviar Pergunta"}
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
              {modal.mode === "answer" && (
                <button
                  onClick={() => handleAction(() => answerComplement(modal.req.id, textInput))}
                  disabled={isPending || !textInput.trim()}
                  className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50 transition-colors"
                >
                  {isPending ? "Enviando..." : "Enviar Resposta"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
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
