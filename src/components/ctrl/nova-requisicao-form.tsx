"use client";

import { useRouter } from "next/navigation";
import { useState, useMemo, useEffect } from "react";
import { AlertTriangle, CheckCircle2, Zap } from "lucide-react";

import { createRequest, verifyBudget } from "@/lib/ctrl/actions/requests";
import type { BudgetVerification } from "@/lib/ctrl/actions/requests";
import type { CtrlEvent, CtrlExpenseType, CtrlSector, CtrlSupplier } from "@/lib/supabase/types";

const MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

const INPUT_CLS =
  "w-full rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background focus:ring-2 focus:ring-ring focus:ring-offset-2";
const LABEL_CLS = "text-sm font-medium";

const fmt = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

interface Props {
  sectors: CtrlSector[];
  expenseTypes: CtrlExpenseType[];
  suppliers: CtrlSupplier[];
  events?: CtrlEvent[];
}

export function NovaRequisicaoForm({ sectors, expenseTypes, suppliers, events = [] }: Props) {
  const router = useRouter();
  const now = new Date();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // ── Fields that drive budget verification (controlled) ──────────────────────
  const [sectorId, setSectorId] = useState("");
  const [expenseTypeId, setExpenseTypeId] = useState("");
  const [amountStr, setAmountStr] = useState("");
  const [refMonth, setRefMonth] = useState(now.getMonth() + 1);
  const [refYear, setRefYear] = useState(now.getFullYear());

  // ── Supplier selection ───────────────────────────────────────────────────────
  const [selectedSupplierId, setSelectedSupplierId] = useState("");

  // ── Payment fields — auto-filled from supplier, still editable ──────────────
  const [favorecido, setFavorecido] = useState("");
  const [bankCpfCnpj, setBankCpfCnpj] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankAgency, setBankAgency] = useState("");
  const [bankAccount, setBankAccount] = useState("");
  const [bankAccountDigit, setBankAccountDigit] = useState("");
  const [pixKey, setPixKey] = useState("");
  const [pixKeyType, setPixKeyType] = useState("");

  // ── Payment method ───────────────────────────────────────────────────────────
  const [paymentMethod, setPaymentMethod] = useState("boleto");
  const [installments, setInstallments] = useState(1);

  // ── Due date (controlled for recurrence constraints) ─────────────────────────
  const [dueDate, setDueDate] = useState("");

  // ── Recurrence ───────────────────────────────────────────────────────────────
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurMonths, setRecurMonths] = useState<number[]>([]);

  // ── Budget verification ──────────────────────────────────────────────────────
  const [verifying, setVerifying] = useState(false);
  const [verification, setVerification] = useState<BudgetVerification | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  // ── Derived values ───────────────────────────────────────────────────────────

  const parsedAmount = useMemo(() => {
    const n = parseFloat(amountStr.replace(",", "."));
    return isNaN(n) ? 0 : n;
  }, [amountStr]);

  const selectedSupplier = useMemo(
    () => suppliers.find((s) => s.id === selectedSupplierId) ?? null,
    [selectedSupplierId, suppliers]
  );

  const dueDateMonth = useMemo(() => {
    if (!dueDate) return null;
    return new Date(dueDate + "T00:00:00").getMonth() + 1;
  }, [dueDate]);

  const availableMethods = useMemo(() => {
    const avail = new Set(["boleto", "cartao_credito", "dinheiro"]);
    if (!selectedSupplier || selectedSupplier.chave_pix) avail.add("pix");
    if (!selectedSupplier || (selectedSupplier.banco && selectedSupplier.conta_corrente)) avail.add("transferencia");
    return avail;
  }, [selectedSupplier]);

  const recurrenceDisabled = paymentMethod === "cartao_credito" && installments >= 2;

  // Budget check is only required when an expense type is selected
  const needsVerification = !!expenseTypeId;
  const canVerify = !!sectorId && !!expenseTypeId && parsedAmount > 0;
  const canSubmit = !needsVerification || !!verification;

  // Justification required when verification says nivel_3
  const justificationRequired = verification?.justificationRequired ?? false;

  // ── Effects ──────────────────────────────────────────────────────────────────

  // Reset verification whenever budget-relevant fields change
  useEffect(() => {
    setVerification(null);
    setVerifyError(null);
  }, [sectorId, expenseTypeId, amountStr, refMonth, refYear]);

  // Clear recurrence when incompatible with installments
  useEffect(() => {
    if (recurrenceDisabled && isRecurring) {
      setIsRecurring(false);
      setRecurMonths([]);
    }
  }, [recurrenceDisabled, isRecurring]);

  // Remove months that become invalid when due date changes
  useEffect(() => {
    if (dueDateMonth !== null) {
      setRecurMonths((prev) => prev.filter((m) => m > dueDateMonth));
    }
  }, [dueDateMonth]);

  // ── Handlers ─────────────────────────────────────────────────────────────────

  function handleSupplierChange(suppId: string) {
    setSelectedSupplierId(suppId);
    const sup = suppliers.find((s) => s.id === suppId) ?? null;
    if (!sup) {
      setFavorecido(""); setBankCpfCnpj(""); setBankName(""); setBankAgency("");
      setBankAccount(""); setBankAccountDigit(""); setPixKey(""); setPixKeyType("");
      return;
    }
    setFavorecido(sup.titular_banco ?? sup.name ?? "");
    setBankCpfCnpj(sup.doc_titular ?? sup.cnpj_cpf ?? "");
    setBankName(sup.banco ?? "");
    setBankAgency(sup.agencia ?? "");
    if (sup.conta_corrente) {
      const parts = sup.conta_corrente.split("-");
      setBankAccount(parts[0]?.trim() ?? "");
      setBankAccountDigit(parts[1]?.trim() ?? "");
    } else {
      setBankAccount(""); setBankAccountDigit("");
    }
    setPixKey(sup.chave_pix ?? "");
    setPixKeyType("");

    const newAvail = new Set(["boleto", "cartao_credito", "dinheiro"]);
    if (sup.chave_pix) newAvail.add("pix");
    if (sup.banco && sup.conta_corrente) newAvail.add("transferencia");
    if (!newAvail.has(paymentMethod)) { setPaymentMethod("boleto"); setInstallments(1); }
  }

  async function handleVerify() {
    if (!canVerify) return;
    setVerifying(true);
    setVerifyError(null);
    setVerification(null);
    const result = await verifyBudget(sectorId, expenseTypeId, parsedAmount, refMonth, refYear);
    setVerifying(false);
    if ("error" in result) { setVerifyError(result.error); return; }
    setVerification(result);
  }

  function toggleRecurMonth(m: number) {
    setRecurMonths((prev) => prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    setSuccessMsg(null);

    const form = new FormData(e.currentTarget);

    const result = await createRequest({
      title: form.get("title") as string,
      description: (form.get("description") as string) || undefined,
      sector_id: sectorId,
      expense_type_id: expenseTypeId || undefined,
      supplier_id: selectedSupplierId || undefined,
      amount: parsedAmount,
      due_date: dueDate || undefined,
      reference_month: refMonth,
      reference_year: refYear,
      payment_method: paymentMethod as "boleto" | "pix" | "transferencia" | "cartao_credito" | "dinheiro",
      justification: (form.get("justification") as string) || undefined,
      observations: (form.get("observations") as string) || undefined,
      event_id: (form.get("event_id") as string) || undefined,
      supplier_issues_invoice: (form.get("supplier_issues_invoice") as string) || undefined,
      bank_name: bankName || undefined,
      bank_agency: bankAgency || undefined,
      bank_account: bankAccount || undefined,
      bank_account_digit: bankAccountDigit || undefined,
      bank_cpf_cnpj: bankCpfCnpj || undefined,
      pix_key: pixKey || undefined,
      pix_key_type: pixKeyType || undefined,
      favorecido: favorecido || undefined,
      barcode: (form.get("barcode") as string) || undefined,
      installments: paymentMethod === "cartao_credito" ? installments : undefined,
      is_recurring: isRecurring,
      recurrence_months: isRecurring ? recurMonths : undefined,
    });

    setLoading(false);

    if ("error" in result && result.error) {
      setError(result.error);
      return;
    }

    const r = result as { totalCreated?: number; autoApproved?: boolean; requestNumber?: number };
    const msg = r.autoApproved
      ? `Requisição #${r.requestNumber} aprovada automaticamente!`
      : r.totalCreated && r.totalCreated > 1
      ? `${r.totalCreated} requisições criadas com sucesso.`
      : `Requisição #${r.requestNumber} criada e enviada para aprovação.`;
    setSuccessMsg(msg);
    setTimeout(() => { router.push("/ctrl/requisicoes"); router.refresh(); }, 1500);
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>
      )}
      {successMsg && (
        <div className="rounded-md bg-green-50 px-4 py-3 text-sm text-green-800 dark:bg-green-950/30 dark:text-green-300">
          {successMsg}
        </div>
      )}

      {/* Título */}
      <div className="space-y-1.5">
        <label htmlFor="title" className={LABEL_CLS}>
          Título <span className="text-destructive">*</span>
        </label>
        <input id="title" name="title" type="text" required placeholder="Ex: Pagamento de serviço de limpeza" className={INPUT_CLS} />
      </div>

      {/* Descrição */}
      <div className="space-y-1.5">
        <label htmlFor="description" className={LABEL_CLS}>Descrição</label>
        <textarea id="description" name="description" rows={2} placeholder="Detalhes adicionais..." className={`${INPUT_CLS} resize-none`} />
      </div>

      {/* Setor + Tipo de Despesa */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="sector_id" className={LABEL_CLS}>
            Setor <span className="text-destructive">*</span>
          </label>
          <select
            id="sector_id"
            name="sector_id"
            required
            value={sectorId}
            onChange={(e) => setSectorId(e.target.value)}
            className={INPUT_CLS}
          >
            <option value="">Selecione o setor</option>
            {sectors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="expense_type_id" className={LABEL_CLS}>Tipo de Despesa</label>
          <select
            id="expense_type_id"
            name="expense_type_id"
            value={expenseTypeId}
            onChange={(e) => setExpenseTypeId(e.target.value)}
            className={INPUT_CLS}
          >
            <option value="">Selecione (opcional)</option>
            {expenseTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      </div>

      {/* Fornecedor */}
      <div className="space-y-1.5">
        <label htmlFor="supplier_id" className={LABEL_CLS}>Fornecedor</label>
        <select
          id="supplier_id"
          name="supplier_id"
          value={selectedSupplierId}
          onChange={(e) => handleSupplierChange(e.target.value)}
          className={INPUT_CLS}
        >
          <option value="">Sem fornecedor</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}{s.cnpj_cpf ? ` — ${s.cnpj_cpf}` : ""}
              {s.status === "pendente" ? " (pendente)" : ""}
            </option>
          ))}
        </select>
        {selectedSupplier?.status === "pendente" && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            Este fornecedor está aguardando aprovação. A requisição ficará bloqueada até a aprovação.
          </p>
        )}
      </div>

      {/* Evento */}
      {events.length > 0 && (
        <div className="space-y-1.5">
          <label htmlFor="event_id" className={LABEL_CLS}>Evento</label>
          <select id="event_id" name="event_id" className={INPUT_CLS}>
            <option value="">Nenhum evento</option>
            {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
          </select>
        </div>
      )}

      {/* Valor + Vencimento */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="amount" className={LABEL_CLS}>
            Valor (R$) <span className="text-destructive">*</span>
          </label>
          <input
            id="amount"
            name="amount"
            type="text"
            inputMode="decimal"
            required
            placeholder="0,00"
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
            className={INPUT_CLS}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="due_date" className={LABEL_CLS}>Data de Vencimento</label>
          <input
            id="due_date"
            name="due_date"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className={INPUT_CLS}
          />
        </div>
      </div>

      {/* Mês/Ano referência */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label className={LABEL_CLS}>Mês de Referência <span className="text-destructive">*</span></label>
          <select value={refMonth} onChange={(e) => setRefMonth(Number(e.target.value))} className={INPUT_CLS}>
            {MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className={LABEL_CLS}>Ano de Referência <span className="text-destructive">*</span></label>
          <select value={refYear} onChange={(e) => setRefYear(Number(e.target.value))} className={INPUT_CLS}>
            {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
      </div>

      {/* ── Verificação Orçamentária ─────────────────────────────────────────── */}
      {needsVerification && (
        <div className="space-y-3 rounded-lg border p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Verificação Orçamentária</p>
              <p className="text-xs text-muted-foreground">
                Consulta o saldo disponível para este setor e tipo de despesa antes de enviar.
              </p>
            </div>
            <button
              type="button"
              onClick={handleVerify}
              disabled={!canVerify || verifying}
              className="shrink-0 rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {verifying ? "Verificando..." : verification ? "Reverificar" : "Verificar Orçamento"}
            </button>
          </div>

          {verifyError && (
            <p className="text-sm text-destructive">{verifyError}</p>
          )}

          {verification && (
            <div className={`rounded-lg p-4 ring-1 space-y-3 ${
              verification.autoApproved
                ? "bg-green-50 ring-green-200 dark:bg-green-950/20 dark:ring-green-800"
                : verification.approvalTier === "nivel_3"
                ? "bg-red-50 ring-red-200 dark:bg-red-950/20 dark:ring-red-800"
                : "bg-amber-50 ring-amber-200 dark:bg-amber-950/20 dark:ring-amber-800"
            }`}>

              {/* Status header */}
              <div className="flex items-center gap-2">
                {verification.autoApproved ? (
                  <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400 shrink-0" />
                ) : (
                  <AlertTriangle className={`h-5 w-5 shrink-0 ${verification.approvalTier === "nivel_3" ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"}`} />
                )}
                <span className={`text-sm font-bold ${
                  verification.autoApproved
                    ? "text-green-700 dark:text-green-300"
                    : verification.approvalTier === "nivel_3"
                    ? "text-red-700 dark:text-red-300"
                    : "text-amber-700 dark:text-amber-300"
                }`}>
                  {verification.statusLabel}
                </span>
                {verification.autoApproved && (
                  <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-bold text-green-700 ring-1 ring-green-300 dark:bg-green-900/40 dark:text-green-300">
                    <Zap className="h-3 w-3" />
                    Aprovação automática
                  </span>
                )}
              </div>

              {/* Budget breakdown */}
              <div className="rounded-md bg-white/70 dark:bg-background/50 p-3 text-xs">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                  <span className="text-muted-foreground">Orçamento até o mês:</span>
                  <span className="font-semibold text-right">{fmt.format(verification.budgetedUpToMonth)}</span>
                  <span className="text-muted-foreground">Orçamento anual:</span>
                  <span className="font-semibold text-right">{fmt.format(verification.budgetedAnnual)}</span>
                  <span className="text-muted-foreground">Total aprovado no ano:</span>
                  <span className="font-semibold text-right">{fmt.format(verification.totalApproved)}</span>
                </div>
                <div className="my-2 border-t" />
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                  <span className="font-medium">Saldo Atual:</span>
                  <span className={`font-bold text-right ${verification.currentBalance >= 0 ? "text-green-600" : "text-red-600"}`}>
                    {fmt.format(verification.currentBalance)}
                  </span>
                  <span className="font-medium">Saldo Futuro (anual):</span>
                  <span className={`font-bold text-right ${verification.futureBalance >= 0 ? "text-green-600" : "text-red-600"}`}>
                    {fmt.format(verification.futureBalance)}
                  </span>
                </div>
              </div>

              {!verification.isBudgeted && (
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  Nenhum orçamento cadastrado para este tipo de despesa neste setor.
                </p>
              )}

              {verification.approvalTier === "nivel_3" && (
                <p className="text-xs text-red-700 dark:text-red-300 font-medium">
                  Saldo anual insuficiente — requer aprovação do Diretor e justificativa obrigatória.
                </p>
              )}
              {!verification.autoApproved && verification.approvalTier === "nivel_2" && (
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  Saldo atual insuficiente, mas o saldo futuro cobre o valor — requer aprovação do Gerente.
                </p>
              )}
            </div>
          )}

          {!verification && !verifyError && canVerify && (
            <p className="text-xs text-muted-foreground">
              Clique em &quot;Verificar Orçamento&quot; para consultar o saldo antes de enviar.
            </p>
          )}
          {!canVerify && (
            <p className="text-xs text-muted-foreground">
              Preencha setor, tipo de despesa e valor para habilitar a verificação.
            </p>
          )}
        </div>
      )}

      {/* Método de pagamento */}
      <div className="space-y-1.5">
        <label className={LABEL_CLS}>Método de Pagamento <span className="text-destructive">*</span></label>
        <div className="flex flex-wrap gap-2">
          {[
            { value: "boleto", label: "Boleto" },
            { value: "pix", label: "PIX" },
            { value: "transferencia", label: "Transferência" },
            { value: "cartao_credito", label: "Cartão de Crédito" },
            { value: "dinheiro", label: "Dinheiro" },
          ].map((opt) => {
            const unavailable = selectedSupplier && !availableMethods.has(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => { if (!unavailable) { setPaymentMethod(opt.value); setInstallments(1); } }}
                disabled={!!unavailable}
                title={unavailable ? "Fornecedor não possui dados para este método" : undefined}
                className={`rounded-full border px-3 py-1 text-sm font-medium transition-colors ${
                  paymentMethod === opt.value
                    ? "bg-violet-600 text-white border-violet-600"
                    : unavailable
                    ? "opacity-40 cursor-not-allowed bg-background text-muted-foreground"
                    : "bg-background text-muted-foreground hover:bg-muted"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        {selectedSupplier && (
          <p className="text-xs text-muted-foreground">
            {selectedSupplier.chave_pix && selectedSupplier.banco
              ? "Fornecedor possui PIX e dados bancários."
              : selectedSupplier.chave_pix
              ? "Fornecedor possui apenas PIX."
              : selectedSupplier.banco
              ? "Fornecedor possui apenas dados bancários."
              : "Fornecedor sem dados de pagamento cadastrados."}
          </p>
        )}
      </div>

      {/* PIX */}
      {paymentMethod === "pix" && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 rounded-lg border bg-muted/20 p-4">
          <div className="space-y-1.5">
            <label htmlFor="pix_key_type" className={LABEL_CLS}>Tipo de Chave PIX</label>
            <select id="pix_key_type" name="pix_key_type" value={pixKeyType} onChange={(e) => setPixKeyType(e.target.value)} className={INPUT_CLS}>
              <option value="">Selecione</option>
              <option value="cpf">CPF</option>
              <option value="cnpj">CNPJ</option>
              <option value="email">E-mail</option>
              <option value="telefone">Telefone</option>
              <option value="aleatoria">Chave Aleatória</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="pix_key" className={LABEL_CLS}>Chave PIX</label>
            <input id="pix_key" name="pix_key" type="text" value={pixKey} onChange={(e) => setPixKey(e.target.value)} placeholder="Informe a chave" className={INPUT_CLS} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="favorecido" className={LABEL_CLS}>Favorecido</label>
            <input id="favorecido" name="favorecido" type="text" value={favorecido} onChange={(e) => setFavorecido(e.target.value)} placeholder="Nome do favorecido" className={INPUT_CLS} />
          </div>
        </div>
      )}

      {/* Transferência */}
      {paymentMethod === "transferencia" && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 rounded-lg border bg-muted/20 p-4">
          <div className="space-y-1.5 sm:col-span-2">
            <label htmlFor="favorecido" className={LABEL_CLS}>Favorecido</label>
            <input id="favorecido" name="favorecido" type="text" value={favorecido} onChange={(e) => setFavorecido(e.target.value)} placeholder="Nome do favorecido" className={INPUT_CLS} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="bank_cpf_cnpj" className={LABEL_CLS}>CPF/CNPJ</label>
            <input id="bank_cpf_cnpj" name="bank_cpf_cnpj" type="text" value={bankCpfCnpj} onChange={(e) => setBankCpfCnpj(e.target.value)} placeholder="000.000.000-00" className={INPUT_CLS} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="bank_name" className={LABEL_CLS}>Banco</label>
            <input id="bank_name" name="bank_name" type="text" value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="Ex: Banco do Brasil" className={INPUT_CLS} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="bank_agency" className={LABEL_CLS}>Agência</label>
            <input id="bank_agency" name="bank_agency" type="text" value={bankAgency} onChange={(e) => setBankAgency(e.target.value)} placeholder="0000" className={INPUT_CLS} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="bank_account" className={LABEL_CLS}>Conta</label>
            <input id="bank_account" name="bank_account" type="text" value={bankAccount} onChange={(e) => setBankAccount(e.target.value)} placeholder="00000" className={INPUT_CLS} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="bank_account_digit" className={LABEL_CLS}>Dígito</label>
            <input id="bank_account_digit" name="bank_account_digit" type="text" value={bankAccountDigit} onChange={(e) => setBankAccountDigit(e.target.value)} placeholder="0" className={INPUT_CLS} />
          </div>
        </div>
      )}

      {/* Boleto */}
      {paymentMethod === "boleto" && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 rounded-lg border bg-muted/20 p-4">
          <div className="space-y-1.5">
            <label htmlFor="favorecido" className={LABEL_CLS}>Favorecido</label>
            <input id="favorecido" name="favorecido" type="text" value={favorecido} onChange={(e) => setFavorecido(e.target.value)} placeholder="Nome do favorecido" className={INPUT_CLS} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="bank_cpf_cnpj" className={LABEL_CLS}>CPF/CNPJ</label>
            <input id="bank_cpf_cnpj" name="bank_cpf_cnpj" type="text" value={bankCpfCnpj} onChange={(e) => setBankCpfCnpj(e.target.value)} placeholder="000.000.000-00" className={INPUT_CLS} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <label htmlFor="barcode" className={LABEL_CLS}>Linha Digitável / Código de Barras</label>
            <input id="barcode" name="barcode" type="text" placeholder="000000000000000000000000000000000000" className={INPUT_CLS} />
          </div>
        </div>
      )}

      {/* Cartão de Crédito */}
      {paymentMethod === "cartao_credito" && (
        <div className="rounded-lg border bg-muted/20 p-4 space-y-4">
          <div className="space-y-1.5">
            <label className={LABEL_CLS}>Número de Parcelas</label>
            <div className="flex flex-wrap gap-2">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setInstallments(n)}
                  className={`rounded-full border px-3 py-1 text-sm font-medium transition-colors ${
                    installments === n ? "bg-violet-600 text-white border-violet-600" : "bg-background text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {n}x
                </button>
              ))}
            </div>
            {installments > 1 && (
              <p className="text-xs text-muted-foreground mt-1">
                Serão criadas {installments} requisições, vencimentos no dia 5 de cada mês.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Fornecedor emite nota? */}
      <div className="space-y-1.5">
        <label htmlFor="supplier_issues_invoice" className={LABEL_CLS}>O fornecedor emite nota fiscal?</label>
        <select id="supplier_issues_invoice" name="supplier_issues_invoice" className={INPUT_CLS}>
          <option value="">Não informado</option>
          <option value="sim">Sim</option>
          <option value="nao">Não</option>
          <option value="nao_sei">Não sei</option>
        </select>
      </div>

      {/* Observações */}
      <div className="space-y-1.5">
        <label htmlFor="observations" className={LABEL_CLS}>Observações</label>
        <textarea id="observations" name="observations" rows={2} placeholder="Informações adicionais para o aprovador..." className={`${INPUT_CLS} resize-none`} />
      </div>

      {/* Justificativa — exibida proativamente quando nivel_3 */}
      {justificationRequired && (
        <div className="space-y-1.5 rounded-lg border border-red-300 bg-red-50 p-4 dark:bg-red-950/20">
          <p className="text-xs font-semibold text-red-700 dark:text-red-300">
            Saldo anual insuficiente — justificativa obrigatória para aprovação pelo Diretor.
          </p>
          <label htmlFor="justification" className={LABEL_CLS}>
            Justificativa <span className="text-destructive">*</span>
          </label>
          <textarea
            id="justification"
            name="justification"
            rows={3}
            required
            placeholder="Explique a necessidade desta despesa fora do orçamento..."
            className={`${INPUT_CLS} resize-none`}
          />
        </div>
      )}

      {/* Recorrência */}
      <div className="rounded-lg border p-4 space-y-3">
        <label className={`flex items-center gap-2 ${recurrenceDisabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}>
          <input
            type="checkbox"
            checked={isRecurring}
            disabled={recurrenceDisabled}
            onChange={(e) => { setIsRecurring(e.target.checked); if (!e.target.checked) setRecurMonths([]); }}
            className="h-4 w-4 rounded border-gray-300"
          />
          <span className={LABEL_CLS}>Recorrência mensal</span>
          {recurrenceDisabled && (
            <span className="text-xs text-muted-foreground">(indisponível para compras parceladas)</span>
          )}
        </label>
        {isRecurring && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Selecione os outros meses em que esta despesa se repete
              {dueDateMonth ? ` (apenas meses após ${MONTHS[dueDateMonth - 1]})` : " (além do mês de referência)"}:
            </p>
            <div className="flex flex-wrap gap-2">
              {MONTHS.map((m, i) => {
                const monthNum = i + 1;
                if (monthNum === refMonth) return null;
                const isDisabled = dueDateMonth !== null && monthNum <= dueDateMonth;
                const selected = recurMonths.includes(monthNum);
                return (
                  <button
                    key={monthNum}
                    type="button"
                    disabled={isDisabled}
                    onClick={() => !isDisabled && toggleRecurMonth(monthNum)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                      isDisabled
                        ? "opacity-40 cursor-not-allowed bg-background text-muted-foreground"
                        : selected
                        ? "bg-violet-600 text-white border-violet-600"
                        : "bg-background text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {m.slice(0, 3)}
                  </button>
                );
              })}
            </div>
            {recurMonths.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Serão criadas {1 + recurMonths.length} requisições no total.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3 border-t pt-4">
        <button
          type="button"
          onClick={() => router.back()}
          disabled={loading}
          className="rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={loading || !canSubmit}
          title={!canSubmit ? "Verifique o orçamento antes de enviar" : undefined}
          className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Enviando..." : "Enviar Requisição"}
        </button>
      </div>
      {needsVerification && !canSubmit && (
        <p className="text-center text-xs text-muted-foreground -mt-3">
          Verifique o orçamento antes de enviar a requisição.
        </p>
      )}
    </form>
  );
}
