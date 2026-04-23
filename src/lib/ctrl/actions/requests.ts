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
  | "dinheiro";

export type ApprovalTier = "nivel_2" | "nivel_3";

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
    .select("amount")
    .eq("sector_id", sectorId)
    .eq("expense_type_id", expenseTypeId)
    .eq("period_year", referenceYear)
    .lte("period_month", referenceMonth);

  const budgetedUpToMonth = (budgetUpTo ?? []).reduce(
    (s, b) => s + Number(b.amount),
    0
  );

  // Budget annual Jan → Dec
  const { data: budgetAnnual } = await supabase
    .from("ctrl_budget")
    .select("amount")
    .eq("sector_id", sectorId)
    .eq("expense_type_id", expenseTypeId)
    .eq("period_year", referenceYear);

  const budgetedAnnual = (budgetAnnual ?? []).reduce(
    (s, b) => s + Number(b.amount),
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

  const currentBalance = budgetedUpToMonth - totalApproved;
  const futureBalance = budgetedAnnual - totalApproved;

  // Rule 1: currentBalance >= amount → auto approve
  if (currentBalance >= amount) {
    return {
      approvalTier: "nivel_2",
      autoApproved: true,
      isBudgeted,
      justificationRequired: false,
      currentBalance,
      futureBalance,
      budgetedUpToMonth,
      budgetedAnnual,
      totalApproved,
      statusLabel: `Aprovada automaticamente — saldo atual ${fmt.format(currentBalance)} suficiente`,
    };
  }

  // Rule 2: currentBalance < amount but futureBalance >= amount → gerente
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
      statusLabel: `Pendente — gerente (saldo futuro ${fmt.format(futureBalance)} suficiente)`,
    };
  }

  // Rule 3: futureBalance < amount → diretor + justification required
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
    statusLabel: `Pendente — diretor (saldo anual ${fmt.format(futureBalance)} insuficiente)`,
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

  const approvalTier = verification?.approvalTier ?? "nivel_2";
  const autoApproved = verification?.autoApproved ?? false;
  const initialStatus: CtrlRequestStatus = autoApproved ? "aprovado" : "pendente";

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
    bank_name: data.bank_name ?? null,
    bank_agency: data.bank_agency ?? null,
    bank_account: data.bank_account ?? null,
    bank_account_digit: data.bank_account_digit ?? null,
    bank_cpf_cnpj: data.bank_cpf_cnpj ?? null,
    pix_key: data.pix_key ?? null,
    pix_key_type: data.pix_key_type ?? null,
    favorecido: data.favorecido ?? null,
    barcode: data.barcode ?? null,
    is_budgeted: verification?.isBudgeted ?? false,
    approval_tier: approvalTier,
    is_recurring: data.is_recurring ?? false,
    recurrence_group_id: recurrenceGroupId,
    installment_group_id: installmentGroupId,
    created_by: ctx.id,
    approved_by: autoApproved ? ctx.id : null,
    approved_at: autoApproved ? new Date().toISOString() : null,
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
          auto_approved: autoApproved,
          current_balance: verification.currentBalance,
          future_balance: verification.futureBalance,
        }
      : null,
  });

  if (autoApproved) {
    await supabase.from("ctrl_history").insert({
      request_id: newReq.id,
      user_id: ctx.id,
      action: "aprovado",
      comment: "Aprovação automática — saldo orçamentário suficiente.",
      metadata: { approver_name: "Sistema", auto_approved: true },
    });

    await notifyRequester({
      userId: ctx.id,
      requestId: newReq.id,
      requestNumber: newReq.request_number,
      title: "Requisição Aprovada Automaticamente",
      message: `Sua requisição #${newReq.request_number} foi aprovada automaticamente.`,
      type: "aprovacao",
    });
  } else {
    const { data: sec } = await supabase
      .from("ctrl_sectors")
      .select("name")
      .eq("id", data.sector_id)
      .single();

    await notifyPendingApproval({
      requestId: newReq.id,
      requestNumber: newReq.request_number,
      requesterName: ctx.name ?? ctx.email,
      sectorId: data.sector_id,
      sectorName: sec?.name ?? "Setor",
      amount: data.amount,
      approvalTier,
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
      const instStatus: CtrlRequestStatus = instVerification?.autoApproved
        ? "aprovado"
        : "pendente";

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
          approval_level: (instVerification?.approvalTier ?? "nivel_2") === "nivel_3" ? 2 : 1,
          approval_tier: instVerification?.approvalTier ?? "nivel_2",
          approved_by: instVerification?.autoApproved ? ctx.id : null,
          approved_at: instVerification?.autoApproved ? new Date().toISOString() : null,
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

        if (instVerification?.autoApproved) {
          await supabase.from("ctrl_history").insert({
            request_id: instReq.id,
            user_id: ctx.id,
            action: "aprovado",
            comment: `Aprovação automática — Parcela ${inst.installment}/${data.installments}`,
            metadata: { auto_approved: true },
          });
        }
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
      const monthStatus: CtrlRequestStatus = monthVerification?.autoApproved
        ? "aprovado"
        : "pendente";

      const { data: recReq } = await supabase
        .from("ctrl_requests")
        .insert({
          ...baseFields,
          title: data.title,
          amount: data.amount,
          reference_month: month,
          reference_year: data.reference_year,
          status: monthStatus,
          approval_level: (monthVerification?.approvalTier ?? "nivel_2") === "nivel_3" ? 2 : 1,
          approval_tier: monthVerification?.approvalTier ?? "nivel_2",
          approved_by: monthVerification?.autoApproved ? ctx.id : null,
          approved_at: monthVerification?.autoApproved ? new Date().toISOString() : null,
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
    autoApproved,
    verification,
  };
}

// ─── Get Requests ─────────────────────────────────────────────────────────────

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
      `*, ctrl_sectors(name), ctrl_expense_types(name), ctrl_suppliers(name, cnpj_cpf),
       creator:users!ctrl_requests_created_by_fkey(name, email),
       approver:users!ctrl_requests_approved_by_fkey(name)`
    )
    .order("created_at", { ascending: false });

  if (filters?.status) query = query.eq("status", filters.status);
  if (filters?.statuses?.length) query = query.in("status", filters.statuses);
  if (filters?.sector_id) query = query.eq("sector_id", filters.sector_id);

  // Visibilidade: quem so tem solicitante (e/ou aprovacao_fornecedor) ve apenas as proprias requisicoes.
  const hasBroadVisibility = ctx.ctrlRoles.some((r) =>
    ["gerente", "diretor", "csc", "admin", "contas_a_pagar"].includes(r),
  );
  if (!hasBroadVisibility) {
    query = query.eq("created_by", ctx.id);
  }

  const { data, error } = await query;
  if (error) return { error: error.message };
  return { requests: data ?? [] };
}

// ─── Approve ──────────────────────────────────────────────────────────────────

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
  if (req.status !== "pendente")
    return { error: `Status atual: ${req.status}. Só é possível aprovar requisições pendentes.` };

  // Gerente (sem diretor/csc/admin): only nivel_2
  const hasHigherApproval = ctx.ctrlRoles.some((r) => ["diretor", "csc", "admin"].includes(r));
  if (!hasHigherApproval && (req.approval_tier as string) === "nivel_3") {
    return { error: "Gerente não pode aprovar requisições de nível 3 (Diretor)." };
  }

  const { error } = await supabase
    .from("ctrl_requests")
    .update({
      status: "aprovado",
      approved_by: ctx.id,
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", requestId);

  if (error) return { error: error.message };

  await supabase.from("ctrl_history").insert({
    request_id: requestId,
    user_id: ctx.id,
    action: "aprovado",
    comment: comment?.trim() || `Aprovada por ${ctx.name ?? ctx.email} (${ctx.ctrlRoles.join(", ")})`,
    metadata: { approver_roles: ctx.ctrlRoles },
  });

  await notifyRequester({
    userId: req.created_by,
    requestId,
    requestNumber: req.request_number,
    title: "Requisição Aprovada",
    message: `Sua requisição #${req.request_number} foi aprovada por ${ctx.name ?? ctx.email}.`,
    type: "aprovacao",
  });

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
  if (req.status !== "pendente" && req.status !== "aguardando_complementacao")
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
  if (req.status !== "pendente")
    return { error: "Só é possível pedir informação de requisições pendentes." };

  await supabase
    .from("ctrl_requests")
    .update({ status: "aguardando_complementacao", updated_at: new Date().toISOString() })
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

  await supabase
    .from("ctrl_requests")
    .update({ status: "pendente", updated_at: new Date().toISOString() })
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
    .select("id, status, approval_tier, created_by, request_number")
    .in("id", requestIds);

  if (!requests) return { error: "Erro ao buscar requisições." };

  const results: { id: string; number: number; ok: boolean; error?: string }[] =
    [];
  const approvedAt = new Date().toISOString();

  for (const req of requests) {
    if (req.status !== "pendente") {
      results.push({ id: req.id, number: req.request_number, ok: false, error: "Não está pendente." });
      continue;
    }
    const hasHigherApprovalBatch = ctx.ctrlRoles.some((r) => ["diretor", "csc", "admin"].includes(r));
    if (!hasHigherApprovalBatch && (req.approval_tier as string) === "nivel_3") {
      results.push({ id: req.id, number: req.request_number, ok: false, error: "Requer aprovação de Diretor." });
      continue;
    }

    const { error } = await supabase
      .from("ctrl_requests")
      .update({ status: "aprovado", approved_by: ctx.id, approved_at: approvedAt, updated_at: approvedAt })
      .eq("id", req.id);

    if (error) {
      results.push({ id: req.id, number: req.request_number, ok: false, error: error.message });
      continue;
    }

    await supabase.from("ctrl_history").insert({
      request_id: req.id,
      user_id: ctx.id,
      action: "aprovado",
      comment: comment?.trim() || `Aprovada em lote por ${ctx.name ?? ctx.email}`,
      metadata: { batch_approval: true, batch_size: requestIds.length },
    });

    await notifyRequester({
      userId: req.created_by,
      requestId: req.id,
      requestNumber: req.request_number,
      title: "Requisição Aprovada",
      message: `Sua requisição #${req.request_number} foi aprovada por ${ctx.name ?? ctx.email}.`,
      type: "aprovacao",
    });

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

// ─── Send to Payment ──────────────────────────────────────────────────────────

export async function sendToPayment(
  requestIds: string[],
  payingCompany?: string
) {
  const ctx = await requireCtrlRole("gerente", "diretor", "csc", "contas_a_pagar", "admin");
  const adminClient = createAdminClientIfAvailable();
  const supabase = adminClient ?? (await createClient());

  const now = new Date().toISOString();

  const { error } = await supabase
    .from("ctrl_requests")
    .update({
      status: "agendado",
      sent_to_payment_at: now,
      sent_to_payment_by: ctx.id,
      paying_company: payingCompany ?? null,
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
      comment: payingCompany ? `Empresa pagadora: ${payingCompany}` : null,
    }))
  );

  revalidatePath("/ctrl/contas-a-pagar");
  revalidatePath("/ctrl/requisicoes");
  return { ok: true };
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
  const supabase = await createClient();
  return performBudgetVerification(
    supabase,
    sectorId,
    expenseTypeId,
    amount,
    referenceMonth,
    referenceYear
  );
}
