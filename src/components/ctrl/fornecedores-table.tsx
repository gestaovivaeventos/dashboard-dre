"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Banknote, CheckCircle2, Contact, Loader2, Pencil, Tags, X, XCircle } from "lucide-react";

import { approveSupplier, rejectSupplier, updateSupplier } from "@/lib/ctrl/actions/suppliers";
import { BANCOS_BR, PIX_KEY_TYPES, formatBanco } from "@/lib/ctrl/bancos";

interface SupplierRow {
  id: string;
  name: string;
  cnpj_cpf: string | null;
  email: string | null;
  phone: string | null;
  omie_id: number | null;
  from_omie: boolean;
  chave_pix: string | null;
  pix_key_type: string | null;
  banco: string | null;
  agencia: string | null;
  conta_corrente: string | null;
  titular_banco: string | null;
  doc_titular: string | null;
  transf_padrao: boolean;
  pix_padrao: boolean;
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

type TabKey = "aprovado" | "pendente" | "rejeitado";

// Order matters — `Object.keys(TAB_LABELS)` is iterated in insertion order for
// rendering the tabs. Aprovados is first because it's the most consulted state
// in day-to-day operations.
const TAB_LABELS: Record<TabKey, string> = {
  aprovado: "Aprovados",
  pendente: "Pendentes",
  rejeitado: "Rejeitados",
};

const SUPPLIERS_PER_PAGE = 30;

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

  // Detail / edit modal — opened when the user clicks a row.
  const [detailSupplier, setDetailSupplier] = useState<SupplierRow | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState<EditFormState>(emptyEditForm());
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  function openDetail(supplier: SupplierRow) {
    setDetailSupplier(supplier);
    setEditMode(false);
    setEditError(null);
    setEditForm(toEditForm(supplier));
  }

  function closeDetail() {
    setDetailSupplier(null);
    setEditMode(false);
    setEditError(null);
  }

  function startEdit() {
    if (!detailSupplier) return;
    setEditForm(toEditForm(detailSupplier));
    setEditMode(true);
    setEditError(null);
  }

  async function saveEdit() {
    if (!detailSupplier) return;
    if (!editForm.name.trim()) {
      setEditError("O nome do fornecedor é obrigatório.");
      return;
    }
    setEditSaving(true);
    setEditError(null);
    const result = await updateSupplier(detailSupplier.id, {
      name: editForm.name,
      cnpj_cpf: editForm.cnpj_cpf,
      email: editForm.email,
      phone: editForm.phone,
      chave_pix: editForm.chave_pix,
      pix_key_type: editForm.pix_key_type,
      banco: editForm.banco,
      agencia: editForm.agencia,
      conta_corrente: editForm.conta_corrente,
      titular_banco: editForm.titular_banco,
      doc_titular: editForm.doc_titular,
      transf_padrao: editForm.transf_padrao,
      pix_padrao: editForm.pix_padrao,
    });
    setEditSaving(false);
    if ("error" in result && result.error) {
      setEditError(result.error);
      return;
    }
    setFeedback({
      kind: "success",
      msg: "Fornecedor atualizado e marcado como pendente para nova aprovação.",
    });
    closeDetail();
    startTransition(() => {
      // page-level revalidatePath in the action takes care of the data refresh
    });
  }

  const [activeTab, setActiveTab] = useState<TabKey>("aprovado");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

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

  // Suppliers in the active tab, filtered by the free-text search.
  // Search matches on name (case-insensitive substring) OR CNPJ/CPF digits
  // (so the user can type "12.345" or "12345" and both work).
  const filteredSuppliers = useMemo(() => {
    const term = search.trim().toLowerCase();
    const termDigits = term.replace(/\D/g, "");
    return suppliers.filter((s) => {
      if (s.status !== activeTab) return false;
      if (!term) return true;
      if (s.name.toLowerCase().includes(term)) return true;
      if (termDigits && s.cnpj_cpf?.replace(/\D/g, "").includes(termDigits)) return true;
      return false;
    });
  }, [suppliers, activeTab, search]);

  const totalPages = Math.max(1, Math.ceil(filteredSuppliers.length / SUPPLIERS_PER_PAGE));
  // Clamp the page if the dataset shrinks (e.g. filter narrows results).
  const safePage = Math.min(page, totalPages);
  const visibleSuppliers = useMemo(() => {
    const start = (safePage - 1) * SUPPLIERS_PER_PAGE;
    return filteredSuppliers.slice(start, start + SUPPLIERS_PER_PAGE);
  }, [filteredSuppliers, safePage]);

