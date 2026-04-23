"use client";

import { useState, useTransition } from "react";

import { sendToPayment, inactivateRequests } from "@/lib/ctrl/actions/requests";

type Supplier = {
  name: string;
  cnpj_cpf: string | null;
  chave_pix: string | null;
  banco: string | null;
  agencia: string | null;
  conta_corrente: string | null;
  titular_banco: string | null;
};

export type ContasRequest = {
  id: string;
  request_number: number;
  title: string;
  amount: number;
  due_date: string | null;
  status: string;
  paying_company: string | null;
  sent_to_payment_at: string | null;
  inactivation_reason: string | null;
  inactivated_at: string | null;
  ctrl_suppliers: Supplier | Supplier[] | null;
  ctrl_expense_types: { name: string } | { name: string }[] | null;
};

type Tab = "aprovado" | "agendado" | "inativado_csc";

const TAB_LABELS: Record<Tab, string> = {
  aprovado: "Aguardando Envio",
  agendado: "Enviados",
  inativado_csc: "Inativados",
};

interface Props {
  requests: ContasRequest[];
  ctrlRoles: string[];
  companies: { id: string; name: string }[];
}

function resolveSupplier(raw: Supplier | Supplier[] | null): Supplier | null {
  if (!raw) return null;
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
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

const fmt = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function ContasAPagarTable({ requests, ctrlRoles, companies }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("aprovado");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [payingCompany, setPayingCompany] = useState("");
  const [showEnviarModal, setShowEnviarModal] = useState(false);
  const [inactivateReason, setInactivateReason] = useState("");
  const [showInactivateModal, setShowInactivateModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const canInactivate = ctrlRoles.some((r) => ["csc", "admin"].includes(r));

  const tabRequests = requests.filter((r) => r.status === activeTab);
  const aprovadas = tabRequests.filter((r) => r.status === "aprovado");
  const allSelected = aprovadas.length > 0 && selected.size === aprovadas.length;

  const counts: Record<Tab, number> = {
    aprovado: requests.filter((r) => r.status === "aprovado").length,
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

  function handleEnviar() {
    if (selected.size === 0 || !payingCompany) return;
    startTransition(async () => {
      const result = await sendToPayment(Array.from(selected), payingCompany);
      if (result?.error) { notify(result.error, false); }
      else {
        setSelected(new Set());
        setPayingCompany("");
        setShowEnviarModal(false);
        notify(`${selected.size} requisição(ões) enviadas para pagamento.`);
      }
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

      {/* Content */}
      {tabRequests.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          Nenhuma requisição nesta categoria.
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
                  {activeTab === "aprovado" ? "Vencimento" : activeTab === "agendado" ? "Empresa / Enviado em" : "Inativado em"}
                </th>
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
                      <p className="font-medium">#{req.request_number}</p>
                      <p className="text-xs text-muted-foreground line-clamp-1">{req.title}</p>
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
                      {activeTab === "agendado" && (
                        <div>
                          {req.paying_company && <p className="font-medium text-sky-600">{req.paying_company}</p>}
                          {req.sent_to_payment_at && <p>{new Intl.DateTimeFormat("pt-BR").format(new Date(req.sent_to_payment_at))}</p>}
                        </div>
                      )}
                      {activeTab === "inativado_csc" && (
                        <div>
                          {req.inactivated_at && <p>{new Intl.DateTimeFormat("pt-BR").format(new Date(req.inactivated_at))}</p>}
                          {req.inactivation_reason && <p className="text-muted-foreground line-clamp-2">{req.inactivation_reason}</p>}
                        </div>
                      )}
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
                {companies.length > 0 ? (
                  <select
                    value={payingCompany}
                    onChange={(e) => setPayingCompany(e.target.value)}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">Selecione a empresa pagadora</option>
                    {companies.map((c) => (
                      <option key={c.id} value={c.name}>{c.name}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={payingCompany}
                    onChange={(e) => setPayingCompany(e.target.value)}
                    placeholder="Nome da empresa pagadora"
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                )}
              </div>
            </div>
            <div className="border-t px-6 py-4 flex justify-end gap-3">
              <button
                onClick={() => { setShowEnviarModal(false); setPayingCompany(""); }}
                disabled={isPending}
                className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleEnviar}
                disabled={isPending || !payingCompany}
                className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isPending ? "Enviando..." : "Confirmar Envio"}
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
    </div>
  );
}
