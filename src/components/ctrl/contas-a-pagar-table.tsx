"use client";

import { useState, useTransition } from "react";
import { Eye, FileText, Loader2, Paperclip, X } from "lucide-react";

import {
  sendToPayment,
  inactivateRequests,
  getRequestAttachmentUrl,
} from "@/lib/ctrl/actions/requests";

type Supplier = {
  name: string;
  cnpj_cpf: string | null;
  chave_pix: string | null;
  banco: string | null;
  agencia: string | null;
  conta_corrente: string | null;
  titular_banco: string | null;
};

type NamedRef = { name: string } | { name: string }[] | null;
type UserRef =
  | { name: string | null; email: string | null }
  | Array<{ name: string | null; email: string | null }>
  | null;

export type ContasRequest = {
  id: string;
  request_number: number;
  title: string;
  description?: string | null;
  amount: number;
  due_date: string | null;
  reference_month?: number | null;
  reference_year?: number | null;
  status: string;
  paying_company: string | null;
  sent_to_payment_at: string | null;
  inactivation_reason: string | null;
  inactivated_at: string | null;
  payment_method?: string | null;
  installments?: number | null;
  installment_number?: number | null;
  installment_total?: number | null;
  needs_credit_card?: boolean | null;
  justification?: string | null;
  observations?: string | null;
  barcode?: string | null;
  pix_key?: string | null;
  pix_key_type?: string | null;
  bank_name?: string | null;
  bank_agency?: string | null;
  bank_account?: string | null;
  bank_account_digit?: string | null;
  bank_cpf_cnpj?: string | null;
  favorecido?: string | null;
  supplier_issues_invoice?: string | null;
  attachment_path?: string | null;
  created_at?: string | null;
  approved_at?: string | null;
  ctrl_suppliers: Supplier | Supplier[] | null;
  ctrl_expense_types: NamedRef;
  ctrl_sectors?: NamedRef;
  creator?: UserRef;
  approver?: UserRef;
};

function resolveNamed(raw: NamedRef): string | null {
  if (!raw) return null;
  if (Array.isArray(raw)) return raw[0]?.name ?? null;
  return raw.name ?? null;
}

function resolveUser(raw: UserRef): { name: string | null; email: string | null } | null {
  if (!raw) return null;
  if (Array.isArray(raw)) return raw[0] ?? null;
  return raw;
}

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  boleto: "Boleto",
  pix: "PIX",
  transferencia: "Transferência",
  cartao_credito: "Cartão de Crédito",
  dinheiro: "Dinheiro",
};

const MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

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

  // Detail modal — opened by "Detalhes" button in any row.
  const [detail, setDetail] = useState<ContasRequest | null>(null);
  const [attachmentLoading, setAttachmentLoading] = useState(false);

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
                    <td
                      className="px-4 py-3 text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => setDetail(req)}
                        className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-muted"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        Detalhes
                      </button>
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

      {/* Detail modal */}
      {detail && (
        <DetailModal
          req={detail}
          onClose={() => setDetail(null)}
          onOpenAttachment={openAttachment}
          attachmentLoading={attachmentLoading}
        />
      )}
    </div>
  );
}

// ── Detail modal ─────────────────────────────────────────────────────────────