  // Reset to page 1 whenever the active tab or search changes — otherwise the
  // user can find themselves on page 3 of a list that now only has 2 pages.
  useEffect(() => {
    setPage(1);
  }, [activeTab, search]);

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

      {/* Search */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome ou CNPJ/CPF..."
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
          {filteredSuppliers.length} resultado{filteredSuppliers.length === 1 ? "" : "s"}
        </p>
      </div>

      {visibleSuppliers.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {search
            ? `Nenhum fornecedor ${TAB_LABELS[activeTab].toLowerCase()} encontrado para "${search}".`
            : `Nenhum fornecedor ${TAB_LABELS[activeTab].toLowerCase()}.`}
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
                <tr
                  key={s.id}
                  className="cursor-pointer border-b last:border-0 hover:bg-muted/30 transition-colors"
                  onClick={() => openDetail(s)}
                >
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
                    <td
                      className="px-4 py-3"
                      onClick={(e) => e.stopPropagation()}
                    >
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

      {/* Pagination — shown only when there are multiple pages of results */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-3 text-sm">
          <p className="text-muted-foreground">
            Página {safePage} de {totalPages} ·{" "}
            {(safePage - 1) * SUPPLIERS_PER_PAGE + 1}–
            {Math.min(safePage * SUPPLIERS_PER_PAGE, filteredSuppliers.length)} de{" "}
            {filteredSuppliers.length}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={safePage <= 1}
              className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Anterior
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage >= totalPages}
              className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Próxima
            </button>
          </div>
        </div>
      )}

