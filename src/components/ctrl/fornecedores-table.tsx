"use client";

import { useMemo, useState, useTransition } from "react";
import { Banknote, CheckCircle2, Contact, Loader2, Tags, XCircle } from "lucide-react";

import { approveSupplier, rejectSupplier } from "@/lib/ctrl/actions/suppliers";

interface SupplierRow {
  id: string;
  name: string;
  cnpj_cpf: string | null;
  email: string | null;
  phone: string | null;
  omie_id: number | null;
  from_omie: boolean;
  chave_pix: string | null;
  banco: string | null;
  agencia: string | null;
  conta_corrente: string | null;
  titular_banco: string | null;
  doc_titular: string | null;
  transf_padrao: boolean;
  status: string;
  rejection_reason: string | null;
  created_at: string;
  approved_at: string | null;
  approver_name: string | null;
  expense_type_ids: string[];
}

interface ExpenseTypeOption {
  id: string;
  name: string;
}

interface FornecedoresTableProps {
  suppliers: SupplierRow[];
  expenseTypes: ExpenseTypeOption[];
  canApprove: boolean;
}

type TabKey = "pendente" | "aprovado" | "rejeitado";

const TAB_LABELS: Record<TabKey, string> = {
  pendente: "Pendentes",
  aprovado: "Aprovados",
  rejeitado: "Rejeitados",
};

