"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { requireCtrlRole } from "@/lib/ctrl/auth";
import { notifyPendingApproval, notifyRequester, notifyAdmins } from "@/lib/ctrl/notifications";
import type { CtrlRequestStatus } from "@/lib/supabase/types";

// ─── Types ───────────────────────────────────────────────────────────────────

export type PaymentMethod =
  | "boleto"
  | "pix"
  | "transferencia"
  | "cartao_credito"
  | "dinheiro"
  | "pix_copia_cola";

export type ApprovalTier = "nivel_2" | "nivel_3";

// ─── Regras de roteamento de aprovação (overrides de negócio) ────────────────
// Estes IDs são acordos de negócio explícitos, não dados derivados — por isso
// ficam fixos no código. Mudaram? Atualize aqui.
const APPROVAL_ROUTING = {
  // Requisições deste solicitante pulam o gerente e nascem aguardando o diretor.
  directorOnly: {
    requesterId: "45a367ad-695e-4758-b033-470483758b4c",
    directorId: "f159c959-55c2-4cc9-a1e4-acc4b2ab69c3",
  },
  // Tipo de despesa cuja etapa de gerente é direcionada a este gerente.
  expenseTypeManager: {
    expenseTypeId: "7233530b-fb16-441d-a22c-9611ddedf1ab", // Capacitações e Treinamentos
    managerId: "bcacac55-230e-447c-bb7c-c0ff63ce18ee",
  },
  // Setor cujas requisições vão sempre direto ao diretor, mesmo com orçamento
  // aprovado (pula o gerente). Notifica todos os diretores.
  directorSector: {
    sectorId: "306ef9b3-7895-446d-b9d3-5537942627b2", // Diretoria
  },
} as const;

export interface BudgetVerification {
  approvalTier: ApprovalTier;
  autoApproved: boolean;
  isBudgeted: boolean;
  justificationRequired: boolean;
  currentBalance: number;
  futureBalance: number;
  budgetedUpToMonth: number;
  budgetedAnnual: number;
  totalApproved: number;
  statusLabel: string;
}

export interface CreateRequestInput {
  title: string;
  description?: string;
  sector_id: string;
  expense_type_id?: string;
  supplier_id?: string;
  amount: number;
  due_date?: string;
  reference_month: number;
  reference_year: number;
  payment_method: PaymentMethod;
  justification?: string;
  observations?: string;
  event_id?: string;
  supplier_issues_invoice?: string;
  invoice_number?: string;
  // Payment fields
  bank_name?: string;
  bank_agency?: string;
  bank_account?: string;
  bank_account_digit?: string;
  bank_cpf_cnpj?: string;
  pix_key?: string;
  pix_key_type?: string;
  favorecido?: string;
  barcode?: string;
  // Installments
  installments?: number;
  // Recurrence
  is_recurring?: boolean;
  recurrence_months?: number[];
  // Attachment (uploaded client-side to storage bucket 'ctrl-attachments'
  // before submit). Stored verbatim in every row of this submission.
  attachment_path?: string;
  invoice_attachment_path?: string;
  // Operational signal for credit card payments: does the requester need
  // to receive the physical card to make the purchase? Only meaningful
  // when payment_method === 'cartao_credito'.
  needs_credit_card?: boolean;
}

// ─── Budget Verification ──────────────────────────────────────────────────────

async function performBudgetVerification(
  supabase: Awaited<ReturnType<typeof createClient>>,
  sectorId: string,
  expenseTypeId: string,
  amount: number,
  referenceMonth: number,
  referenceYear: number
): Promise<BudgetVerification> {
  const fmt = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

  // Budget accumulated Jan → referenceMonth
  const { data: budgetUpTo } = await supabase
    .from("ctrl_budget")
    .select("amount, realized")
    .eq("sector_id", sectorId)
    .eq("expense_type_id", expenseTypeId)
    .eq("period_year", referenceYear)
    .lte("period_month", referenceMonth);

  const budgetedUpToMonth = (budgetUpTo ?? []).reduce(
    (s, b) => s + Number(b.amount),
    0
  );
  const realizedUpToMonth = (budgetUpTo ?? []).reduce(
    (s, b) => s + Number(b.realized ?? 0),
    0
  );

  // Budget annual Jan → Dec
  const { data: budgetAnnual } = await supabase
    .from("ctrl_budget")
    .select("amount, realized")
    .eq("sector_id", sectorId)
    .eq("expense_type_id", expenseTypeId)
    .eq("period_year", referenceYear);

  const budgetedAnnual = (budgetAnnual ?? []).reduce(
    (s, b) => s + Number(b.amount),
    0
  );
  const realizedAnnual = (budgetAnnual ?? []).reduce(
    (s, b) => s + Number(b.realized ?? 0),
    0
  );

  const isBudgeted = budgetedAnnual > 0;

  // Total approved for this sector+type in this year
  const { data: approved } = await supabase
    .from("ctrl_requests")
    .select("amount")
    .eq("sector_id", sectorId)
    .eq("expense_type_id", expenseTypeId)
    .eq("reference_year", referenceYear)
    .eq("status", "aprovado");

  const totalApproved = (approved ?? []).reduce(
    (s, r) => s + Number(r.amount),
    0
  );

  // Realizado total = importado da planilha + requisições já aprovadas.
  const currentBalance = budgetedUpToMonth - realizedUpToMonth - totalApproved;
  const futureBalance = budgetedAnnual - realizedAnnual - totalApproved;

  // Sem auto-aprovação: toda requisição passa por aprovação humana.
  // Dentro do orçamento anual (saldo anual >= valor) → só o gerente do setor.
  if (futureBalance >= amount) {
    return {
      approvalTier: "nivel_2",
      autoApproved: false,
      isBudgeted,
      justificationRequired: false,
      currentBalance,
      futureBalance,
      budgetedUpToMonth,
      budgetedAnnual,
      totalApproved,
      statusLabel: `Dentro do orçamento — requer aprovação do gerente (saldo anual ${fmt.format(futureBalance)})`,
    };
  }

  // Fora do orçamento anual (saldo anual < valor) → gerente e depois diretor,
  // com justificativa obrigatória.
  return {
    approvalTier: "nivel_3",
    autoApproved: false,
    isBudgeted,
    justificationRequired: true,
    currentBalance,
    futureBalance,
    budgetedUpToMonth,
    budgetedAnnual,
    totalApproved,
    statusLabel: `Fora do orçamento — requer gerente e diretor (saldo anual ${fmt.format(futureBalance)} insuficiente)`,
  };
}

// ─── Installment date calculation ────────────────────────────────────────────