      {/* Detail / edit modal — opens on row click */}
      {detailSupplier ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !editSaving && closeDetail()}
        >
          <div
            className="w-full max-w-2xl rounded-xl border bg-background shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b px-6 py-4 flex items-start justify-between gap-4">
              <div>
                <h3 className="font-semibold">{detailSupplier.name}</h3>
                <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <StatusBadge status={detailSupplier.status} />
                  {detailSupplier.from_omie ? (
                    <span>Origem Omie (ID {detailSupplier.omie_id ?? "—"})</span>
                  ) : (
                    <span>Cadastro manual</span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={closeDetail}
                disabled={editSaving}
                aria-label="Fechar"
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-[65vh] overflow-y-auto bg-muted/20 px-6 py-5 space-y-4">
              {editError && (
                <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {editError}
                </p>
              )}

              {/* Dados cadastrais */}
              <section className="rounded-lg border bg-background shadow-sm">
                <header className="flex items-center gap-2 border-b px-4 py-2.5">
                  <Contact className="h-4 w-4 text-primary" />
                  <h4 className="text-sm font-semibold">Dados cadastrais</h4>
                </header>
                {editMode ? (
                  <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
                    <EditField label="Nome *" value={editForm.name} onChange={(v) => setEditForm({ ...editForm, name: v })} />
                    <EditField label="CNPJ/CPF" value={editForm.cnpj_cpf} onChange={(v) => setEditForm({ ...editForm, cnpj_cpf: v })} mono />
                    <EditField label="E-mail" value={editForm.email} onChange={(v) => setEditForm({ ...editForm, email: v })} />
                    <EditField label="Telefone" value={editForm.phone} onChange={(v) => setEditForm({ ...editForm, phone: v })} />
                  </div>
                ) : (
                  <dl className="grid grid-cols-1 gap-x-4 gap-y-3 p-4 sm:grid-cols-2 text-sm">
                    <DataField label="Nome" value={detailSupplier.name} />
                    <DataField label="CNPJ/CPF" value={detailSupplier.cnpj_cpf} mono />
                    <DataField label="E-mail" value={detailSupplier.email} />
                    <DataField label="Telefone" value={detailSupplier.phone} />
                    <DataField
                      label="Cadastrado em"
                      value={new Date(detailSupplier.created_at).toLocaleDateString("pt-BR")}
                    />
                    {detailSupplier.status === "aprovado" && detailSupplier.approved_at && (
                      <DataField
                        label="Aprovado em"
                        value={`${new Date(detailSupplier.approved_at).toLocaleDateString("pt-BR")} por ${detailSupplier.approver_name ?? "—"}`}
                      />
                    )}
                    {detailSupplier.status === "rejeitado" && detailSupplier.rejection_reason && (
                      <DataField label="Motivo da rejeição" value={detailSupplier.rejection_reason} />
                    )}
                  </dl>
                )}
              </section>

              {/* Dados bancários */}
              <section className="rounded-lg border bg-background shadow-sm">
                <header className="flex items-center gap-2 border-b px-4 py-2.5">
                  <Banknote className="h-4 w-4 text-primary" />
                  <h4 className="text-sm font-semibold">Dados bancários</h4>
                </header>
                {editMode ? (
                  <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
                    <EditSelect
                      label="Tipo da chave PIX"
                      value={editForm.pix_key_type}
                      onChange={(v) => setEditForm({ ...editForm, pix_key_type: v })}
                      options={[
                        { value: "", label: "Selecione" },
                        ...PIX_KEY_TYPES.map((p) => ({ value: p.value, label: p.label })),
                      ]}
                    />
                    <EditField
                      label="Chave PIX"
                      value={editForm.chave_pix}
                      onChange={(v) => setEditForm({ ...editForm, chave_pix: v })}
                      mono
                    />
                    <EditSelect
                      label="Banco"
                      value={editForm.banco}
                      onChange={(v) => setEditForm({ ...editForm, banco: v })}
                      fullWidth
                      options={[
                        { value: "", label: "Selecione o banco" },
                        // Mantém o valor armazenado mesmo se não estiver na lista atual
                        ...(editForm.banco && !BANCOS_BR.some((b) => formatBanco(b) === editForm.banco)
                          ? [{ value: editForm.banco, label: editForm.banco }]
                          : []),
                        ...BANCOS_BR.map((b) => ({
                          value: formatBanco(b),
                          label: formatBanco(b),
                        })),
                      ]}
                    />
                    <EditField label="Agência" value={editForm.agencia} onChange={(v) => setEditForm({ ...editForm, agencia: v })} mono />
                    <EditField label="Conta corrente" value={editForm.conta_corrente} onChange={(v) => setEditForm({ ...editForm, conta_corrente: v })} mono />
                    <EditField label="Titular" value={editForm.titular_banco} onChange={(v) => setEditForm({ ...editForm, titular_banco: v })} />
                    <EditField label="Doc. titular" value={editForm.doc_titular} onChange={(v) => setEditForm({ ...editForm, doc_titular: v })} mono />
                    <label className="flex items-center gap-2 text-sm sm:col-span-2">
                      <input
                        type="checkbox"
                        checked={editForm.pix_padrao}
                        onChange={(e) => setEditForm({ ...editForm, pix_padrao: e.target.checked })}
                        disabled={!editForm.chave_pix.trim()}
                        className="h-4 w-4 disabled:opacity-50"
                      />
                      Usar PIX como método padrão
                    </label>
                    <label className="flex items-center gap-2 text-sm sm:col-span-2">
                      <input
                        type="checkbox"
                        checked={editForm.transf_padrao}
                        onChange={(e) => setEditForm({ ...editForm, transf_padrao: e.target.checked })}
                        className="h-4 w-4"
                      />
                      Usar transferência como método padrão
                    </label>
                  </div>
                ) : (
                  <div className="p-4">
                    {!detailSupplier.chave_pix &&
                    !detailSupplier.banco &&
                    !detailSupplier.agencia &&
                    !detailSupplier.conta_corrente &&
                    !detailSupplier.titular_banco ? (
                      <p className="rounded-md border border-dashed bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                        Nenhum dado bancário informado.
                      </p>
                    ) : (
                      <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 text-sm">
                        <DataField
                          label="Tipo Chave PIX"
                          value={
                            detailSupplier.pix_key_type
                              ? PIX_KEY_TYPES.find((p) => p.value === detailSupplier.pix_key_type)?.label ??
                                detailSupplier.pix_key_type
                              : null
                          }
                        />
                        <DataField label="Chave PIX" value={detailSupplier.chave_pix} mono />
                        <DataField label="Banco" value={detailSupplier.banco} />
                        <DataField label="Agência" value={detailSupplier.agencia} mono />
                        <DataField label="Conta corrente" value={detailSupplier.conta_corrente} mono />
                        <DataField label="Titular" value={detailSupplier.titular_banco} />
                        <DataField label="Doc. titular" value={detailSupplier.doc_titular} mono />
                        <DataField
                          label="PIX padrão"
                          value={detailSupplier.pix_padrao ? "Sim" : "Não"}
                        />
                        <DataField
                          label="Transf. padrão"
                          value={detailSupplier.transf_padrao ? "Sim" : "Não"}
                        />
                      </dl>
                    )}
                  </div>
                )}
              </section>

              {/* Tipos de despesa vinculados (somente leitura) */}
              <section className="rounded-lg border bg-background shadow-sm">
                <header className="flex items-center gap-2 border-b px-4 py-2.5">
                  <Tags className="h-4 w-4 text-primary" />
                  <h4 className="text-sm font-semibold">Tipos de despesa vinculados</h4>
                </header>
                <div className="p-4 text-sm">
                  {detailSupplier.expense_type_ids.length === 0 ? (
                    <p className="text-muted-foreground">Nenhum tipo vinculado.</p>
                  ) : (
                    <ul className="flex flex-wrap gap-2">
                      {detailSupplier.expense_type_ids.map((id) => (
                        <li
                          key={id}
                          className="rounded-full border bg-muted/40 px-2 py-0.5 text-xs"
                        >
                          {expenseTypeMap.get(id) ?? id}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>

              {editMode && (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300">
                  Ao salvar, o fornecedor voltará a <strong>pendente</strong> e precisará
                  ser aprovado novamente pelo CSC.
                </p>
              )}
            </div>

            <div className="border-t px-6 py-4 flex justify-between gap-3">
              {editMode ? (
                <>
                  <button
                    type="button"
                    onClick={() => setEditMode(false)}
                    disabled={editSaving}
                    className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
                  >
                    Cancelar edição
                  </button>
                  <button
                    type="button"
                    onClick={saveEdit}
                    disabled={editSaving}
                    className="inline-flex items-center gap-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    {editSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Salvar (volta a pendente)
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={closeDetail}
                    className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
                  >
                    Fechar
                  </button>
                  <button
                    type="button"
                    onClick={startEdit}
                    className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                  >
                    <Pencil className="h-4 w-4" />
                    Editar
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}

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
                        label="PIX padrão"
                        value={approveModal.pix_padrao ? "Sim" : "Não"}
                      />
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

// ── Edit form state helpers ────────────────────────────────────────────────

interface EditFormState {
  name: string;
  cnpj_cpf: string;
  email: string;
  phone: string;
  chave_pix: string;
  pix_key_type: string;
  banco: string;
  agencia: string;
  conta_corrente: string;
  titular_banco: string;
  doc_titular: string;
  transf_padrao: boolean;
  pix_padrao: boolean;
}

function emptyEditForm(): EditFormState {
  return {
    name: "",
    cnpj_cpf: "",
    email: "",
    phone: "",
    chave_pix: "",
    pix_key_type: "",
    banco: "",
    agencia: "",
    conta_corrente: "",
    titular_banco: "",
    doc_titular: "",
    transf_padrao: false,
    pix_padrao: false,
  };
}

function toEditForm(s: SupplierRow): EditFormState {
  return {
    name: s.name ?? "",
    cnpj_cpf: s.cnpj_cpf ?? "",
    email: s.email ?? "",
    phone: s.phone ?? "",
    chave_pix: s.chave_pix ?? "",
    pix_key_type: s.pix_key_type ?? "",
    banco: s.banco ?? "",
    agencia: s.agencia ?? "",
    conta_corrente: s.conta_corrente ?? "",
    titular_banco: s.titular_banco ?? "",
    doc_titular: s.doc_titular ?? "",
    transf_padrao: !!s.transf_padrao,
    pix_padrao: !!s.pix_padrao,
  };
}

function EditField({
  label,
  value,
  onChange,
  mono,
  fullWidth,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  mono?: boolean;
  fullWidth?: boolean;
}) {
  return (
    <div className={`space-y-1 ${fullWidth ? "sm:col-span-2" : ""}`}>
      <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring ${
          mono ? "font-mono" : ""
        }`}
      />
    </div>
  );
}

function EditSelect({
  label,
  value,
  onChange,
  options,
  fullWidth,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  fullWidth?: boolean;
}) {
  return (
    <div className={`space-y-1 ${fullWidth ? "sm:col-span-2" : ""}`}>
      <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
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
