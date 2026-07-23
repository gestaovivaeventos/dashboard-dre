"use client";

import { AlertTriangle, Loader2, X } from "lucide-react";
import { useState } from "react";

import {
  resolveNamed,
  type RequestDetail,
} from "@/components/ctrl/request-detail-modal";
import { editExpenseRoutingFromContasAPagar } from "@/lib/ctrl/actions/requests";

export interface CadastroOption {
  id: string;
  name: string;
}

// Garante que o vínculo atual apareça no select mesmo se o cadastro estiver
// inativo (e por isso fora da lista de ativos).
function withCurrent(
  options: CadastroOption[],
  currentId: string | null | undefined,
  currentName: string | null,
): CadastroOption[] {
  if (!currentId || options.some((o) => o.id === currentId)) return options;
  return [{ id: currentId, name: currentName ?? "(atual)" }, ...options];
}

// Modal usado na tela de Contas a Pagar para o perfil Contas a Pagar (ou admin)
// CORRIGIR o setor e/ou o tipo de despesa de uma requisição aprovada ANTES do
// envio ao Omie. Ao salvar, a requisição retorna automaticamente ao fluxo de
// aprovação (gerente/diretor) para nova validação. Motivo é obrigatório.
export function EditExpenseRoutingModal({
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
  const [sectorId, setSectorId] = useState(req.sector_id ?? "");
  const [expenseTypeId, setExpenseTypeId] = useState(req.expense_type_id ?? "");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sectorOptions = withCurrent(
    sectors,
    req.sector_id,
    resolveNamed(req.ctrl_sectors ?? null),
  );
  const typeOptions = withCurrent(
    expenseTypes,
    req.expense_type_id,
    resolveNamed(req.ctrl_expense_types),
  );

  const unchanged =
    sectorId === (req.sector_id ?? "") &&
    (expenseTypeId || "") === (req.expense_type_id ?? "");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!sectorId) {
      setError("Selecione o setor.");
      return;
    }
    if (unchanged) {
      setError("Altere o setor e/ou o tipo de despesa.");
      return;
    }
    if (!reason.trim()) {
      setError("Informe o motivo da alteração.");
      return;
    }

    setSaving(true);
    const res = await editExpenseRoutingFromContasAPagar(req.id, {
      sector_id: sectorId,
      expense_type_id: expenseTypeId || null,
      reason: reason.trim(),
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
            <h3 className="font-semibold">
              Editar setor / tipo — requisição #{req.request_number}
            </h3>
            <p className="text-sm text-muted-foreground">
              Correção antes do envio ao Omie
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
          <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Ao salvar, a requisição volta ao fluxo de aprovação (gerente/diretor)
              para nova validação. O orçamento é recalculado com o novo setor/tipo.
            </span>
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

          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              Motivo da alteração <span className="text-destructive">*</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              required
              placeholder="Ex.: categoria informada pelo solicitante estava incorreta."
              className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
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
              Salvar e retornar à aprovação
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