function calculateInstallmentDates(
  purchaseDate: string,
  total: number
): { installment: number; dueDate: string; month: number; year: number }[] {
  const purchase = new Date(purchaseDate + "T00:00:00");
  const monthOffset = purchase.getDate() >= 23 ? 2 : 1;
  const results = [];
  for (let i = 0; i < total; i++) {
    const totalOffset = purchase.getMonth() + monthOffset + i;
    const dueMonth = totalOffset % 12;
    const dueYear = purchase.getFullYear() + Math.floor(totalOffset / 12);
    results.push({
      installment: i + 1,
      dueDate: `${dueYear}-${String(dueMonth + 1).padStart(2, "0")}-05`,
      month: dueMonth + 1,
      year: dueYear,
    });
  }
  return results;
}

// Mantém o DIA da data escolhida, mas no mês/ano da recorrência. Faz clamp para
// o último dia do mês quando o dia não existe (ex: dia 31 em fevereiro → 28/29).
function dueDateForRecurrence(
  baseDueDate: string | null | undefined,
  month: number,
  year: number,
): string | null {
  if (!baseDueDate) return null;
  const base = new Date(baseDueDate + "T00:00:00");
  const day = base.getDate();
  const lastDay = new Date(year, month, 0).getDate(); // month 1-based → último dia do mês
  const d = Math.min(day, lastDay);
  return `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// ─── Create Request ───────────────────────────────────────────────────────────

export async function createRequest(data: CreateRequestInput) {
  const ctx = await requireCtrlRole(
    "solicitante",
    "gerente",
    "diretor",
    "csc",
    "admin"
  );
  const adminClient = createAdminClientIfAvailable();
  const supabase = adminClient ?? (await createClient());

  // Basic validation
  if (!data.sector_id || data.amount <= 0) {
    return { error: "Preencha todos os campos obrigatórios." };
  }
  if (data.reference_month < 1 || data.reference_month > 12) {
    return { error: "Mês de referência inválido." };
  }

  // If supplier is pending, create request in waiting state
  if (data.supplier_id) {
    const { data: sup } = await supabase
      .from("ctrl_suppliers")
      .select("status")
      .eq("id", data.supplier_id)
      .single();

    if (sup?.status === "pendente") {
      const { data: req, error } = await supabase
        .from("ctrl_requests")
        .insert({
          title: data.title,
          description: data.description ?? null,
          sector_id: data.sector_id,
          expense_type_id: data.expense_type_id ?? null,
          supplier_id: data.supplier_id,
          amount: data.amount,
          due_date: data.due_date ?? null,
          reference_month: data.reference_month,
          reference_year: data.reference_year,
          payment_method: data.payment_method,
          observations: data.observations ?? null,
          event_id: data.event_id ?? null,
          status: "aguardando_aprovacao_fornecedor",
          approval_level: 0,
          created_by: ctx.id,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any)
        .select("id, request_number")
        .single();

      if (error || !req) return { error: error?.message ?? "Erro ao criar." };

      await supabase.from("ctrl_history").insert({
        request_id: req.id,
        user_id: ctx.id,
        action: "criado",
        comment: "Aguardando aprovação do fornecedor pelo administrador.",
      });

      await notifyAdmins({
        requestId: req.id,
        title: "Novo Fornecedor Aguardando Aprovação",
        message: `Requisição #${req.request_number} aguarda aprovação do fornecedor. Acesse Admin > Fornecedores.`,
        type: "fornecedor_pendente",
      });

      revalidatePath("/ctrl/requisicoes");
      return {
        requestId: req.id,
        requestNumber: req.request_number,
        totalCreated: 1,
      };
    }
  }

  // Budget verification
  const verificationMonth = data.due_date
    ? new Date(data.due_date + "T00:00:00").getMonth() + 1
    : data.reference_month;
  const verificationYear = data.due_date
    ? new Date(data.due_date + "T00:00:00").getFullYear()
    : data.reference_year;

  let verification: BudgetVerification | null = null;
  if (data.expense_type_id) {
    verification = await performBudgetVerification(
      supabase,
      data.sector_id,
      data.expense_type_id,
      data.amount,
      verificationMonth,
      verificationYear
    );

    if (verification.justificationRequired && !data.justification?.trim()) {
      return {
        error:
          "Justificativa obrigatória — saldo anual insuficiente. Requer aprovação do Diretor.",
        verification,
      };
    }
  }

  // Solicitante especial pula o gerente e vai direto ao diretor.
  const directorOnly = ctx.id === APPROVAL_ROUTING.directorOnly.requesterId;
  // Setor Diretoria vai sempre direto ao diretor, independente do orçamento.
  const directorSectorOnly = data.sector_id === APPROVAL_ROUTING.directorSector.sectorId;
  const forceDirector = directorOnly || directorSectorOnly;
  const approvalTier: ApprovalTier = forceDirector
    ? "nivel_3"
    : verification?.approvalTier ?? "nivel_2";
  // Sem auto-aprovação: toda requisição entra pendente.
  const initialStatus: CtrlRequestStatus = forceDirector ? "pendente_diretor" : "pendente";

  // Installments
  const isInstallment =
    data.payment_method === "cartao_credito" &&
    (data.installments ?? 1) > 1;
  const installmentDates = isInstallment && data.due_date
    ? calculateInstallmentDates(data.due_date, data.installments!)
    : [];
  const installmentGroupId = isInstallment ? crypto.randomUUID() : null;
  const unitAmount = isInstallment
    ? Math.floor((data.amount / data.installments!) * 100) / 100
    : data.amount;

  // Recurrence group
  let recurrenceGroupId: string | null = null;
  if (data.is_recurring && (data.recurrence_months?.length ?? 0) > 0) {
    const allMonths = [data.reference_month, ...(data.recurrence_months ?? [])];
    const { data: grp } = await supabase
      .from("ctrl_recurrence_groups")
      .insert({ months: allMonths, status: "ativo", created_by: ctx.id })
      .select("id")
      .single();
    recurrenceGroupId = grp?.id ?? null;
  }

  // Common fields
  const baseFields = {
    title: data.title,
    description: data.description ?? null,
    sector_id: data.sector_id,
    expense_type_id: data.expense_type_id ?? null,
    supplier_id: data.supplier_id ?? null,
    due_date: data.due_date ?? null,
    payment_method: data.payment_method,
    justification: data.justification ?? null,
    observations: data.observations ?? null,
    event_id: data.event_id ?? null,
    supplier_issues_invoice: data.supplier_issues_invoice ?? null,
    invoice_number: data.invoice_number ?? null,
    bank_name: data.bank_name ?? null,
    bank_agency: data.bank_agency ?? null,
    bank_account: data.bank_account ?? null,
    bank_account_digit: data.bank_account_digit ?? null,
    bank_cpf_cnpj: data.bank_cpf_cnpj ?? null,
    pix_key: data.pix_key ?? null,
    pix_key_type: data.pix_key_type ?? null,
    favorecido: data.favorecido ?? null,
    barcode: data.barcode ?? null,
    attachment_path: data.attachment_path ?? null,
    invoice_attachment_path: data.invoice_attachment_path ?? null,
    needs_credit_card: data.needs_credit_card ?? null,
    is_budgeted: verification?.isBudgeted ?? false,
    approval_tier: approvalTier,
    is_recurring: data.is_recurring ?? false,
    recurrence_group_id: recurrenceGroupId,
    installment_group_id: installmentGroupId,
    created_by: ctx.id,
    approved_by: null,
    approved_at: null,
  };

  // First (or only) request
  const firstDueDate =
    isInstallment && installmentDates.length > 0
      ? installmentDates[0].dueDate
      : data.due_date;
  const firstMonth =
    isInstallment && installmentDates.length > 0
      ? installmentDates[0].month
      : data.reference_month;
  const firstYear =
    isInstallment && installmentDates.length > 0
      ? installmentDates[0].year
      : data.reference_year;
  const firstTitle = isInstallment
    ? `${data.title} — Parcela 1/${data.installments}`
    : data.title;

  const { data: newReq, error: insertError } = await supabase
    .from("ctrl_requests")
    .insert({
      ...baseFields,
      title: firstTitle,
      amount: unitAmount,
      reference_month: firstMonth,
      reference_year: firstYear,
      due_date: firstDueDate ?? data.due_date ?? null,
      installment_number: isInstallment ? 1 : null,
      installment_total: isInstallment ? data.installments : null,
      status: initialStatus,
      approval_level: approvalTier === "nivel_3" ? 2 : 1,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    .select("id, request_number")
    .single();

  if (insertError || !newReq) {
    return { error: insertError?.message ?? "Erro ao criar requisição." };
  }

  // History for first request
  const histComment = verification
    ? `${verification.statusLabel}. Saldo atual: ${new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(verification.currentBalance)}`
    : "Requisição criada.";

  await supabase.from("ctrl_history").insert({
    request_id: newReq.id,
    user_id: ctx.id,
    action: "criado",
    comment: histComment,
    metadata: verification
      ? {
          approval_tier: approvalTier,
          current_balance: verification.currentBalance,
          future_balance: verification.futureBalance,
        }
      : null,
  });

  {
    const { data: sec } = await supabase
      .from("ctrl_sectors")
      .select("name")
      .eq("id", data.sector_id)
      .single();

    // Etapa inicial e quem notificar. Sem auto-aprovação.
    const stage: "gerente" | "diretor" = forceDirector ? "diretor" : "gerente";
    let explicitApproverIds: string[] | undefined;
    if (directorOnly) {
      explicitApproverIds = [APPROVAL_ROUTING.directorOnly.directorId];
    } else if (
      !forceDirector &&
      data.expense_type_id === APPROVAL_ROUTING.expenseTypeManager.expenseTypeId
    ) {
      explicitApproverIds = [APPROVAL_ROUTING.expenseTypeManager.managerId];
    }
    // Setor Diretoria (directorSectorOnly): stage 'diretor' sem explicitApproverIds
    // → notifyPendingApproval avisa todos os diretores.

    await notifyPendingApproval({
      requestId: newReq.id,
      requestNumber: newReq.request_number,
      requesterName: ctx.name ?? ctx.email,
      sectorId: data.sector_id,
      sectorName: sec?.name ?? "Setor",
      amount: data.amount,
      stage,
      explicitApproverIds,
    });
  }

  let totalCreated = 1;

  // Installment parcels 2..N
  if (isInstallment && installmentDates.length > 1) {
    for (let i = 1; i < installmentDates.length; i++) {
      const inst = installmentDates[i];
      const isLast = i === installmentDates.length - 1;
      const instAmount = isLast
        ? Math.round((data.amount - unitAmount * (data.installments! - 1)) * 100) / 100
        : unitAmount;

      let instVerification: BudgetVerification | null = null;
      if (data.expense_type_id) {
        instVerification = await performBudgetVerification(
          supabase,
          data.sector_id,
          data.expense_type_id,
          instAmount,
          inst.month,
          inst.year
        );
      }
      const instTier: ApprovalTier = forceDirector
        ? "nivel_3"
        : instVerification?.approvalTier ?? "nivel_2";
      const instStatus: CtrlRequestStatus = forceDirector ? "pendente_diretor" : "pendente";

      const { data: instReq } = await supabase
        .from("ctrl_requests")
        .insert({
          ...baseFields,
          title: `${data.title} — Parcela ${inst.installment}/${data.installments}`,
          amount: instAmount,
          reference_month: inst.month,
          reference_year: inst.year,
          due_date: inst.dueDate,
          installment_number: inst.installment,
          installment_total: data.installments,
          status: instStatus,
          approval_level: instTier === "nivel_3" ? 2 : 1,
          approval_tier: instTier,
          approved_by: null,
          approved_at: null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any)
        .select("id, request_number")
        .single();

      if (instReq) {
        totalCreated++;
        await supabase.from("ctrl_history").insert({
          request_id: instReq.id,
          user_id: ctx.id,
          action: "criado",
          comment: `Parcela ${inst.installment}/${data.installments} (grupo #${newReq.request_number})`,
        });
      }
    }
  }

  // Recurrence — additional months
  if (data.is_recurring && recurrenceGroupId && (data.recurrence_months?.length ?? 0) > 0) {
    await supabase
      .from("ctrl_recurrence_groups")
      .update({ original_request_id: newReq.id })
      .eq("id", recurrenceGroupId);

    for (const month of data.recurrence_months!) {
      let monthVerification: BudgetVerification | null = null;
      if (data.expense_type_id) {
        monthVerification = await performBudgetVerification(
          supabase,
          data.sector_id,
          data.expense_type_id,
          data.amount,
          month,
          data.reference_year
        );
      }
      const monthTier: ApprovalTier = forceDirector
        ? "nivel_3"
        : monthVerification?.approvalTier ?? "nivel_2";
      const monthStatus: CtrlRequestStatus = forceDirector ? "pendente_diretor" : "pendente";

      const { data: recReq } = await supabase
        .from("ctrl_requests")
        .insert({
          ...baseFields,
          title: data.title,
          amount: data.amount,
          reference_month: month,
          reference_year: data.reference_year,
          // Cada recorrência vence no mesmo dia escolhido, mas no seu próprio mês.
          due_date: dueDateForRecurrence(data.due_date, month, data.reference_year),
          status: monthStatus,
          approval_level: monthTier === "nivel_3" ? 2 : 1,
          approval_tier: monthTier,
          approved_by: null,
          approved_at: null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any)
        .select("id, request_number")
        .single();

      if (recReq) {
        totalCreated++;
        await supabase.from("ctrl_history").insert({
          request_id: recReq.id,
          user_id: ctx.id,
          action: "criado",
          comment: `Recorrente (grupo #${newReq.request_number}) — mês ${month}/${data.reference_year}`,
        });
      }
    }
  }

  revalidatePath("/ctrl/requisicoes");
  revalidatePath("/ctrl/aprovacoes");
  return {
    requestId: newReq.id,
    requestNumber: newReq.request_number,
    totalCreated,
    autoApproved: false,
    verification,
  };
}

// ─── Get Requests ─────────────────────────────────────────────────────────────

// Generates a short-lived signed URL for the attachment of a single request.
// Returns null path when the request has no attachment.
export async function getRequestAttachmentUrl(requestId: string) {
  await requireCtrlRole(
    "solicitante",
    "gerente",
    "diretor",
    "csc",
    "contas_a_pagar",
    "admin",
  );
  const supabase = await createClient();

  const { data: req, error } = await supabase
    .from("ctrl_requests")
    .select("attachment_path")
    .eq("id", requestId)
    .maybeSingle<{ attachment_path: string | null }>();

  if (error) return { error: error.message };
  if (!req?.attachment_path) return { error: "Esta requisição não possui anexo." };

  // 5 min window. Long enough to click + download; short enough that leaked
  // URLs are stale fast. The bucket has RLS too — admin client just shortcuts
  // the signing path so users with broad CTRL visibility (CSC, contas_a_pagar)
  // can read attachments uploaded by other users.
  const admin = createAdminClientIfAvailable() ?? supabase;
  const { data: signed, error: signErr } = await admin.storage
    .from("ctrl-attachments")
    .createSignedUrl(req.attachment_path, 60 * 5);

  if (signErr) return { error: signErr.message };
  return { url: signed.signedUrl };
}

export async function getRequests(filters?: {
  status?: CtrlRequestStatus;
  sector_id?: string;
  statuses?: CtrlRequestStatus[];
}) {
  const ctx = await requireCtrlRole(
    "solicitante",
    "gerente",
    "diretor",
    "csc",
    "contas_a_pagar",
    "admin"
  );
  const supabase = await createClient();

  let query = supabase
    .from("ctrl_requests")
    .select(
      `*, ctrl_sectors(name), ctrl_expense_types(name),
       ctrl_suppliers(name, cnpj_cpf, chave_pix, banco, agencia, conta_corrente, titular_banco),
       creator:users!ctrl_requests_created_by_fkey(name, email),
       approver:users!ctrl_requests_approved_by_fkey(name, email)`
    )
    .order("created_at", { ascending: false });

  if (filters?.status) query = query.eq("status", filters.status);
  if (filters?.statuses?.length) query = query.in("status", filters.statuses);
  if (filters?.sector_id) query = query.eq("sector_id", filters.sector_id);

  // Visibilidade em tres niveis:
  //  - Global (admin, csc, contas_a_pagar): ve todas as requisicoes.
  //  - Por setor (gerente, diretor): ve apenas as requisicoes dos setores aos
  //    quais esta vinculado em user_sectors. Sem vinculo => fallback ve tudo,
  //    pra nao quebrar o fluxo enquanto os cadastros estao incompletos (mesma
  //    regra usada em notifyPendingApproval).
  //  - Solicitante (nenhum dos anteriores): apenas as proprias requisicoes.
  const hasGlobalVisibility = ctx.ctrlRoles.some((r) =>
    ["csc", "admin", "contas_a_pagar"].includes(r),
  );
  const hasSectorVisibility = ctx.ctrlRoles.some((r) =>
    ["gerente", "diretor"].includes(r),
  );
  if (!hasGlobalVisibility) {
    if (hasSectorVisibility) {
      if (ctx.sectorIds.length > 0) {
        query = query.in("sector_id", ctx.sectorIds);
      }
      // sem vinculo de setor => sem restricao (fallback ve tudo)
    } else {
      query = query.eq("created_by", ctx.id);
    }
  }

  const { data, error } = await query;
  if (error) return { error: error.message };
  return { requests: data ?? [] };
}

// ─── Approve ──────────────────────────────────────────────────────────────────

type ApprovableReq = {
  id: string;
  status: string;
  approval_tier: string | null;
  sector_id: string;
  amount: number;
  created_by: string;
  request_number: number;
};

// Notifica os diretores quando uma requisição fora do orçamento avança da etapa
// do gerente para a do diretor. Solicitante especial → diretor específico.
async function notifyDirectorStage(
  supabase: Awaited<ReturnType<typeof createClient>>,
  req: ApprovableReq,
) {
  const directorOnly = req.created_by === APPROVAL_ROUTING.directorOnly.requesterId;
  const explicitApproverIds = directorOnly
    ? [APPROVAL_ROUTING.directorOnly.directorId]
    : undefined;

  const { data: sec } = await supabase
    .from("ctrl_sectors")
    .select("name")
    .eq("id", req.sector_id)
    .maybeSingle();
  const { data: requester } = await supabase
    .from("users")
    .select("name, email")
    .eq("id", req.created_by)
    .maybeSingle();

  await notifyPendingApproval({
    requestId: req.id,
    requestNumber: req.request_number,
    requesterName:
      (requester?.name as string) ?? (requester?.email as string) ?? "Solicitante",
    sectorId: req.sector_id,
    sectorName: (sec?.name as string) ?? "Setor",
    amount: Number(req.amount),
    stage: "diretor",
    explicitApproverIds,
  });
}

// Aplica uma etapa de aprovação. Fluxo:
//   pendente (gerente) → nivel_2: aprovado · nivel_3: pendente_diretor
//   pendente_diretor (diretor) → aprovado
// Não restringe a pessoa específica (qualquer gerente/diretor pode aprovar a
// etapa correspondente); o direcionamento é só via notificação.
async function applyApprovalStep(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ctx: Awaited<ReturnType<typeof requireCtrlRole>>,
  req: ApprovableReq,
  comment?: string,
): Promise<{ ok: true; finalized: boolean } | { error: string }> {
  const now = new Date().toISOString();

  if (req.status === "pendente_diretor") {
    const isDirector = ctx.ctrlRoles.some((r) => ["diretor", "csc", "admin"].includes(r));
    if (!isDirector) return { error: "Esta etapa requer aprovação do Diretor." };

    const { error } = await supabase
      .from("ctrl_requests")
      .update({ status: "aprovado", approved_by: ctx.id, approved_at: now, updated_at: now })
      .eq("id", req.id);
    if (error) return { error: error.message };

    await supabase.from("ctrl_history").insert({
      request_id: req.id,
      user_id: ctx.id,
      action: "aprovado",
      comment: comment?.trim() || `Aprovada pelo Diretor ${ctx.name ?? ctx.email}`,
      metadata: { approver_roles: ctx.ctrlRoles, stage: "diretor" },
    });
    await notifyRequester({
      userId: req.created_by,
      requestId: req.id,
      requestNumber: req.request_number,
      title: "Requisição Aprovada",
      message: `Sua requisição #${req.request_number} foi aprovada por ${ctx.name ?? ctx.email}.`,
      type: "aprovacao",
    });
    return { ok: true, finalized: true };
  }

  // status === "pendente" → etapa do gerente.
  if ((req.approval_tier as string) === "nivel_3") {
    // Fora do orçamento: gerente aprovou, encaminha ao diretor.
    const { error } = await supabase
      .from("ctrl_requests")
      .update({ status: "pendente_diretor", updated_at: now })
      .eq("id", req.id);
    if (error) return { error: error.message };

    await supabase.from("ctrl_history").insert({
      request_id: req.id,
      user_id: ctx.id,
      action: "aprovado",
      comment:
        comment?.trim() ||
        `Aprovada pelo Gerente ${ctx.name ?? ctx.email} — encaminhada ao Diretor`,
      metadata: { approver_roles: ctx.ctrlRoles, stage: "gerente" },
    });
    await notifyDirectorStage(supabase, req);
    await notifyRequester({
      userId: req.created_by,
      requestId: req.id,
      requestNumber: req.request_number,
      title: "Aprovada pelo Gerente",
      message: `Sua requisição #${req.request_number} foi aprovada pelo gerente e aguarda o Diretor.`,
      type: "aprovacao",
    });
    return { ok: true, finalized: false };
  }

  // Dentro do orçamento: aprovação final pelo gerente.
  const { error } = await supabase
    .from("ctrl_requests")
    .update({ status: "aprovado", approved_by: ctx.id, approved_at: now, updated_at: now })
    .eq("id", req.id);
  if (error) return { error: error.message };

  await supabase.from("ctrl_history").insert({
    request_id: req.id,
    user_id: ctx.id,
    action: "aprovado",
    comment: comment?.trim() || `Aprovada por ${ctx.name ?? ctx.email} (${ctx.ctrlRoles.join(", ")})`,
    metadata: { approver_roles: ctx.ctrlRoles, stage: "gerente" },
  });
  await notifyRequester({
    userId: req.created_by,
    requestId: req.id,
    requestNumber: req.request_number,
    title: "Requisição Aprovada",
    message: `Sua requisição #${req.request_number} foi aprovada por ${ctx.name ?? ctx.email}.`,
    type: "aprovacao",
  });
  return { ok: true, finalized: true };
}

export async function approveRequest(requestId: string, comment?: string) {
  const ctx = await requireCtrlRole("gerente", "diretor", "csc", "admin");
  const adminClient = createAdminClientIfAvailable();
  const supabase = adminClient ?? (await createClient());

  const { data: req, error: fetchErr } = await supabase
    .from("ctrl_requests")
    .select("id, status, approval_tier, sector_id, amount, created_by, request_number")
    .eq("id", requestId)
    .single();

  if (fetchErr || !req) return { error: "Requisição não encontrada." };
  if (req.status !== "pendente" && req.status !== "pendente_diretor")
    return { error: `Status atual: ${req.status}. Só é possível aprovar requisições pendentes.` };

  const result = await applyApprovalStep(supabase, ctx, req as ApprovableReq, comment);
  if ("error" in result) return result;

  revalidatePath("/ctrl/requisicoes");
  revalidatePath("/ctrl/aprovacoes");
  return { ok: true };
}

// ─── Reject ───────────────────────────────────────────────────────────────────

export async function rejectRequest(requestId: string, reason: string) {
  const ctx = await requireCtrlRole("gerente", "diretor", "csc", "admin");
  if (!reason.trim()) return { error: "Motivo da rejeição é obrigatório." };

  const adminClient = createAdminClientIfAvailable();
  const supabase = adminClient ?? (await createClient());

  const { data: req } = await supabase
    .from("ctrl_requests")
    .select("id, status, created_by, request_number")
    .eq("id", requestId)
    .single();

  if (!req) return { error: "Requisição não encontrada." };
  if (
    req.status !== "pendente" &&
    req.status !== "pendente_diretor" &&
    req.status !== "aguardando_complementacao"
  )
    return { error: `Status atual: ${req.status}. Não é possível rejeitar.` };

  await supabase
    .from("ctrl_requests")
    .update({
      status: "rejeitado",
      rejected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", requestId);

  await supabase.from("ctrl_history").insert({
    request_id: requestId,
    user_id: ctx.id,
    action: "rejeitado",
    comment: reason.trim(),
    metadata: { approver_roles: ctx.ctrlRoles, rejection_reason: reason.trim() },
  });

  await notifyRequester({
    userId: req.created_by,
    requestId,
    requestNumber: req.request_number,
    title: "Requisição Rejeitada",
    message: `Sua requisição #${req.request_number} foi rejeitada por ${ctx.name ?? ctx.email}. Motivo: ${reason.trim()}`,
    type: "rejeicao",
  });

  revalidatePath("/ctrl/requisicoes");
  revalidatePath("/ctrl/aprovacoes");
  return { ok: true };
}

// ─── Request Info (pedir complementação) ─────────────────────────────────────

export async function requestInfo(requestId: string, question: string) {
  const ctx = await requireCtrlRole("gerente", "diretor", "csc", "admin");
  if (!question.trim()) return { error: "Informe a pergunta." };

  const adminClient = createAdminClientIfAvailable();
  const supabase = adminClient ?? (await createClient());

  const { data: req } = await supabase
    .from("ctrl_requests")
    .select("id, status, created_by, request_number")
    .eq("id", requestId)
    .single();

  if (!req) return { error: "Requisição não encontrada." };
  if (req.status !== "pendente" && req.status !== "pendente_diretor")
    return { error: "Só é possível pedir informação de requisições pendentes." };

  // Guarda a etapa de origem para retornar a ela quando o solicitante responder.
  await supabase
    .from("ctrl_requests")
    .update({
      status: "aguardando_complementacao",
      complement_return_status: req.status,
      updated_at: new Date().toISOString(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    .eq("id", requestId);

  await supabase.from("ctrl_history").insert({
    request_id: requestId,
    user_id: ctx.id,
    action: "complementacao_solicitada",
    comment: question.trim(),
    metadata: { requested_by_roles: ctx.ctrlRoles },
  });

  await notifyRequester({
    userId: req.created_by,
    requestId,
    requestNumber: req.request_number,
    title: "Informação Solicitada",
    message: `${ctx.name ?? ctx.email} solicitou informação sobre a requisição #${req.request_number}: "${question.trim()}"`,
    type: "info_solicitada",
  });

  revalidatePath("/ctrl/aprovacoes");
  return { ok: true };
}

// ─── Answer Complement ────────────────────────────────────────────────────────

export async function answerComplement(requestId: string, answer: string) {
  const ctx = await requireCtrlRole(
    "solicitante",
    "gerente",
    "diretor",
    "csc",
    "admin"
  );
  if (!answer.trim()) return { error: "Resposta é obrigatória." };

  const adminClient = createAdminClientIfAvailable();
  const supabase = adminClient ?? (await createClient());

  // Volta para a etapa de onde saiu (gerente ou diretor). Fallback: deriva do
  // solicitante (especial → diretor; demais → gerente).
  const { data: cur } = await supabase
    .from("ctrl_requests")
    .select("created_by, complement_return_status")
    .eq("id", requestId)
    .maybeSingle<{ created_by: string; complement_return_status: string | null }>();

  const returnStatus: CtrlRequestStatus =
    (cur?.complement_return_status as CtrlRequestStatus | null) ??
    (cur?.created_by === APPROVAL_ROUTING.directorOnly.requesterId
      ? "pendente_diretor"
      : "pendente");

  await supabase
    .from("ctrl_requests")
    .update({
      status: returnStatus,
      complement_return_status: null,
      updated_at: new Date().toISOString(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    .eq("id", requestId);

  await supabase.from("ctrl_history").insert({
    request_id: requestId,
    user_id: ctx.id,
    action: "complementado",
    comment: answer.trim(),
  });

  revalidatePath("/ctrl/requisicoes");
  revalidatePath("/ctrl/aprovacoes");
  return { ok: true };
}

// Retorna a última pergunta de complementação feita pelo aprovador, para o
// solicitante saber o que responder. Usa admin client (a RLS de ctrl_history não
// expõe a linha do aprovador ao solicitante); a autorização é por papel + dono.
export async function getComplementQuestion(
  requestId: string,
): Promise<{ question: string | null; askedBy: string | null } | { error: string }> {
  const ctx = await requireCtrlRole(
    "solicitante",
    "gerente",
    "diretor",
    "csc",
    "contas_a_pagar",
    "admin",
  );
  const adminClient = createAdminClientIfAvailable();
  const supabase = adminClient ?? (await createClient());

  const { data: req } = await supabase
    .from("ctrl_requests")
    .select("created_by")
    .eq("id", requestId)
    .maybeSingle<{ created_by: string }>();

  if (!req) return { error: "Requisição não encontrada." };

  const hasBroadVisibility = ctx.ctrlRoles.some((r) =>
    ["gerente", "diretor", "csc", "admin", "contas_a_pagar"].includes(r),
  );
  if (!hasBroadVisibility && req.created_by !== ctx.id) {
    return { error: "Sem acesso a esta requisição." };
  }

  const { data: hist } = await supabase
    .from("ctrl_history")
    .select("comment, user_id, created_at")
    .eq("request_id", requestId)
    .eq("action", "complementacao_solicitada")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ comment: string | null; user_id: string; created_at: string }>();

  if (!hist) return { question: null, askedBy: null };

  const { data: asker } = await supabase
    .from("users")
    .select("name, email")
    .eq("id", hist.user_id)
    .maybeSingle<{ name: string | null; email: string | null }>();

  return {
    question: hist.comment,
    askedBy: asker?.name ?? asker?.email ?? null,
  };
}

// ─── Payment info (pedir info ao solicitante na fase de pagamento) ───────────
//
// Diferente do fluxo de aprovacao (requestInfo/answerComplement), este e' usado
// pelo contas_a_pagar quando a requisicao ja esta aprovada mas precisa de
// esclarecimento antes do envio. Bloqueia o envio enquanto a info esta pendente.
// Multiplas trocas formam uma thread (cada turno e' uma linha em ctrl_history
// com action info_pagamento_solicitada ou info_pagamento_respondida).

export async function requestPaymentInfo(requestId: string, question: string) {
  const ctx = await requireCtrlRole("contas_a_pagar", "csc", "admin");
  if (!question.trim()) return { error: "Informe a pergunta." };

  const adminClient = createAdminClientIfAvailable();
  const supabase = adminClient ?? (await createClient());

  const { data: req } = await supabase
    .from("ctrl_requests")
    .select("id, status, created_by, request_number")
    .eq("id", requestId)
    .single();

  if (!req) return { error: "Requisição não encontrada." };
  // Aceita pedir info enquanto a requisicao esta aguardando envio (aprovado)
  // ou ja em outra rodada de info pendente (contas_a_pagar pergunta de novo
  // sem precisar de uma resposta antes — caso raro mas valido).
  if (req.status !== "aprovado" && req.status !== "info_pagamento_pendente") {
    return { error: `Status atual: ${req.status}. Não é possível pedir info.` };
  }

  await supabase
    .from("ctrl_requests")
    .update({ status: "info_pagamento_pendente", updated_at: new Date().toISOString() })
    .eq("id", requestId);

  await supabase.from("ctrl_history").insert({
    request_id: requestId,
    user_id: ctx.id,
    action: "info_pagamento_solicitada",
    comment: question.trim(),
    metadata: { requested_by_roles: ctx.ctrlRoles },
  });

  await notifyRequester({
    userId: req.created_by,
    requestId,
    requestNumber: req.request_number,
    title: "Info solicitada (pagamento)",
    message: `${ctx.name ?? ctx.email} solicitou informação sobre a requisição #${req.request_number} antes do envio para pagamento: "${question.trim()}"`,
    type: "info_pagamento_solicitada",
  });

  revalidatePath("/ctrl/contas-a-pagar");
  revalidatePath("/ctrl/requisicoes");
  return { ok: true };
}

export async function answerPaymentInfo(requestId: string, answer: string) {
  const ctx = await requireCtrlRole(
    "solicitante",
    "gerente",
    "diretor",
    "csc",
    "admin",
  );
  if (!answer.trim()) return { error: "Resposta é obrigatória." };

  const adminClient = createAdminClientIfAvailable();
  const supabase = adminClient ?? (await createClient());

  const { data: req } = await supabase
    .from("ctrl_requests")
    .select("id, status, created_by, request_number")
    .eq("id", requestId)
    .single();

  if (!req) return { error: "Requisição não encontrada." };
  if (req.status !== "info_pagamento_pendente") {
    return { error: "Esta requisição não está aguardando informação." };
  }

  // Resposta libera a requisicao para envio — volta para 'aprovado'.
  await supabase
    .from("ctrl_requests")
    .update({ status: "aprovado", updated_at: new Date().toISOString() })
    .eq("id", requestId);

  await supabase.from("ctrl_history").insert({
    request_id: requestId,
    user_id: ctx.id,
    action: "info_pagamento_respondida",
    comment: answer.trim(),
  });

  // Notifica quem solicitou (ultimo info_pagamento_solicitada). Util pra
  // contas_a_pagar saber que ja pode prosseguir com o envio.
  const { data: lastAsk } = await supabase
    .from("ctrl_history")
    .select("user_id")
    .eq("request_id", requestId)
    .eq("action", "info_pagamento_solicitada")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastAsk?.user_id) {
    await notifyRequester({
      userId: lastAsk.user_id as string,
      requestId,
      requestNumber: req.request_number,
      title: "Info respondida (pagamento)",
      message: `${ctx.name ?? ctx.email} respondeu à solicitação de info sobre a requisição #${req.request_number}.`,
      type: "info_pagamento_respondida",
    });
  }

  revalidatePath("/ctrl/contas-a-pagar");
  revalidatePath("/ctrl/requisicoes");
  return { ok: true };
}

export interface PaymentInfoMessage {
  id: string;
  authorId: string;
  authorName: string | null;
  authorEmail: string | null;
  authorKind: "solicitante" | "contas_a_pagar";
  message: string;
  createdAt: string;
}

export async function getPaymentInfoThread(
  requestId: string,
): Promise<{ messages?: PaymentInfoMessage[]; error?: string }> {
  await requireCtrlRole(
    "solicitante",
    "gerente",
    "diretor",
    "csc",
    "contas_a_pagar",
    "admin",
  );
  const adminClient = createAdminClientIfAvailable();
  const supabase = adminClient ?? (await createClient());

  const { data, error } = await supabase
    .from("ctrl_history")
    .select(
      `id, user_id, action, comment, created_at,
       user:users!ctrl_history_user_id_fkey(name, email)`,
    )
    .eq("request_id", requestId)
    .in("action", ["info_pagamento_solicitada", "info_pagamento_respondida"])
    .order("created_at", { ascending: true });

  if (error) return { error: error.message };

  type Row = {
    id: string;
    user_id: string;
    action: "info_pagamento_solicitada" | "info_pagamento_respondida";
    comment: string | null;
    created_at: string;
    user:
      | { name: string | null; email: string | null }
      | Array<{ name: string | null; email: string | null }>
      | null;
  };
  const messages: PaymentInfoMessage[] = ((data ?? []) as Row[]).map((row) => {
    const u = Array.isArray(row.user) ? row.user[0] ?? null : row.user;
    return {
      id: row.id,
      authorId: row.user_id,
      authorName: u?.name ?? null,
      authorEmail: u?.email ?? null,
      authorKind: row.action === "info_pagamento_solicitada" ? "contas_a_pagar" : "solicitante",
      message: row.comment ?? "",
      createdAt: row.created_at,
    };
  });

  return { messages };
}

// ─── Reverse (estorno) ────────────────────────────────────────────────────────

export async function reverseRequest(requestId: string, reason: string) {
  const ctx = await requireCtrlRole("diretor", "admin");
  if (!reason.trim()) return { error: "Motivo do estorno é obrigatório." };

  const adminClient = createAdminClientIfAvailable();
  const supabase = adminClient ?? (await createClient());

  const { data: req } = await supabase
    .from("ctrl_requests")
    .select("id, status, created_by, request_number, amount")
    .eq("id", requestId)
    .single();

  if (!req) return { error: "Requisição não encontrada." };
  if (req.status !== "aprovado")
    return { error: "Apenas requisições aprovadas podem ser estornadas." };

  await supabase
    .from("ctrl_requests")
    .update({
      status: "estornado",
      reversed_at: new Date().toISOString(),
      reversal_reason: reason.trim(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", requestId);

  await supabase.from("ctrl_history").insert({
    request_id: requestId,
    user_id: ctx.id,
    action: "estornado",
    comment: reason.trim(),
    metadata: {
      reversed_by_roles: ctx.ctrlRoles,
      amount: req.amount,
      reason: reason.trim(),
    },
  });

  await notifyRequester({
    userId: req.created_by,
    requestId,
    requestNumber: req.request_number,
    title: "Requisição Estornada",
    message: `Sua requisição #${req.request_number} foi estornada por ${ctx.name ?? ctx.email}. Motivo: ${reason.trim()}`,
    type: "estorno",
  });

  revalidatePath("/ctrl/requisicoes");
  revalidatePath("/ctrl/aprovacoes");
  return { ok: true };
}

// ─── Batch Approve ────────────────────────────────────────────────────────────

export async function batchApproveRequests(
  requestIds: string[],
  comment?: string
) {
  const ctx = await requireCtrlRole("gerente", "diretor", "csc", "admin");
  if (requestIds.length === 0) return { approved: 0, failed: 0, results: [] };
  if (requestIds.length > 50)
    return { error: "Máximo de 50 requisições por lote." };

  const adminClient = createAdminClientIfAvailable();
  const supabase = adminClient ?? (await createClient());

  const { data: requests } = await supabase
    .from("ctrl_requests")
    .select("id, status, approval_tier, sector_id, amount, created_by, request_number")
    .in("id", requestIds);

  if (!requests) return { error: "Erro ao buscar requisições." };

  const results: { id: string; number: number; ok: boolean; error?: string }[] =
    [];

  for (const req of requests) {
    if (req.status !== "pendente" && req.status !== "pendente_diretor") {
      results.push({ id: req.id, number: req.request_number, ok: false, error: "Não está pendente." });
      continue;
    }

    const res = await applyApprovalStep(supabase, ctx, req as ApprovableReq, comment);
    if ("error" in res) {
      results.push({ id: req.id, number: req.request_number, ok: false, error: res.error });
      continue;
    }
    results.push({ id: req.id, number: req.request_number, ok: true });
  }

  revalidatePath("/ctrl/aprovacoes");
  revalidatePath("/ctrl/requisicoes");

  return {
    approved: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
}

// ─── Preview de previsões (antes de enviar para pagamento) ──────────────────

export interface PrevisaoMatch {
  requestId: string;
  requestNumber: number;
  supplierName: string;
  amount: number;
  dueDate: string | null;
  previsao:
    | { codigo: number; valorAtual: number; vencimento: string; observacao: string }
    | null;
}

export async function previewPrevisaoMatches(
  requestIds: string[],
  payingCompanyId: string,
): Promise<{ ok: true; matches: PrevisaoMatch[] } | { error: string }> {
  await requireCtrlRole("gerente", "diretor", "csc", "contas_a_pagar", "admin");
  if (!payingCompanyId) return { error: "Empresa pagadora é obrigatória." };

  const adminClient = createAdminClientIfAvailable();
  const supabase = adminClient ?? (await createClient());

  const { data: company } = await supabase
    .from("companies")
    .select("id, omie_app_key, omie_app_secret")
    .eq("id", payingCompanyId)
    .maybeSingle();

  if (!company?.omie_app_key || !company?.omie_app_secret) {
    return { error: "Empresa pagadora sem conexão Omie." };
  }

  const { decryptSecret } = await import("@/lib/security/encryption");
  const { findPrevisaoContaPagar } = await import("@/lib/omie/contapagar");
  const appKey = decryptSecret(company.omie_app_key as string);
  const appSecret = decryptSecret(company.omie_app_secret as string);

  const { data: reqs } = await supabase
    .from("ctrl_requests")
    .select(
      "id, request_number, amount, due_date, reference_year, reference_month, supplier_id, ctrl_suppliers(name, cnpj_cpf)",
    )
    .in("id", requestIds)
    .eq("status", "aprovado");

  const matches: PrevisaoMatch[] = [];
  for (const r of reqs ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sup = (r as any).ctrl_suppliers as { name?: string; cnpj_cpf?: string } | null;
    const dueDateIso: string =
      (r.due_date as string | null) ??
      `${r.reference_year}-${String(r.reference_month).padStart(2, "0")}-01`;

    let previsao: PrevisaoMatch["previsao"] = null;
    if (sup?.cnpj_cpf) {
      try {
        const p = await findPrevisaoContaPagar(
          appKey,
          appSecret,
          sup.cnpj_cpf,
          dueDateIso,
          Number(r.amount),
        );
        // findPrevisaoContaPagar usa `codigoLancamentoOmie`; o tipo de UI usa `codigo`.
        previsao = p
          ? {
              codigo: p.codigoLancamentoOmie,
              valorAtual: p.valorAtual,
              vencimento: p.vencimento,
              observacao: p.observacao,
            }
          : null;
      } catch {
        // Best-effort: falha na consulta → trata como "sem previsão" (cria novo).
        previsao = null;
      }
    }

    matches.push({
      requestId: r.id as string,
      requestNumber: Number(r.request_number),
      supplierName: sup?.name ?? "—",
      amount: Number(r.amount),
      dueDate: (r.due_date as string | null) ?? null,
      previsao,
    });
  }

  return { ok: true, matches };
}

// ─── Send to Payment ──────────────────────────────────────────────────────────

export async function sendToPayment(
  requestIds: string[],
  payingCompanyId: string,
  decisoes?: Record<string, number | "novo">,
) {
  const ctx = await requireCtrlRole("gerente", "diretor", "csc", "contas_a_pagar", "admin");

  if (!payingCompanyId) return { error: "Empresa pagadora é obrigatória." };

  const adminClient = createAdminClientIfAvailable();
  const supabase = adminClient ?? (await createClient());

  // Validate company and Omie credentials
  const { data: company, error: compErr } = await supabase
    .from("companies")
    .select("id, name, omie_app_key, omie_app_secret")
    .eq("id", payingCompanyId)
    .maybeSingle();

  if (compErr || !company) return { error: "Empresa pagadora não encontrada." };
  if (!company.omie_app_key || !company.omie_app_secret) {
    return { error: "Empresa pagadora sem conexão Omie." };
  }

  const now = new Date().toISOString();
  const companyName = company.name as string;

  const { error } = await supabase
    .from("ctrl_requests")
    .update({
      status: "agendado",
      sent_to_payment_at: now,
      sent_to_payment_by: ctx.id,
      paying_company_id: payingCompanyId,
      paying_company: companyName,
      updated_at: now,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    .in("id", requestIds)
    .eq("status", "aprovado");

  if (error) return { error: error.message };

  await supabase.from("ctrl_history").insert(
    requestIds.map((id) => ({
      request_id: id,
      user_id: ctx.id,
      action: "enviado_pagamento" as const,
      comment: `Empresa pagadora: ${companyName}`,
    }))
  );

  // Launch each request to Omie
  const { launchRequestToOmie } = await import("@/lib/ctrl/actions/contapagar-launch");
  const results: { id: string; ok?: boolean; status?: string; error?: string }[] = [];

  for (const id of requestIds) {
    const decisao = decisoes?.[id];
    const previsaoCodigo = typeof decisao === "number" ? decisao : undefined;
    const res = await launchRequestToOmie(supabase, id, payingCompanyId, previsaoCodigo);
    if ("error" in res) {
      // Persist error on the request (covers mapping-incomplete and other pre-launch errors)
      await supabase
        .from("ctrl_requests")
        .update({
          omie_launch_status: "erro",
          omie_launch_error: res.error,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);
      results.push({ id, error: res.error });
    } else {
      results.push({ id, ok: true, status: res.status });
    }
  }

  revalidatePath("/ctrl/contas-a-pagar");
  revalidatePath("/ctrl/requisicoes");
  return { ok: true as const, results };
}

// ─── Inactivate ───────────────────────────────────────────────────────────────

export async function inactivateRequests(requestIds: string[], reason: string) {
  const ctx = await requireCtrlRole("csc", "admin");
  if (!reason.trim()) return { error: "Motivo é obrigatório." };

  const adminClient = createAdminClientIfAvailable();
  const supabase = adminClient ?? (await createClient());

  const now = new Date().toISOString();
  const results: { id: string; ok: boolean; error?: string }[] = [];

  const { data: reqs } = await supabase
    .from("ctrl_requests")
    .select("id, request_number, created_by, status")
    .in("id", requestIds);

  for (const req of reqs ?? []) {
    if (req.status !== "agendado" && req.status !== "aprovado") {
      results.push({ id: req.id, ok: false, error: `Status: ${req.status}` });
      continue;
    }

    await supabase
      .from("ctrl_requests")
      .update({
        status: "inativado_csc",
        inactivated_at: now,
        inactivated_by: ctx.id,
        inactivation_reason: reason.trim(),
        updated_at: now,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
      .eq("id", req.id);

    await supabase.from("ctrl_history").insert({
      request_id: req.id,
      user_id: ctx.id,
      action: "inativado_csc" as const,
      comment: reason.trim(),
      metadata: { inactivated_by_roles: ctx.ctrlRoles },
    });

    await notifyRequester({
      userId: req.created_by,
      requestId: req.id,
      requestNumber: req.request_number,
      title: "Requisição Inativada pelo CSC",
      message: `Sua requisição #${req.request_number} foi inativada. Motivo: ${reason.trim()}`,
      type: "inativacao",
    });

    results.push({ id: req.id, ok: true });
  }

  revalidatePath("/ctrl/contas-a-pagar");
  return {
    processed: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
}

// ─── Backward-compat alias ────────────────────────────────────────────────────

export async function updateRequestStatus(
  requestId: string,
  newStatus: CtrlRequestStatus,
  comment?: string
) {
  if (newStatus === "aprovado") return approveRequest(requestId, comment);
  if (newStatus === "rejeitado") return rejectRequest(requestId, comment ?? "");
  if (newStatus === "estornado") return reverseRequest(requestId, comment ?? "");

  await requireCtrlRole("gerente", "diretor", "csc", "admin");
  const adminClient = createAdminClientIfAvailable();
  const supabase = adminClient ?? (await createClient());

  await supabase
    .from("ctrl_requests")
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq("id", requestId);

  revalidatePath("/ctrl/requisicoes");
  revalidatePath("/ctrl/aprovacoes");
  return { ok: true };
}

// ─── Budget Verification (public) ────────────────────────────────────────────

export async function verifyBudget(
  sectorId: string,
  expenseTypeId: string,
  amount: number,
  referenceMonth: number,
  referenceYear: number
): Promise<BudgetVerification | { error: string }> {
  if (!sectorId || !expenseTypeId || amount <= 0) {
    return { error: "Preencha setor, tipo de despesa e valor para verificar." };
  }
  await requireCtrlRole("solicitante", "gerente", "diretor", "csc", "admin");
  // Usa o admin client (igual ao createRequest): a RLS de ctrl_budget só libera
  // leitura para admin/gerente/diretor/csc/contas_a_pagar — um solicitante via
  // client com RLS veria orçamento zerado e a verificação mostraria "não consta"
  // / tier errado, divergindo do que a criação (admin) de fato calcula.
  const adminClient = createAdminClientIfAvailable();
  const supabase = adminClient ?? (await createClient());
  return performBudgetVerification(
    supabase,
    sectorId,
    expenseTypeId,
    amount,
    referenceMonth,
    referenceYear
  );
}
