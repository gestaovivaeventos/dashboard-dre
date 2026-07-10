"use client";

import { AlertTriangle, Loader2, X } from "lucide-react";
import { useState } from "react";

import {
  resolveNamed,
  type RequestDetail,
} from "@/components/ctrl/request-detail-modal";
import {
  deleteRequestByAdmin,
  updateRequestByAdmin,
} from "@/lib/ctrl/actions/request-admin";

export interface CadastroOption {
  id: string;
  name: string;
}

const MONTHS = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

// Garante que o valor atual do vínculo apareça no select, mesmo que o cadastro
// esteja inativo (e por isso fora da lista de ativos).
function withCurrent(
  options: CadastroOption[],
  currentId: string | null | undefined,
  currentName: string | null,
): CadastroOption[] {
  if (!currentId || options.some((o) => o.id === currentId)) return options;
  return [{ id: currentId, name: currentName ?? "(atual)" }, ...options];
}

export function EditRequestModal({
  req,
  sectors,
  expenseTypes,
  onClose,
  onSaved,
}: {
  req: RequestDetail;
  sectors: CadastroOption[];
  expenseTypes: CadastroOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(req.title ?? "");
  const [description, setDescription] = useState(req.description ?? "");
  const [amount, setAmount] = useState(String(req.amount ?? ""));
  const [sectorId, setSectorId] = useState(req.sector_id ?? "");
  const [expenseTypeId, setExpenseTypeId] = useState(req.expense_type_id ?? "");
  const [dueDate, setDueDate] = useState(req.due_date ?? "");
  const [refMonth, setRefMonth] = useState(String(req.reference_month ?? ""));
  const [refYear, setRefYear] = useState(String(req.reference_year ?? ""));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sectorOptions = withCurrent(sectors, req.sector_id, resolveNamed(req.ctrl_sectors ?? null));
  const typeOptions = withCurrent(
    expenseTypes,
    req.expense_type_id,
    resolveNamed(req.ctrl_expense_types),
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const amountNum = parseFloat(amount.replace(",", "."));
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      setError("Informe um valor maior que zero.");
      return;
    }
    if (!sectorId) {
      setError("Selecione o setor.");
      return;
    }
    const monthNum = refMonth ? Number(refMonth) : undefined;
    const yearNum = refYear ? Number(refYear) : undefined;

    setSaving(true);
    const res = await updateRequestByAdmin(req.id, {
      title: title.trim(),
      description: description.trim() || null,
      amount: amountNum,
      sector_id: sectorId,
      expense_type_id: expenseTypeId || null,
      due_date: dueDate || null,
      reference_month: monthNum,
      reference_year: yearNum,
    });
    setSaving(false);

    if (res && "error" in res && res.error) {
      setError(res.error);
      return;
    }
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border bg-background shadow-lg">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h3 className="font-semibold">Editar requisição #{req.request_number}</h3>
            <p className="text-sm text-muted-foreground">
              Edição administrativa — move o orçamento automaticamente
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 px-6 py-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Título</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Descrição</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Valor (R$)</label>
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Vencimento</label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Setor</label>
            <select
              value={sectorId}
              onChange={(e) => setSectorId(e.target.value)}
              required
              className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Selecione…</option>
              {sectorOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Tipo de despesa</label>
            <select
              value={expenseTypeId}
              onChange={(e) => setExpenseTypeId(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Sem categoria</option>
              {typeOptions.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Mês de competência</label>
              <select
                value={refMonth}
                onChange={(e) => setRefMonth(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">—</option>
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Ano de competência</label>
              <input
                type="number"
                value={refYear}
                onChange={(e) => setRefYear(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>

          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Salvar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function DeleteRequestDialog({
  req,
  onClose,
  onDeleted,
}: {
  req: RequestDetail;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [reason, setReason] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setError(null);
    setDeleting(true);
    const res = await deleteRequestByAdmin(req.id, reason.trim() || undefined);
    setDeleting(false);
    if (res && "error" in res && res.error) {
      setError(res.error);
      return;
    }
    onDeleted();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl border bg-background shadow-lg">
        <div className="flex items-center gap-3 border-b px-6 py-4">
          <AlertTriangle className="h-5 w-5 text-destructive" />
          <h3 className="font-semibold">Excluir requisição #{req.request_number}</h3>
        </div>

        <div className="space-y-3 px-6 py-4">
          <p className="text-sm text-muted-foreground">
            A requisição <span className="font-medium text-foreground">{req.title}</span> será
            excluída e sairá das listas e do orçamento. A exclusão é lógica (reversível
            pelo banco) e fica registrada no histórico.
          </p>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Motivo (opcional)</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="Ex.: lançamento em duplicidade"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="inline-flex items-center gap-2 rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-60"
          >
            {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
            Excluir
          </button>
        </div>
      </div>
    </div>
  );
}