function DetailModal({
  req,
  onClose,
  onOpenAttachment,
  attachmentLoading,
}: {
  req: ContasRequest;
  onClose: () => void;
  onOpenAttachment: (id: string) => void;
  attachmentLoading: boolean;
}) {
  const sup = resolveSupplier(req.ctrl_suppliers);
  const sector = resolveNamed(req.ctrl_sectors ?? null);
  const expenseType = resolveNamed(req.ctrl_expense_types);
  const creator = resolveUser(req.creator ?? null);
  const approver = resolveUser(req.approver ?? null);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="my-10 w-full max-w-3xl rounded-xl border bg-background shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b px-6 py-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-mono text-muted-foreground">#{req.request_number}</p>
            <h3 className="font-semibold leading-tight">{req.title}</h3>
            {req.installment_number && req.installment_total && req.installment_total > 1 && (
              <p className="mt-1 text-xs text-muted-foreground">
                Parcela {req.installment_number}/{req.installment_total}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto bg-muted/20 px-6 py-5 space-y-4">
          {/* Anexo em destaque */}
          {req.attachment_path ? (
            <button
              type="button"
              onClick={() => onOpenAttachment(req.id)}
              disabled={attachmentLoading}
              className="flex w-full items-center gap-3 rounded-lg border bg-background px-4 py-3 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-60"
            >
              {attachmentLoading ? (
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
              ) : (
                <Paperclip className="h-4 w-4 text-primary" />
              )}
              <span>Abrir anexo</span>
              <span className="ml-auto text-xs text-muted-foreground">
                {attachmentLoading ? "Gerando link..." : "Nova aba"}
              </span>
            </button>
          ) : (
            <div className="flex items-center gap-2 rounded-lg border border-dashed bg-background px-4 py-3 text-sm text-muted-foreground">
              <Paperclip className="h-4 w-4" />
              Esta requisição não possui anexo.
            </div>
          )}

          {/* Resumo */}
          <Section title="Resumo">
            <DetailField label="Valor" value={fmt.format(Number(req.amount))} />
            <DetailField
              label="Vencimento"
              value={
                req.due_date
                  ? new Intl.DateTimeFormat("pt-BR").format(new Date(req.due_date + "T00:00:00"))
                  : "—"
              }
            />
            <DetailField
              label="Competência"
              value={
                req.reference_month && req.reference_year
                  ? `${MONTHS[req.reference_month - 1]} / ${req.reference_year}`
                  : "—"
              }
            />
            <DetailField label="Setor" value={sector ?? "—"} />
            <DetailField label="Tipo de Despesa" value={expenseType ?? "—"} />
            <DetailField
              label="Método de pagamento"
              value={req.payment_method ? PAYMENT_METHOD_LABEL[req.payment_method] ?? req.payment_method : "—"}
            />
          </Section>

          {/* Descrição / observações / justificativa */}
          {(req.description || req.observations || req.justification) && (
            <Section title="Descrição e observações" twoCol={false}>
              {req.description && <DetailField label="Descrição" value={req.description} fullWidth />}
              {req.justification && <DetailField label="Justificativa" value={req.justification} fullWidth />}
              {req.observations && <DetailField label="Observações" value={req.observations} fullWidth />}
            </Section>
          )}

          {/* Fornecedor + dados de pagamento */}
          <Section title="Fornecedor / Pagamento">
            <DetailField label="Fornecedor" value={sup?.name ?? req.favorecido ?? "—"} />
            <DetailField label="CNPJ/CPF" value={sup?.cnpj_cpf ?? req.bank_cpf_cnpj ?? "—"} mono />
            <DetailField label="Emite nota fiscal?" value={formatIssuesInvoice(req.supplier_issues_invoice)} />
            {req.payment_method === "pix" && (
              <>
                <DetailField label="Tipo Chave PIX" value={req.pix_key_type ?? "—"} />
                <DetailField label="Chave PIX" value={sup?.chave_pix ?? req.pix_key ?? "—"} mono fullWidth />
              </>
            )}
            {req.payment_method === "transferencia" && (
              <>
                <DetailField label="Banco" value={sup?.banco ?? req.bank_name ?? "—"} />
                <DetailField label="Agência" value={sup?.agencia ?? req.bank_agency ?? "—"} mono />
                <DetailField label="Conta" value={sup?.conta_corrente ?? req.bank_account ?? "—"} mono />
                <DetailField label="Dígito" value={req.bank_account_digit ?? "—"} mono />
              </>
            )}
            {req.payment_method === "boleto" && (
              <DetailField label="Linha digitável / Código de barras" value={req.barcode ?? "—"} mono fullWidth />
            )}
            {req.payment_method === "cartao_credito" && (
              <>
                <DetailField label="Parcelas" value={String(req.installments ?? 1)} />
                <DetailField
                  label="Precisa do cartão físico?"
                  value={
                    req.needs_credit_card == null
                      ? "—"
                      : req.needs_credit_card
                      ? "Sim"
                      : "Não"
                  }
                />
              </>
            )}
          </Section>

          {/* Trilha de aprovação / envio */}
          <Section title="Histórico">
            <DetailField
              label="Criado por"
              value={creator?.name ?? creator?.email ?? "—"}
            />
            <DetailField
              label="Criado em"
              value={
                req.created_at
                  ? new Date(req.created_at).toLocaleString("pt-BR")
                  : "—"
              }
            />
            {req.approved_at && (
              <DetailField
                label="Aprovado por"
                value={
                  (approver?.name ?? approver?.email ?? "—") +
                  " · " +
                  new Date(req.approved_at).toLocaleString("pt-BR")
                }
                fullWidth
              />
            )}
            {req.sent_to_payment_at && (
              <DetailField
                label="Enviado para pagamento"
                value={
                  new Date(req.sent_to_payment_at).toLocaleString("pt-BR") +
                  (req.paying_company ? ` · ${req.paying_company}` : "")
                }
                fullWidth
              />
            )}
            {req.inactivated_at && (
              <DetailField
                label="Inativado"
                value={
                  new Date(req.inactivated_at).toLocaleString("pt-BR") +
                  (req.inactivation_reason ? ` · ${req.inactivation_reason}` : "")
                }
                fullWidth
              />
            )}
          </Section>
        </div>

        <div className="border-t px-6 py-3 flex justify-end">
          <button
            type="button"
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

function Section({
  title,
  children,
  twoCol = true,
}: {
  title: string;
  children: React.ReactNode;
  twoCol?: boolean;
}) {
  return (
    <section className="rounded-lg border bg-background shadow-sm">
      <header className="flex items-center gap-2 border-b px-4 py-2.5">
        <FileText className="h-4 w-4 text-primary" />
        <h4 className="text-sm font-semibold">{title}</h4>
      </header>
      <dl
        className={
          twoCol
            ? "grid grid-cols-1 gap-x-4 gap-y-3 p-4 sm:grid-cols-2 text-sm"
            : "p-4 space-y-3 text-sm"
        }
      >
        {children}
      </dl>
    </section>
  );
}

function DetailField({
  label,
  value,
  mono,
  fullWidth,
}: {
  label: string;
  value: string;
  mono?: boolean;
  fullWidth?: boolean;
}) {
  return (
    <div className={`space-y-0.5 ${fullWidth ? "sm:col-span-2" : ""}`}>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className={mono ? "font-mono text-sm break-all" : "text-sm whitespace-pre-wrap"}>
        {value || "—"}
      </dd>
    </div>
  );
}

function formatIssuesInvoice(value: string | null | undefined): string {
  if (!value) return "—";
  if (value === "sim") return "Sim";
  if (value === "nao") return "Não";
  if (value === "nao_sei") return "Não sei";
  return value;
}
