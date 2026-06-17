"use client";

import { useRouter } from "next/navigation";
import { useState, useMemo, useEffect, useRef } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, Loader2, Paperclip, Search, X, Zap } from "lucide-react";

import { createRequest, verifyBudget } from "@/lib/ctrl/actions/requests";
import { extractAttachmentData } from "@/lib/ctrl/actions/attachment-ocr";
import { isValidBoletoLinhaDigitavel } from "@/lib/ctrl/boleto";
import type { BudgetVerification } from "@/lib/ctrl/actions/requests";
import { createClient as createSupabaseClient } from "@/lib/supabase/client";
import type { CtrlEvent, CtrlExpenseType, CtrlSector, CtrlSupplier } from "@/lib/supabase/types";

const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024; // 10 MB
const ATTACHMENT_BUCKET = "ctrl-attachments";

const MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

const INPUT_CLS =
  "w-full rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background focus:ring-2 focus:ring-ring focus:ring-offset-2";
const LABEL_CLS = "text-sm font-medium";

const fmt = new Intl.NumberFormat("pt-BR", { style: "decimal", minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
  // Operational signal: does the requester need the *physical* credit card?
  // Persisted only when paymentMethod === 'cartao_credito'. Null means not asked.
  const [needsCreditCard, setNeedsCreditCard] = useState<"" | "sim" | "nao">("");

  // ── Due date (controlled for recurrence constraints) ─────────────────────────
  const [dueDate, setDueDate] = useState("");

  // ── Recurrence ───────────────────────────────────────────────────────────────
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurMonths, setRecurMonths] = useState<number[]>([]);

  // ── Nota fiscal ────────────────────────────────────────────────────────────
  // "sim" exige o anexo da NF; "sim_apos_pagamento" não, pois a nota só será
  // emitida depois do pagamento e ainda não existe no momento da requisição.
  const [supplierIssuesInvoice, setSupplierIssuesInvoice] = useState("");

  // ── Boleto / Nota fiscal — campos preenchidos pela leitura do anexo ─────────
  const [barcode, setBarcode] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");

  // ── Anexos ──────────────────────────────────────────────────────────────────
  // Dois anexos independentes: o documento de pagamento (boleto/comprovante) e a
  // NOTA FISCAL. Ambos são enviados JÁ no upload (para a leitura OCR); o submit
  // reaproveita os paths. Assim um boleto pode ter, além do boleto, a nota.
  async function uploadAttachmentFile(file: File): Promise<string> {
    const supabase = createSupabaseClient();
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) throw new Error("Sessão expirada — refaça o login.");
    const safeName = file.name.replace(/[^\w.\-]+/g, "_");
    const objectPath = `${userId}/${Date.now()}-${safeName}`;
    const { error: upErr } = await supabase.storage
      .from(ATTACHMENT_BUCKET)
      .upload(objectPath, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
    if (upErr) throw upErr;
    return objectPath;
  }

  // Anexo de pagamento (boleto/comprovante). No boleto, lê o código de barras.
  const [attachment, setAttachment] = useState<File | null>(null);
  const [attachmentPath, setAttachmentPath] = useState<string | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [attachmentReading, setAttachmentReading] = useState(false);
  const [attachmentReadMsg, setAttachmentReadMsg] = useState<string | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);

  async function pickAttachment(file: File | null) {
    setAttachmentError(null);
    setAttachmentReadMsg(null);
    setAttachmentPath(null);
    if (!file) {
      setAttachment(null);
      return;
    }
    if (file.size > MAX_ATTACHMENT_SIZE) {
      setAttachmentError("Arquivo excede o limite de 10 MB.");
      return;
    }
    setAttachment(file);
    try {
      const objectPath = await uploadAttachmentFile(file);
      setAttachmentPath(objectPath);
      // Só o boleto é lido aqui (código de barras). A nota fiscal tem o seu anexo.
      if (paymentMethod !== "boleto") return;
      setAttachmentReading(true);
      const res = await extractAttachmentData(objectPath, "boleto");
      setAttachmentReading(false);
      if ("error" in res) {
        setAttachmentReadMsg("Não consegui ler o boleto — preencha os campos manualmente.");
        return;
      }
      const d = res.data;
      if (d.barcode) setBarcode(d.barcode);
      if (d.favorecido && !favorecido) setFavorecido(d.favorecido);
      if (d.cnpj_cpf && !bankCpfCnpj) setBankCpfCnpj(d.cnpj_cpf);
      if (d.barcode && !isValidBoletoLinhaDigitavel(d.barcode)) {
        setAttachmentReadMsg(
          "Li o código de barras, mas ele parece inválido — confira/corrija manualmente ou leia novamente.",
        );
      } else {
        setAttachmentReadMsg(
          d.barcode || d.favorecido || d.cnpj_cpf
            ? "Dados do boleto lidos do documento — confira antes de enviar."
            : "Não consegui ler os dados do boleto — preencha manualmente.",
        );
      }
    } catch (err) {
      setAttachmentReading(false);
      setAttachment(null);
      setAttachmentPath(null);
      setAttachmentError(`Falha ao enviar o anexo: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function clearAttachment() {
    setAttachment(null);
    setAttachmentPath(null);
    setAttachmentError(null);
    setAttachmentReadMsg(null);
    setAttachmentReading(false);
    if (attachmentInputRef.current) attachmentInputRef.current.value = "";
  }

  // Relê o boleto já enviado (botão "Ler novamente" quando o código sai inválido).
  async function rereadBoleto() {
    if (!attachmentPath) return;
    setAttachmentReadMsg(null);
    setAttachmentReading(true);
    const res = await extractAttachmentData(attachmentPath, "boleto");
    setAttachmentReading(false);
    if ("error" in res) {
      setAttachmentReadMsg("Não consegui ler o boleto — preencha manualmente.");
      return;
    }
    const d = res.data;
    if (d.barcode) setBarcode(d.barcode);
    if (d.favorecido) setFavorecido(d.favorecido);
    if (d.cnpj_cpf) setBankCpfCnpj(d.cnpj_cpf);
    if (d.barcode && !isValidBoletoLinhaDigitavel(d.barcode)) {
      setAttachmentReadMsg("O código de barras lido continua inválido — preencha manualmente.");
    } else {
      setAttachmentReadMsg(
        d.barcode ? "Boleto lido novamente — confira." : "Não encontrei o código de barras — preencha manualmente.",
      );
    }
  }

  // Anexo da NOTA FISCAL — independente do método de pagamento. Lê o número da NF.
  const [invoiceAttachment, setInvoiceAttachment] = useState<File | null>(null);
  const [invoiceAttachmentPath, setInvoiceAttachmentPath] = useState<string | null>(null);
  const [invoiceAttachmentError, setInvoiceAttachmentError] = useState<string | null>(null);
  const [invoiceReading, setInvoiceReading] = useState(false);
  const [invoiceReadMsg, setInvoiceReadMsg] = useState<string | null>(null);
  const invoiceInputRef = useRef<HTMLInputElement | null>(null);

  async function pickInvoiceAttachment(file: File | null) {
    setInvoiceAttachmentError(null);
    setInvoiceReadMsg(null);
    setInvoiceAttachmentPath(null);
    if (!file) {
      setInvoiceAttachment(null);
      return;
    }
    if (file.size > MAX_ATTACHMENT_SIZE) {
      setInvoiceAttachmentError("Arquivo excede o limite de 10 MB.");
      return;
    }
    setInvoiceAttachment(file);
    try {
      const objectPath = await uploadAttachmentFile(file);
      setInvoiceAttachmentPath(objectPath);
      setInvoiceReading(true);
      const res = await extractAttachmentData(objectPath, "nota");
      setInvoiceReading(false);
      if ("error" in res) {
        setInvoiceReadMsg("Não consegui ler a nota — preencha o número manualmente.");
        return;
      }
      if (res.data.invoice_number) {
        setInvoiceNumber(res.data.invoice_number);
        setInvoiceReadMsg("Número da nota fiscal lido do documento.");
      } else {
        setInvoiceReadMsg("Não encontrei o número da nota — preencha manualmente.");
      }
    } catch (err) {
      setInvoiceReading(false);
      setInvoiceAttachment(null);
      setInvoiceAttachmentPath(null);
      setInvoiceAttachmentError(`Falha ao enviar a nota: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function clearInvoiceAttachment() {
    setInvoiceAttachment(null);
    setInvoiceAttachmentPath(null);
    setInvoiceAttachmentError(null);
    setInvoiceReadMsg(null);
    setInvoiceReading(false);
    if (invoiceInputRef.current) invoiceInputRef.current.value = "";
  }

  // ── Budget verification ──────────────────────────────────────────────────────
  const [verifying, setVerifying] = useState(false);
  const [verification, setVerification] = useState<BudgetVerification | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  // ── Derived values ───────────────────────────────────────────────────────────

  // Brazilian currency mask: digits flow in as cents from the right.
  // "1" → "0,01"   "12345" → "123,45"   "1234567" → "12.345,67"
  function formatBRL(digitsOnly: string): string {
    if (!digitsOnly) return "";
    const padded = digitsOnly.padStart(3, "0");
    const intRaw = padded.slice(0, -2).replace(/^0+/, "") || "0";
    const decPart = padded.slice(-2);
    const intWithSep = intRaw.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return `${intWithSep},${decPart}`;
  }

  const parsedAmount = useMemo(() => {
    // amountStr is in BR format (1.234,56) — strip thousand sep, swap decimal.
    const cleaned = amountStr.replace(/\./g, "").replace(",", ".");
    const n = parseFloat(cleaned);
    return isNaN(n) ? 0 : n;
  }, [amountStr]);

  // Minimum allowed due date. If now > 12:00, the earliest acceptable
  // date is tomorrow (operations team can't process same-day requests
  // submitted after lunch).
  const minDueDate = useMemo(() => {
    const base = new Date(now);
    if (base.getHours() >= 12) base.setDate(base.getDate() + 1);
    const yyyy = base.getFullYear();
    const mm = String(base.getMonth() + 1).padStart(2, "0");
    const dd = String(base.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedSupplier = useMemo(
    () => suppliers.find((s) => s.id === selectedSupplierId) ?? null,
    [selectedSupplierId, suppliers]
  );

  const dueDateMonth = useMemo(() => {
    if (!dueDate) return null;
    return new Date(dueDate + "T00:00:00").getMonth() + 1;
  }, [dueDate]);

  const availableMethods = useMemo(() => {
    const avail = new Set(["boleto", "cartao_credito", "dinheiro", "pix_copia_cola"]);
    if (!selectedSupplier || selectedSupplier.chave_pix) avail.add("pix");
    if (!selectedSupplier || (selectedSupplier.banco && selectedSupplier.conta_corrente)) avail.add("transferencia");
    return avail;
  }, [selectedSupplier]);

  const recurrenceDisabled = paymentMethod === "cartao_credito" && installments >= 2;

  // O anexo de pagamento é obrigatório no boleto (o boleto em si). A nota fiscal
  // tem o seu próprio anexo, obrigatório quando o fornecedor emite NF "agora".
  const attachmentRequired = paymentMethod === "boleto";
  const invoiceAttachmentRequired = supplierIssuesInvoice === "sim";

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

    const newAvail = new Set(["boleto", "cartao_credito", "dinheiro", "pix_copia_cola"]);
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

    // Combobox writes to React state, not to a form field, so HTML `required`
    // doesn't catch the empty case. Do it here.
    if (!selectedSupplierId) {
      setError("Selecione um fornecedor.");
      return;
    }

    if (attachmentRequired && !attachment) {
      setError("Anexe o boleto (PDF, imagem ou documento) antes de enviar.");
      return;
    }

    if (invoiceAttachmentRequired && !invoiceAttachment) {
      setError("O fornecedor emite nota fiscal — adicione a nota fiscal antes de enviar.");
      return;
    }

    if (paymentMethod === "pix_copia_cola" && !pixKey.trim()) {
      setError("Cole o código PIX copia e cola antes de enviar.");
      return;
    }

    // Defensive due-date check: HTML `min` is enforced by most browsers but
    // some mobile webviews ignore it. Belt + suspenders.
    if (dueDate && dueDate < minDueDate) {
      const isAfterNoon = new Date(now).getHours() >= 12;
      setError(
        isAfterNoon
          ? "Como o horário já passou das 12:00, a data de vencimento deve ser a partir de amanhã."
          : "A data de vencimento não pode ser anterior a hoje.",
      );
      return;
    }

    setLoading(true);
    setError(null);
    setSuccessMsg(null);

    const form = new FormData(e.currentTarget);

    // The DB still requires a non-null title column, so we reuse the
    // description as title — the UI now shows only one text field.
    const descriptionValue = (form.get("description") as string)?.trim() ?? "";

    // Os anexos normalmente já foram enviados no momento do upload (para a
    // leitura). Reaproveita os paths; só envia aqui se ainda não houver.
    let finalAttachmentPath: string | undefined = attachmentPath ?? undefined;
    let finalInvoicePath: string | undefined = invoiceAttachmentPath ?? undefined;
    try {
      if (attachment && !finalAttachmentPath) {
        finalAttachmentPath = await uploadAttachmentFile(attachment);
      }
      if (invoiceAttachment && !finalInvoicePath) {
        finalInvoicePath = await uploadAttachmentFile(invoiceAttachment);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Falha ao enviar o anexo: ${msg}`);
      setLoading(false);
      return;
    }

    const result = await createRequest({
      title: descriptionValue,
      description: descriptionValue || undefined,
      attachment_path: finalAttachmentPath,
      invoice_attachment_path: finalInvoicePath,
      sector_id: sectorId,
      expense_type_id: expenseTypeId || undefined,
      supplier_id: selectedSupplierId || undefined,
      amount: parsedAmount,
      due_date: dueDate || undefined,
      reference_month: refMonth,
      reference_year: refYear,
      payment_method: paymentMethod as "boleto" | "pix" | "transferencia" | "cartao_credito" | "dinheiro" | "pix_copia_cola",
      justification: (form.get("justification") as string) || undefined,
      observations: (form.get("observations") as string) || undefined,
      event_id: (form.get("event_id") as string) || undefined,
      supplier_issues_invoice: supplierIssuesInvoice || undefined,
      invoice_number:
        supplierIssuesInvoice === "sim_apos_pagamento"
          ? "após pagamento"
          : invoiceNumber.trim() || undefined,
      bank_name: bankName || undefined,
      bank_agency: bankAgency || undefined,
      bank_account: bankAccount || undefined,
      bank_account_digit: bankAccountDigit || undefined,
      bank_cpf_cnpj: bankCpfCnpj || undefined,
      pix_key: pixKey || undefined,
      pix_key_type: pixKeyType || undefined,
      favorecido: favorecido || undefined,
      barcode: barcode || undefined,
      installments: paymentMethod === "cartao_credito" ? installments : undefined,
      needs_credit_card:
        paymentMethod === "cartao_credito" && needsCreditCard
          ? needsCreditCard === "sim"
          : undefined,
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

  // Bloco de anexo reutilizável — renderizado dentro da seção do boleto (antes
  // dos campos de dados) ou na posição padrão para os demais métodos.
  const attachLabel = paymentMethod === "boleto" ? "Adicionar boleto" : "Adicionar comprovante";

  const attachmentBlock = (
    <div className="space-y-1.5">
      <label htmlFor="attachment" className={LABEL_CLS}>
        {paymentMethod === "boleto" ? "Boleto" : "Anexo"}{" "}
        {attachmentRequired ? (
          <span className="text-destructive">* obrigatório</span>
        ) : (
          <span className="text-muted-foreground font-normal">(opcional)</span>
        )}
        <span className="text-muted-foreground font-normal"> · até 10 MB</span>
      </label>
      {/* input escondido — acionado pelo botão abaixo */}
      <input
        ref={attachmentInputRef}
        id="attachment"
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx"
        onChange={(e) => pickAttachment(e.target.files?.[0] ?? null)}
        className="hidden"
      />
      {!attachment ? (
        <button
          type="button"
          onClick={() => attachmentInputRef.current?.click()}
          disabled={attachmentReading}
          className="inline-flex items-center gap-2 rounded-md border border-dashed px-4 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
        >
          <Paperclip className="h-4 w-4" />
          {attachmentReading ? "Lendo documento…" : attachLabel}
        </button>
      ) : (
        <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2">
          <div className="flex items-center gap-2 text-sm">
            <Paperclip className="h-4 w-4 text-muted-foreground" />
            <span className="truncate">{attachment.name}</span>
            <span className="text-xs text-muted-foreground">
              ({(attachment.size / 1024 / 1024).toFixed(2)} MB)
            </span>
          </div>
          <button
            type="button"
            onClick={clearAttachment}
            className="text-muted-foreground hover:text-destructive"
            aria-label="Remover anexo"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {attachmentReading && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Lendo documento…
        </p>
      )}
      {attachmentReadMsg && !attachmentReading && (
        <p className="text-xs text-violet-700 dark:text-violet-300">{attachmentReadMsg}</p>
      )}
      {attachmentError && <p className="text-xs text-destructive">{attachmentError}</p>}
      <p className="text-xs text-muted-foreground">Formatos: PDF, JPG, PNG, DOC, XLS.</p>
    </div>
  );

  // Bloco do anexo da NOTA FISCAL — botão "Adicionar nota fiscal" + leitura do nº.
  const invoiceAttachmentBlock = (
    <div className="space-y-1.5">
      <label htmlFor="invoice_attachment" className={LABEL_CLS}>
        Nota fiscal{" "}
        {invoiceAttachmentRequired ? (
          <span className="text-destructive">* obrigatório</span>
        ) : (
          <span className="text-muted-foreground font-normal">(opcional)</span>
        )}
        <span className="text-muted-foreground font-normal"> · até 10 MB</span>
      </label>
      <input
        ref={invoiceInputRef}
        id="invoice_attachment"
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx"
        onChange={(e) => pickInvoiceAttachment(e.target.files?.[0] ?? null)}
        className="hidden"
      />
      {!invoiceAttachment ? (
        <button
          type="button"
          onClick={() => invoiceInputRef.current?.click()}
          disabled={invoiceReading}
          className="inline-flex items-center gap-2 rounded-md border border-dashed px-4 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
        >
          <Paperclip className="h-4 w-4" />
          {invoiceReading ? "Lendo documento…" : "Adicionar nota fiscal"}
        </button>
      ) : (
        <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2">
          <div className="flex items-center gap-2 text-sm">
            <Paperclip className="h-4 w-4 text-muted-foreground" />
            <span className="truncate">{invoiceAttachment.name}</span>
            <span className="text-xs text-muted-foreground">
              ({(invoiceAttachment.size / 1024 / 1024).toFixed(2)} MB)
            </span>
          </div>
          <button
            type="button"
            onClick={clearInvoiceAttachment}
            className="text-muted-foreground hover:text-destructive"
            aria-label="Remover nota fiscal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {invoiceReading && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Lendo documento…
        </p>
      )}
      {invoiceReadMsg && !invoiceReading && (
        <p className="text-xs text-violet-700 dark:text-violet-300">{invoiceReadMsg}</p>
      )}
      {invoiceAttachmentError && <p className="text-xs text-destructive">{invoiceAttachmentError}</p>}
    </div>
  );

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

      {/* Descrição (identifica a requisição) */}
      <div className="space-y-1.5">
        <label htmlFor="description" className={LABEL_CLS}>
          Descrição <span className="text-destructive">*</span>
        </label>
        <textarea
          id="description"
          name="description"
          rows={2}
          required
          placeholder="Ex: Pagamento de serviço de limpeza — referente ao mês de maio"
          className={`${INPUT_CLS} resize-none`}
        />
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
          <label htmlFor="expense_type_id" className={LABEL_CLS}>
            Tipo de Despesa <span className="text-destructive">*</span>
          </label>
          <select
            id="expense_type_id"
            name="expense_type_id"
            required
            value={expenseTypeId}
            onChange={(e) => setExpenseTypeId(e.target.value)}
            className={INPUT_CLS}
          >
            <option value="">Selecione o tipo de despesa</option>
            {expenseTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      </div>

      {/* Fornecedor */}
      <div className="space-y-1.5">
        <label className={LABEL_CLS}>
          Fornecedor <span className="text-destructive">*</span>
        </label>
        <SupplierCombobox
          suppliers={suppliers}
          selectedId={selectedSupplierId}
          onSelect={handleSupplierChange}
        />
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
            inputMode="numeric"
            required
            placeholder="0,00"
            value={amountStr}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, "");
              setAmountStr(formatBRL(digits));
            }}
            className={INPUT_CLS}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="due_date" className={LABEL_CLS}>
            Data de Vencimento <span className="text-destructive">*</span>
          </label>
          <input
            id="due_date"
            name="due_date"
            type="date"
            required
            min={minDueDate}
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            onClick={(e) => {
              // Abre o calendario nativo ao clicar em qualquer parte do campo
              // (Chrome/Edge so abrem via icone por padrao).
              const el = e.currentTarget as HTMLInputElement & {
                showPicker?: () => void;
              };
              try {
                el.showPicker?.();
              } catch {
                // showPicker pode lancar se chamado sem gesto do usuario ou em browser incompativel.
              }
            }}
            className={`${INPUT_CLS} cursor-pointer`}
          />
        </div>
      </div>

      {/* Competência */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label className={LABEL_CLS}>Mês Competência <span className="text-destructive">*</span></label>
          <select value={refMonth} onChange={(e) => setRefMonth(Number(e.target.value))} className={INPUT_CLS}>
            {MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className={LABEL_CLS}>Ano Competência <span className="text-destructive">*</span></label>
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
                  Fora do orçamento (saldo anual insuficiente) — requer aprovação do Gerente e depois do Diretor, com justificativa obrigatória.
                </p>
              )}
              {verification.approvalTier === "nivel_2" && (
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  Dentro do orçamento — requer aprovação do gerente do setor.
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
            { value: "pix_copia_cola", label: "PIX Copia e Cola" },
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
          {selectedSupplier && (
            <p className="text-xs text-muted-foreground sm:col-span-2">
              Dados do fornecedor cadastrado — não editáveis aqui.
            </p>
          )}
          <div className="space-y-1.5">
            <label htmlFor="pix_key_type" className={LABEL_CLS}>Tipo de Chave PIX</label>
            <select id="pix_key_type" name="pix_key_type" value={pixKeyType} onChange={(e) => setPixKeyType(e.target.value)} disabled={!!selectedSupplier} className={INPUT_CLS}>
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
            <input id="pix_key" name="pix_key" type="text" value={pixKey} onChange={(e) => setPixKey(e.target.value)} disabled={!!selectedSupplier} placeholder="Informe a chave" className={INPUT_CLS} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="favorecido" className={LABEL_CLS}>Favorecido</label>
            <input id="favorecido" name="favorecido" type="text" value={favorecido} onChange={(e) => setFavorecido(e.target.value)} disabled={!!selectedSupplier} placeholder="Nome do favorecido" className={INPUT_CLS} />
          </div>
        </div>
      )}

      {/* PIX Copia e Cola — pagamento avulso; campo editável mesmo com fornecedor */}
      {paymentMethod === "pix_copia_cola" && (
        <div className="space-y-1.5 rounded-lg border bg-muted/20 p-4">
          <label htmlFor="pix_copia_cola" className={LABEL_CLS}>
            Código PIX (copia e cola) <span className="text-destructive">*</span>
          </label>
          <textarea
            id="pix_copia_cola"
            name="pix_copia_cola"
            rows={3}
            value={pixKey}
            onChange={(e) => setPixKey(e.target.value)}
            placeholder="Cole aqui o código PIX copia e cola"
            className={`${INPUT_CLS} resize-none font-mono text-xs`}
          />
        </div>
      )}

      {/* Transferência */}
      {paymentMethod === "transferencia" && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 rounded-lg border bg-muted/20 p-4">
          {selectedSupplier && (
            <p className="text-xs text-muted-foreground sm:col-span-2">
              Dados do fornecedor cadastrado — não editáveis aqui.
            </p>
          )}
          <div className="space-y-1.5 sm:col-span-2">
            <label htmlFor="favorecido" className={LABEL_CLS}>Favorecido</label>
            <input id="favorecido" name="favorecido" type="text" value={favorecido} onChange={(e) => setFavorecido(e.target.value)} disabled={!!selectedSupplier} placeholder="Nome do favorecido" className={INPUT_CLS} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="bank_cpf_cnpj" className={LABEL_CLS}>CPF/CNPJ</label>
            <input id="bank_cpf_cnpj" name="bank_cpf_cnpj" type="text" value={bankCpfCnpj} onChange={(e) => setBankCpfCnpj(e.target.value)} disabled={!!selectedSupplier} placeholder="000.000.000-00" className={INPUT_CLS} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="bank_name" className={LABEL_CLS}>Banco</label>
            <input id="bank_name" name="bank_name" type="text" value={bankName} onChange={(e) => setBankName(e.target.value)} disabled={!!selectedSupplier} placeholder="Ex: Banco do Brasil" className={INPUT_CLS} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="bank_agency" className={LABEL_CLS}>Agência</label>
            <input id="bank_agency" name="bank_agency" type="text" value={bankAgency} onChange={(e) => setBankAgency(e.target.value)} disabled={!!selectedSupplier} placeholder="0000" className={INPUT_CLS} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <div className="grid grid-cols-[1fr_88px] gap-3">
              <div className="space-y-1.5">
                <label htmlFor="bank_account" className={LABEL_CLS}>Conta</label>
                <input id="bank_account" name="bank_account" type="text" value={bankAccount} onChange={(e) => setBankAccount(e.target.value)} disabled={!!selectedSupplier} placeholder="00000" className={INPUT_CLS} />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="bank_account_digit" className={LABEL_CLS}>Dígito</label>
                <input id="bank_account_digit" name="bank_account_digit" type="text" value={bankAccountDigit} onChange={(e) => setBankAccountDigit(e.target.value)} disabled={!!selectedSupplier} placeholder="0" className={INPUT_CLS} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Boleto — anexo primeiro; os dados abaixo são preenchidos pela leitura */}
      {paymentMethod === "boleto" && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 rounded-lg border bg-muted/20 p-4">
          <div className="sm:col-span-2">
            <p className="mb-2 text-xs text-muted-foreground">
              Anexe o boleto primeiro — o sistema tenta ler o código de barras, o
              favorecido e o CPF/CNPJ e preencher os campos abaixo.
            </p>
            {attachmentBlock}
          </div>
          <div className="space-y-1.5">
            <label htmlFor="favorecido" className={LABEL_CLS}>Favorecido</label>
            <input id="favorecido" name="favorecido" type="text" value={favorecido} onChange={(e) => setFavorecido(e.target.value)} disabled={!!selectedSupplier} placeholder="Nome do favorecido" className={INPUT_CLS} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="bank_cpf_cnpj" className={LABEL_CLS}>CPF/CNPJ</label>
            <input id="bank_cpf_cnpj" name="bank_cpf_cnpj" type="text" value={bankCpfCnpj} onChange={(e) => setBankCpfCnpj(e.target.value)} disabled={!!selectedSupplier} placeholder="000.000.000-00" className={INPUT_CLS} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <label htmlFor="barcode" className={LABEL_CLS}>
              Linha Digitável / Código de Barras <span className="text-destructive">*</span>
            </label>
            <input
              id="barcode"
              name="barcode"
              type="text"
              required
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              placeholder="000000000000000000000000000000000000"
              className={`${INPUT_CLS} ${barcode && !isValidBoletoLinhaDigitavel(barcode) ? "border-destructive focus:ring-destructive" : ""}`}
            />
            {barcode && !isValidBoletoLinhaDigitavel(barcode) && (
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs text-destructive">
                  Código de barras inválido. Confira/corrija manualmente
                  {attachmentPath ? " ou leia o boleto novamente." : "."}
                </p>
                {attachmentPath && (
                  <button
                    type="button"
                    onClick={rereadBoleto}
                    disabled={attachmentReading}
                    className="rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
                  >
                    {attachmentReading ? "Lendo…" : "Ler novamente"}
                  </button>
                )}
              </div>
            )}
            {barcode && isValidBoletoLinhaDigitavel(barcode) && (
              <p className="text-xs text-green-600 dark:text-green-400">Código de barras válido.</p>
            )}
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

          {/* Precisa do cartão de crédito físico? */}
          <div className="space-y-1.5">
            <label htmlFor="needs_credit_card" className={LABEL_CLS}>
              Precisa do cartão de crédito? <span className="text-destructive">*</span>
            </label>
            <select
              id="needs_credit_card"
              name="needs_credit_card"
              required
              value={needsCreditCard}
              onChange={(e) => setNeedsCreditCard(e.target.value as "" | "sim" | "nao")}
              className={INPUT_CLS}
            >
              <option value="">Selecione</option>
              <option value="sim">Sim</option>
              <option value="nao">Não</option>
            </select>
            <p className="text-xs text-muted-foreground">
              Selecione &quot;Sim&quot; se o solicitante precisar receber fisicamente o cartão para realizar a compra.
            </p>
          </div>
        </div>
      )}

      {/* Fornecedor emite nota? */}
      <div className="space-y-1.5">
        <label htmlFor="supplier_issues_invoice" className={LABEL_CLS}>
          O fornecedor emite nota fiscal? <span className="text-destructive">*</span>
        </label>
        <select
          id="supplier_issues_invoice"
          name="supplier_issues_invoice"
          required
          value={supplierIssuesInvoice}
          onChange={(e) => setSupplierIssuesInvoice(e.target.value)}
          className={INPUT_CLS}
        >
          <option value="">Selecione uma resposta</option>
          <option value="sim">Sim</option>
          <option value="sim_apos_pagamento">Sim, após o pagamento</option>
          <option value="nao">Não</option>
        </select>
      </div>

      {/* NF = Sim: botão para adicionar a nota (lê o número automaticamente) +
          o número da NF. No boleto o anexo é o próprio boleto (seção acima),
          então aqui mostramos só o campo do número. */}
      {supplierIssuesInvoice === "sim" && (
        <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
          {invoiceAttachmentBlock}
          <div className="space-y-1.5">
            <label htmlFor="invoice_number" className={LABEL_CLS}>
              Número da nota fiscal
            </label>
            <input
              id="invoice_number"
              name="invoice_number"
              type="text"
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
              placeholder="Preenchido automaticamente ao adicionar a nota"
              className={INPUT_CLS}
            />
          </div>
        </div>
      )}

      {/* Anexo genérico — só quando não é boleto nem NF "sim" (esses têm o seu) */}
      {paymentMethod !== "boleto" && supplierIssuesInvoice !== "sim" && attachmentBlock}

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

// ── Supplier combobox ───────────────────────────────────────────────────────
// Filters by name OR CNPJ/CPF (digits-only match so user can type with or
// without punctuation). Caps the rendered list at 50 — when there are more
// matches, the user is asked to refine. Plain JS, no extra deps.

function SupplierCombobox({
  suppliers,
  selectedId,
  onSelect,
}: {
  suppliers: CtrlSupplier[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = suppliers.find((s) => s.id === selectedId);
  const displayValue = useMemo(() => {
    if (isOpen) return search;
    if (!selected) return "";
    return selected.cnpj_cpf
      ? `${selected.name} — ${selected.cnpj_cpf}`
      : selected.name;
  }, [isOpen, search, selected]);

  // Filter — name substring (case-insensitive) OR cnpj digits substring.
  const filtered = useMemo(() => {
    const term = search.toLowerCase().trim();
    if (!term) return suppliers;
    const termDigits = term.replace(/\D/g, "");
    return suppliers.filter((s) => {
      if (s.name.toLowerCase().includes(term)) return true;
      if (termDigits && s.cnpj_cpf?.replace(/\D/g, "").includes(termDigits)) return true;
      return false;
    });
  }, [search, suppliers]);

  // Reset highlight when filter changes
  useEffect(() => {
    setHighlight(0);
  }, [search]);

  // Close when clicking outside
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setIsOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function commit(s: CtrlSupplier) {
    onSelect(s.id);
    setIsOpen(false);
    setSearch("");
    inputRef.current?.blur();
  }

  function clear() {
    onSelect("");
    setSearch("");
    setIsOpen(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  const visible = filtered.slice(0, 50);

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={inputRef}
          type="text"
          autoComplete="off"
          value={displayValue}
          onFocus={() => {
            setIsOpen(true);
            setSearch("");
          }}
          onChange={(e) => {
            setSearch(e.target.value);
            setIsOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setIsOpen(true);
              setHighlight((h) => Math.min(h + 1, visible.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlight((h) => Math.max(h - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (visible[highlight]) commit(visible[highlight]);
            } else if (e.key === "Escape") {
              setIsOpen(false);
              setSearch("");
              inputRef.current?.blur();
            }
          }}
          placeholder="Digite o nome ou CNPJ do fornecedor..."
          className={`${INPUT_CLS} pl-8 ${selected ? "pr-9" : ""}`}
        />
        {selected ? (
          <button
            type="button"
            onClick={clear}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-destructive"
            aria-label="Limpar fornecedor"
          >
            <X className="h-4 w-4" />
          </button>
        ) : (
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        )}
      </div>

      {isOpen && (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-md border bg-background shadow-md">
          {visible.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              Nenhum fornecedor encontrado.
            </p>
          ) : (
            <ul role="listbox" className="py-1">
              {visible.map((s, i) => (
                <li
                  key={s.id}
                  role="option"
                  aria-selected={i === highlight}
                  onMouseEnter={() => setHighlight(i)}
                  onMouseDown={(e) => {
                    // mousedown beats the outside-click close that triggers on mouseup
                    e.preventDefault();
                    commit(s);
                  }}
                  className={`cursor-pointer px-3 py-2 text-sm ${
                    i === highlight ? "bg-muted" : ""
                  }`}
                >
                  <div className="font-medium">{s.name}</div>
                  <div className="flex gap-2 text-xs text-muted-foreground">
                    {s.cnpj_cpf && <span>{s.cnpj_cpf}</span>}
                    {s.status === "pendente" && (
                      <span className="text-amber-600">pendente</span>
                    )}
                  </div>
                </li>
              ))}
              {filtered.length > 50 && (
                <li className="px-3 py-2 text-xs text-muted-foreground">
                  Mostrando 50 de {filtered.length}. Refine a busca.
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