export function FornecedoresTable({
  suppliers,
  expenseTypes,
  canApprove,
}: FornecedoresTableProps) {
  const [isPending, startTransition] = useTransition();
  const [actingId, setActingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ kind: "error" | "success"; msg: string } | null>(null);

  const [approveModal, setApproveModal] = useState<SupplierRow | null>(null);
  const [selectedExpenseTypes, setSelectedExpenseTypes] = useState<Set<string>>(new Set());

  const [activeTab, setActiveTab] = useState<TabKey>("pendente");

  const expenseTypeMap = useMemo(
    () => new Map(expenseTypes.map((e) => [e.id, e.name])),
    [expenseTypes],
  );

  const counts = useMemo<Record<TabKey, number>>(() => {
    const acc: Record<TabKey, number> = { pendente: 0, aprovado: 0, rejeitado: 0 };
    for (const s of suppliers) {
      if (s.status === "pendente" || s.status === "aprovado" || s.status === "rejeitado") {
        acc[s.status as TabKey] += 1;
      }
    }
    return acc;
  }, [suppliers]);

  const visibleSuppliers = useMemo(
    () => suppliers.filter((s) => s.status === activeTab),
    [suppliers, activeTab],
  );

  const openApproveModal = (supplier: SupplierRow) => {
    setApproveModal(supplier);
    setSelectedExpenseTypes(new Set(supplier.expense_type_ids));
  };

  const closeApproveModal = () => {
    setApproveModal(null);
    setSelectedExpenseTypes(new Set());
  };

  const toggleExpenseType = (id: string) => {
    setSelectedExpenseTypes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const confirmApprove = () => {
    if (!approveModal) return;
    if (selectedExpenseTypes.size === 0) {
      setFeedback({ kind: "error", msg: "Selecione ao menos um tipo de despesa." });
      return;
    }
    const supplierId = approveModal.id;
    const ids = Array.from(selectedExpenseTypes);
    setActingId(supplierId);
    startTransition(async () => {
      const result = await approveSupplier(supplierId, ids);
      setActingId(null);
      if ("error" in result && result.error) {
        setFeedback({ kind: "error", msg: `Falha ao aprovar: ${result.error}` });
      } else {
        setFeedback({ kind: "success", msg: "Fornecedor aprovado." });
        closeApproveModal();
      }
    });
  };

  const handleReject = (id: string) => {
    const reason = prompt("Motivo da rejeicao:");
    if (!reason || !reason.trim()) return;
    setActingId(id);
    startTransition(async () => {
      const result = await rejectSupplier(id, reason.trim());
      setActingId(null);
      if ("error" in result && result.error) {
        setFeedback({ kind: "error", msg: `Falha ao rejeitar: ${result.error}` });
      } else {
        setFeedback({ kind: "success", msg: "Fornecedor rejeitado." });
      }
    });
  };

  return (
    <div className="space-y-3">
      {feedback ? (
        <p
          className={`text-sm ${feedback.kind === "error" ? "text-destructive" : "text-green-700"}`}
        >
          {feedback.msg}
        </p>
      ) : null}

      {/* Tabs */}
      <div className="flex gap-1 border-b" role="tablist">
        {(Object.keys(TAB_LABELS) as TabKey[]).map((key) => {
          const active = activeTab === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveTab(key)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                active
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {TAB_LABELS[key]}
              <span
                className={`ml-2 inline-flex min-w-[1.5rem] justify-center rounded-full px-1.5 py-0.5 text-xs font-semibold ${
                  active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                }`}
              >
                {counts[key]}
              </span>
            </button>
          );
        })}
      </div>

      {visibleSuppliers.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          Nenhum fornecedor {TAB_LABELS[activeTab].toLowerCase()}.
        </div>
      ) : (
      <div className="rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3">Nome</th>
              <th className="px-4 py-3">CNPJ/CPF</th>
              <th className="px-4 py-3">Tipos de despesa</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">
                {activeTab === "aprovado" ? "Aprovado por" : "Criado em"}
              </th>
              {canApprove ? <th className="px-4 py-3 text-right">Ações</th> : null}
            </tr>
          </thead>
          <tbody>
            {visibleSuppliers.map((s) => {
              const isPendente = s.status === "pendente";
              const isActing = actingId === s.id && isPending;
              const linkedNames = s.expense_type_ids
                .map((id) => expenseTypeMap.get(id))
                .filter(Boolean) as string[];
              return (
                <tr key={s.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-medium">{s.name}</td>
                  <td className="px-4 py-3 font-mono text-muted-foreground">{s.cnpj_cpf ?? "—"}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {linkedNames.length > 0 ? linkedNames.join(", ") : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={s.status} />
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {activeTab === "aprovado" ? (
                      s.approved_at ? (
                        <div className="space-y-0.5">
                          <p className="text-sm text-foreground">
                            {s.approver_name ?? "—"}
                          </p>
                          <p className="text-xs">
                            {new Date(s.approved_at).toLocaleDateString("pt-BR", {
                              day: "2-digit",
                              month: "2-digit",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </p>
                        </div>
                      ) : (
                        "—"
                      )
                    ) : (
                      new Date(s.created_at).toLocaleDateString("pt-BR")
                    )}
                  </td>
                  {canApprove ? (
                    <td className="px-4 py-3">
                      {isPendente ? (
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => openApproveModal(s)}
                            disabled={isActing}
                            className="inline-flex items-center gap-1 rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-50"
                          >
                            {isActing ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <CheckCircle2 className="h-3.5 w-3.5" />
                            )}
                            Aprovar
                          </button>
                          <button
                            type="button"
                            onClick={() => handleReject(s.id)}
                            disabled={isActing}
                            className="inline-flex items-center gap-1 rounded-md border border-destructive/50 px-3 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
                          >
                            <XCircle className="h-3.5 w-3.5" />
                            Rejeitar
                          </button>
                        </div>
                      ) : (
                        <span className="block text-right text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}

      {approveModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl rounded-xl border bg-background shadow-lg">
            <div className="border-b px-6 py-4">
              <h3 className="font-semibold">Aprovar {approveModal.name}</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Revise os dados do fornecedor e vincule ao menos um tipo de despesa.
              </p>
            </div>
            <div className="max-h-[65vh] overflow-y-auto bg-muted/20 px-6 py-5 space-y-4">
              {/* Dados cadastrais */}
              <section className="rounded-lg border bg-background shadow-sm">
                <header className="flex items-center gap-2 border-b px-4 py-2.5">
                  <Contact className="h-4 w-4 text-primary" />
                  <h4 className="text-sm font-semibold">Dados cadastrais</h4>
                </header>
                <dl className="grid grid-cols-1 gap-x-4 gap-y-3 p-4 sm:grid-cols-2 text-sm">
                  <DataField label="Nome" value={approveModal.name} />
                  <DataField label="CNPJ/CPF" value={approveModal.cnpj_cpf} mono />
                  <DataField label="E-mail" value={approveModal.email} />
                  <DataField label="Telefone" value={approveModal.phone} />
                  <DataField
                    label="Origem"
                    value={approveModal.from_omie ? `Omie (ID ${approveModal.omie_id ?? "—"})` : "Cadastro manual"}
                  />
                  <DataField
                    label="Cadastrado em"
                    value={new Date(approveModal.created_at).toLocaleDateString("pt-BR")}
                  />
                </dl>
              </section>

              {/* Dados bancarios */}
              <section className="rounded-lg border bg-background shadow-sm">
                <header className="flex items-center gap-2 border-b px-4 py-2.5">
                  <Banknote className="h-4 w-4 text-primary" />
                  <h4 className="text-sm font-semibold">Dados bancários</h4>
                </header>
                <div className="p-4">
                  {!approveModal.chave_pix &&
                  !approveModal.banco &&
                  !approveModal.agencia &&
                  !approveModal.conta_corrente &&
                  !approveModal.titular_banco ? (
                    <p className="rounded-md border border-dashed bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                      Nenhum dado bancário informado.
                    </p>
                  ) : (
                    <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 text-sm">
                      <DataField label="Chave PIX" value={approveModal.chave_pix} mono />
                      <DataField label="Banco" value={approveModal.banco} />
                      <DataField label="Agência" value={approveModal.agencia} mono />
                      <DataField label="Conta corrente" value={approveModal.conta_corrente} mono />
                      <DataField label="Titular" value={approveModal.titular_banco} />
                      <DataField label="Doc. titular" value={approveModal.doc_titular} mono />
                      <DataField
                        label="Transf. padrão"
                        value={approveModal.transf_padrao ? "Sim" : "Não"}
                      />
                    </dl>
                  )}
                </div>
              </section>

              {/* Tipos de despesa */}
              <section className="rounded-lg border bg-background shadow-sm">
                <header className="flex items-center gap-2 border-b px-4 py-2.5">
                  <Tags className="h-4 w-4 text-primary" />
                  <h4 className="text-sm font-semibold">
                    Tipos de despesa <span className="text-destructive">*</span>
                  </h4>
                </header>
                <div className="p-4">
                  {expenseTypes.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Nenhum tipo de despesa cadastrado. Cadastre em /ctrl/admin antes de aprovar.
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {expenseTypes.map((e) => {
                        const checked = selectedExpenseTypes.has(e.id);
                        return (
                          <label
                            key={e.id}
                            className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted/40"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleExpenseType(e.id)}
                              className="h-4 w-4"
                            />
                            <span>{e.name}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              </section>
            </div>
            <div className="border-t px-6 py-4 flex justify-end gap-3">
              <button
                type="button"
                onClick={closeApproveModal}
                disabled={isPending}
                className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmApprove}
                disabled={isPending || selectedExpenseTypes.size === 0 || expenseTypes.length === 0}
                className="inline-flex items-center gap-1 rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                Confirmar aprovação
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DataField({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | number | null | undefined;
  mono?: boolean;
}) {
  const display =
    value === null || value === undefined || value === "" ? "—" : String(value);
  return (
    <div className="space-y-0.5">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className={mono ? "font-mono text-sm" : "text-sm"}>{display}</dd>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    aprovado: { label: "Aprovado", className: "bg-green-100 text-green-800" },
    rejeitado: { label: "Rejeitado", className: "bg-red-100 text-red-800" },
    pendente: { label: "Pendente", className: "bg-yellow-100 text-yellow-800" },
  };
  const config = map[status] ?? { label: status, className: "bg-gray-100 text-gray-800" };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${config.className}`}>
      {config.label}
    </span>
  );
}
