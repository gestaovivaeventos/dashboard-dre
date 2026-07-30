"use client";

import { AlertTriangle, Info, Loader2, X } from "lucide-react";
import { useState } from "react";

import {
  resolveNamed,
  type RequestDetail,
} from "@/components/ctrl/request-detail-modal";
import { editExpenseRoutingFromContasAPagar } from "@/lib/ctrl/actions/requests";
import { nextFaturaDueDate } from "@/lib/ctrl/fatura-cartao";

export interface CadastroOption {
  id: string;
  name: string;
}

const PAYMENT_METHODS: { value: string; label: string }[] = [
  { value: "boleto", label: "Boleto" },
  { value: "pix", label: "PIX" },
  { value: "transferencia", label: "Transferência" },
  { value: "cartao_credito", label: "Cartão de Crédito" },
  { value: "cartao_prepago", label: "Cartão Pré-Pago" },
  { value: "dinheiro", label: "Dinheiro" },
  { value: "pix_copia_cola", label: "PIX Copia e Cola" },
];

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
// CORRIGIR o setor, o tipo de despesa e/ou o MÉTODO DE PAGAMENTO de uma
// requisição aprovada ANTES do envio ao Omie. Mudar setor/tipo devolve a
// requisição à aprovação (recalcula o orçamento); mudar apenas o método NÃO
// exige reaprovação — o valor não muda. Motivo é obrigatório.
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
  const [paymentMethod, setPaymentMethod] = useState(req.payment_method ?? "");
  const [barcode, setBarcode] = useState(req.barcode ?? "");
  const [pixKey, setPixKey] = useState(req.pix_key ?? "");
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

  // Cartão de crédito: o vencimento segue a fatura (próximo dia 05), calculado
  // pelo mesmo ciclo da nova requisição.
  const faturaDueDate = nextFaturaDueDate();
  const isCartaoCredito = paymentMethod === "cartao_credito";

  // Setor/tipo alterados → volta à aprovação (recalcula orçamento).
  const routingWillChange =
    sectorId !== (req.sector_id ?? "") ||
    (expenseTypeId || "") !== (req.expense_type_id ?? "");
  // Método (ou o código do boleto/PIX copia-e-cola, ou o vencimento da fatura) alterado.
  const paymentWillChange =
    (paymentMethod || "") !== (req.payment_method ?? "") ||
    (paymentMethod === "boleto" && (barcode.trim() || "") !== (req.barcode ?? "")) ||
    (paymentMethod === "pix_copia_cola" && (pixKey.trim() || "") !== (req.pix_key ?? "")) ||
    (isCartaoCredito && faturaDueDate !== (req.due_date ?? ""));
  const unchanged = !routingWillChange && !paymentWillChange;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!sectorId) {
      setError("Selecione o setor.");
      return;
    }
    if (unchanged) {
      setError("Nada foi alterado — ajuste o setor, o tipo de despesa ou o método de pagamento.");
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
      payment_method: paymentMethod || undefined,
      barcode: paymentMethod === "boleto" ? barcode.trim() || null : undefined,
      pix_key: paymentMethod === "pix_copia_cola" ? pixKey.trim() || null : undefined,
      // Cartão de crédito: vencimento vira o da próxima fatura (dia 05).
      due_date: isCartaoCredito ? faturaDueDate : undefined,
    });
    setSaving(false);

    if (res && "error" in res && res.error) {
      setError(res.error);
      return;
    }
    onSaved();
  }

  const inputCls =
    "w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border bg-background shadow-lg">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h3 className="font-semibold">
              Editar requisição #{req.request_number}
            </h3>
            <p className="text-sm text-muted-foreground">
              Correção de setor / tipo / método antes do envio ao Omie
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
          {routingWillChange ? (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                A mudança de setor/tipo faz a requisição voltar ao fluxo de aprovação
                (gerente/diretor) para nova validação — o orçamento é recalculado.
              </span>
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800 dark:border-sky-900/40 dark:bg-sky-950/20 dark:text-sky-300">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Alterar apenas o método de pagamento NÃO devolve à aprovação — a
                requisição continua em &quot;Aguardando Envio&quot;.
              </span>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Setor</label>
            <select
              value={sectorId}
              onChange={(e) => setSectorId(e.target.value)}
              required
              className={inputCls}
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
              className={inputCls}
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
            <label className="text-sm font-medium">Método de pagamento</label>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              className={inputCls}
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          {isCartaoCredito && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Vencimento (fatura)</label>
              <input
                value={new Date(faturaDueDate + "T00:00:00").toLocaleDateString("pt-BR")}
                disabled
                className={inputCls + " cursor-not-allowed opacity-70"}
              />
              <p className="text-xs text-muted-foreground">
                Data do vencimento da fatura — calculada automaticamente (não editável).
              </p>
            </div>
          )}

          {paymentMethod === "boleto" && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Código de barras / linha digitável</label>
              <input
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                placeholder="Deixe em branco para pagar manualmente no Omie"
                className={inputCls}
              />
            </div>
          )}

          {paymentMethod === "pix_copia_cola" && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Código PIX copia e cola</label>
              <input
                value={pixKey}
                onChange={(e) => setPixKey(e.target.value)}
                placeholder="Cole o código copia-e-cola (BR Code)"
                className={inputCls}
              />
            </div>
          )}

          {(paymentMethod === "pix" || paymentMethod === "transferencia") && (
            <p className="text-xs text-muted-foreground">
              Os dados de {paymentMethod === "pix" ? "PIX" : "transferência"} usados no
              pagamento vêm do cadastro do fornecedor.
            </p>
          )}

          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              Motivo da alteração <span className="text-destructive">*</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              required
              placeholder="Ex.: método informado pelo solicitante estava incorreto."
              className={inputCls + " resize-none"}
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
              {routingWillChange ? "Salvar e retornar à aprovação" : "Salvar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
