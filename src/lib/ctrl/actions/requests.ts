"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { requireCtrlRole } from "@/lib/ctrl/auth";
import { APPROVAL_ROUTING } from "@/lib/ctrl/routing";
import { countsTowardBudget } from "@/lib/ctrl/budget-cutoff";
import { notifyPendingApproval, notifyRequester, notifyAdmins } from "@/lib/ctrl/notifications";
import { decryptSecret } from "@/lib/security/encryption";
import { listarAnexosContaPagar, obterAnexoLinkContaPagar } from "@/lib/omie/anexo";
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

// As regras de roteamento (IDs fixos) vivem em "@/lib/ctrl/routing" para serem
// compartilhadas com a UI (badges). Ver APPROVAL_ROUTING importado acima.

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

  // A planilha-base já incorpora o realizado até 07/07/2026. Para 2026, o saldo
  // dinâmico conta só ocorrências com VENCIMENTO a partir de 08/07/2026 — assim
  // parcelas/recorrências já lançadas seguem descontando pelas datas futuras.
  const { data: approved } = await supabase
    .from("ctrl_requests")
    .select("amount, due_date, created_at")
    .eq("sector_id", sectorId)
    .eq("expense_type_id", expenseTypeId)
    .eq("reference_year", referenceYear)
    .eq("status", "aprovado")
    // Ignora requisições excluídas logicamente (soft delete) — devolvem o valor
    // ao orçamento automaticamente por saírem desta soma.
    .is("deleted_at", null);

  const totalApproved = (approved ?? [])
    .filter((r) => countsTowardBudget(r, referenceYear))
    .reduce((s, r) => s + Number(r.amount), 0);

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
  // Ciclo da fatura do cartão: fecha no dia 23 e vence no dia 05.
  //   • compra até o dia 23 (inclusive) → entra na fatura que vence dia 05 do
  //     mês seguinte (offset 1);
  //   • compra a partir do dia 24 → só entra na fatura do mês subsequente
  //     (offset 2).
  const purchase = new Date(purchaseDate + "T00:00:00");
  const monthOffset = purchase.getDate() > 23 ? 2 : 1;
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
  // approval_tier reflete SÓ o orçamento (nivel_2 = dentro / nivel_3 = fora). O
  // envio direto ao diretor (setor Diretoria / solicitante especial) é feito
  // pelo STATUS inicial (pendente_diretor), não pelo tier — senão uma
  // requisição dentro do orçamento seria rotulada como "Fora do orçamento".
  const approvalTier: ApprovalTier = verification?.approvalTier ?? "nivel_2";

  // Exceção de auto-aprovação gerencial: quando o PRÓPRIO gerente é o solicitante
  // e a despesa está prevista em orçamento (nivel_2, não exige diretor), a etapa
  // do gerente é dispensada — não faz sentido o gerente aprovar a própria
  // requisição. A etapa é marcada como aprovada automaticamente, com auditoria.
  //
  // Não se aplica quando:
  //  - a requisição é forçada ao diretor (setor Diretoria / solicitante especial);
  //  - está fora do orçamento (nivel_3) — diretor continua obrigatório;
  //  - a despesa não está prevista em orçamento (isBudgeted false);
  //  - a etapa de gerente está roteada a um gerente ESPECÍFICO diferente do
  //    solicitante (regra expenseTypeManager) — aí não é auto-aprovação do
  //    próprio, e o outro gerente deve decidir manualmente.
  const requesterIsManager = ctx.ctrlRoles.includes("gerente");
  const routedToOtherSpecificManager =
    data.expense_type_id === APPROVAL_ROUTING.expenseTypeManager.expenseTypeId &&
    ctx.id !== APPROVAL_ROUTING.expenseTypeManager.managerId;
  const managerAutoApproves = (
    tier: ApprovalTier,
    v: BudgetVerification | null,
  ): boolean =>
    !forceDirector &&
    tier === "nivel_2" &&
    (v?.isBudgeted ?? false) &&
    requesterIsManager &&
    !routedToOtherSpecificManager;

  const autoApproveManagerStep = managerAutoApproves(approvalTier, verification);
  const nowIso = new Date().toISOString();
  const AUTO_APPROVAL_COMMENT =
    "Aprovação gerencial automática: solicitante é gerente e a despesa está prevista em orçamento.";

  const initialStatus: CtrlRequestStatus = forceDirector
    ? "pendente_diretor"
    : autoApproveManagerStep
      ? "aprovado"
      : "pendente";

  // Installments
  const isCreditCard = data.payment_method === "cartao_credito";
  const isInstallment = isCreditCard && (data.installments ?? 1) > 1;
  // Para cartão (à vista ou parcelado), o vencimento segue o ciclo da fatura
  // (vence dia 05, conforme o dia da compra) — não a data crua digitada. Em 1x
  // gera só uma data; em Nx, uma por parcela.
  const installmentDates = isCreditCard && data.due_date
    ? calculateInstallmentDates(data.due_date, data.installments ?? 1)
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

  // First (or only) request.
  // Vencimento: cartão (à vista ou parcelado) usa a data da fatura computada
  // (dia 05). Competência (reference_month/year): mantém o mês da compra no à
  // vista; no parcelado, cada parcela já cai na competência da sua fatura.
  const firstDueDate =
    isCreditCard && installmentDates.length > 0
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
      approved_by: autoApproveManagerStep ? ctx.id : null,
      approved_at: autoApproveManagerStep ? nowIso : null,
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

  // Auditoria da auto-aprovação gerencial (etapa do gerente dispensada porque o
  // solicitante é o próprio gerente e a despesa está prevista em orçamento).
  if (autoApproveManagerStep) {
    await supabase.from("ctrl_history").insert({
      request_id: newReq.id,
      user_id: ctx.id,
      action: "aprovado",
      comment: AUTO_APPROVAL_COMMENT,
      metadata: {
        approver_roles: ctx.ctrlRoles,
        stage: "gerente",
        auto_approved: true,
        reason: "requester_is_manager_and_budgeted",
      },
    });
  }

  // Não notifica etapa pendente quando a etapa do gerente foi auto-aprovada:
  // não há aprovação manual a fazer (nem cabe o gerente aprovar a própria).
  if (!autoApproveManagerStep) {
    const { data: sec } = await supabase
      .from("ctrl_sectors")
      .select("name")
      .eq("id", data.sector_id)
      .single();

    // Etapa inicial e quem notificar.
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
      const instTier: ApprovalTier = instVerification?.approvalTier ?? "nivel_2";
      const instAutoApprove = managerAutoApproves(instTier, instVerification);
      const instStatus: CtrlRequestStatus = forceDirector
        ? "pendente_diretor"
        : instAutoApprove
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
          approval_level: instTier === "nivel_3" ? 2 : 1,
          approval_tier: instTier,
          approved_by: instAutoApprove ? ctx.id : null,
          approved_at: instAutoApprove ? nowIso : null,
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
        if (instAutoApprove) {
          await supabase.from("ctrl_history").insert({
            request_id: instReq.id,
            user_id: ctx.id,
            action: "aprovado",
            comment: AUTO_APPROVAL_COMMENT,
            metadata: {
              approver_roles: ctx.ctrlRoles,
              stage: "gerente",
              auto_approved: true,
              reason: "requester_is_manager_and_budgeted",
            },
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
      const monthTier: ApprovalTier = monthVerification?.approvalTier ?? "nivel_2";
      const monthAutoApprove = managerAutoApproves(monthTier, monthVerification);
      const monthStatus: CtrlRequestStatus = forceDirector
        ? "pendente_diretor"
        : monthAutoApprove
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
          // Cada recorrência vence no mesmo dia escolhido, mas no seu próprio mês.
          due_date: dueDateForRecurrence(data.due_date, month, data.reference_year),
          status: monthStatus,
          approval_level: monthTier === "nivel_3" ? 2 : 1,
          approval_tier: monthTier,
          approved_by: monthAutoApprove ? ctx.id : null,
          approved_at: monthAutoApprove ? nowIso : null,
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
        if (monthAutoApprove) {
          await supabase.from("ctrl_history").insert({
            request_id: recReq.id,
            user_id: ctx.id,
            action: "aprovado",
            comment: AUTO_APPROVAL_COMMENT,
            metadata: {
              approver_roles: ctx.ctrlRoles,
              stage: "gerente",
              auto_approved: true,
              reason: "requester_is_manager_and_budgeted",
            },
          });
        }
      }
    }
  }

  revalidatePath("/ctrl/requisicoes");
  revalidatePath("/ctrl/aprovacoes");
  return {
    requestId: newReq.id,
    requestNumber: newReq.request_number,
    totalCreated,
    autoApproved: autoApproveManagerStep,
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

export interface RequestComprovante {
  id: number;
  nome: string;
  tipo: string;
  url: string | null;
}

// Busca os comprovantes (anexos) da conta a pagar do Omie ligada à requisição.
// Resolve a URL temporária de download de cada anexo (ObterAnexo). Retorna lista
// vazia quando a requisição ainda não foi lançada no Omie.
export async function getRequestComprovantes(
  requestId: string,
): Promise<{ comprovantes: RequestComprovante[] } | { error: string }> {
  const ctx = await requireCtrlRole(
    "solicitante",
    "gerente",
    "diretor",
    "csc",
    "contas_a_pagar",
    "admin",
  );
  const supabase = createAdminClientIfAvailable() ?? (await createClient());

  const { data: req, error } = await supabase
    .from("ctrl_requests")
    .select("id, created_by, omie_contapagar_codigo, paying_company_id")
    .eq("id", requestId)
    .maybeSingle<{
      id: string;
      created_by: string;
      omie_contapagar_codigo: number | null;
      paying_company_id: string | null;
    }>();

  if (error) return { error: error.message };
  if (!req) return { error: "Requisição não encontrada." };

  // Solicitante sem visibilidade ampla só acessa os próprios comprovantes.
  const hasBroad = ctx.ctrlRoles.some((r) =>
    ["gerente", "diretor", "csc", "admin", "contas_a_pagar"].includes(r),
  );
  if (!hasBroad && req.created_by !== ctx.id) {
    return { error: "Sem acesso a esta requisição." };
  }

  if (!req.omie_contapagar_codigo) return { comprovantes: [] };
  if (!req.paying_company_id) return { error: "Requisição sem empresa pagadora." };

  const { data: company } = await supabase
    .from("companies")
    .select("omie_app_key, omie_app_secret")
    .eq("id", req.paying_company_id)
    .maybeSingle<{ omie_app_key: string | null; omie_app_secret: string | null }>();

  if (!company?.omie_app_key || !company?.omie_app_secret) {
    return { error: "Empresa pagadora sem conexão Omie." };
  }

  try {
    const appKey = decryptSecret(company.omie_app_key);
    const appSecret = decryptSecret(company.omie_app_secret);
    const codigo = Number(req.omie_contapagar_codigo);
    const anexos = await listarAnexosContaPagar(appKey, appSecret, codigo);
    const comprovantes: RequestComprovante[] = [];
    for (const a of anexos) {
      const url = await obterAnexoLinkContaPagar(appKey, appSecret, codigo, a.nIdAnexo);
      comprovantes.push({ id: a.nIdAnexo, nome: a.nome, tipo: a.tipo, url });
    }
    return { comprovantes };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao buscar comprovantes no Omie.";
    return { error: msg };
  }
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
      `*, ctrl_sectors(name), ctrl_expense_types(name), ctrl_events(name),
       ctrl_suppliers(name, cnpj_cpf, chave_pix, banco, agencia, conta_corrente, titular_banco),
       creator:users!ctrl_requests_created_by_fkey(name, email),
       approver:users!ctrl_requests_approved_by_fkey(name, email)`
    )
    // Oculta requisições excluídas logicamente (cobre Requisições e Aprovações,
    // que passam por aqui).
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (filters?.status) query = query.eq("status", filters.status);
  if (filters?.statuses?.length) query = query.in("status", filters.statuses);
  if (filters?.sector_id) query = query.eq("sector_id", filters.sector_id);

  // Visibilidade em tres niveis:
  //  - Global (diretor, admin, csc, contas_a_pagar): ve todas as requisicoes. O
  //    diretor tem visao geral da empresa; os setores vinculados a ele NAO
  //    filtram a visibilidade — servem apenas para destacar "seu setor" na tela
  //    de Aprovacoes (separacao visual no client).
  //  - Por setor (gerente): ve apenas as requisicoes dos setores aos quais esta
  //    vinculado em user_sectors. Sem vinculo => fallback ve tudo, pra nao
  //    quebrar o fluxo enquanto os cadastros estao incompletos.
  //  - Solicitante (nenhum dos anteriores): apenas as proprias requisicoes.
  const hasGlobalVisibility = ctx.ctrlRoles.some((r) =>
    ["diretor", "csc", "admin", "contas_a_pagar"].includes(r),
  );
  const hasSectorVisibility = ctx.ctrlRoles.some((r) =>
    ["gerente"].includes(r),
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

  // A RLS de `users` só deixa cada um ler o próprio registro (ou admin lê todos),
  // então o join `creator`/`approver` volta null para aprovadores não-admin —
  // e o nome do solicitante somia na tela de aprovações. Resolve os nomes via
  // admin client (service role), sem afrouxar a RLS da tabela users.
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const adminClient = createAdminClientIfAvailable();
  if (adminClient && rows.length) {
    const userIds = new Set<string>();
    for (const r of rows) {
      if (typeof r.created_by === "string") userIds.add(r.created_by);
      if (typeof r.approved_by === "string") userIds.add(r.approved_by);
    }
    if (userIds.size) {
      const { data: users } = await adminClient
        .from("users")
        .select("id, name, email")
        .in("id", Array.from(userIds));
      const byId = new Map(
        (users ?? []).map((u) => [u.id, { name: u.name, email: u.email }]),
      );
      for (const r of rows) {
        if (typeof r.created_by === "string" && byId.has(r.created_by)) {
          r.creator = byId.get(r.created_by);
        }
        if (typeof r.approved_by === "string" && byId.has(r.approved_by)) {
          r.approver = byId.get(r.approved_by);
        }
      }
    }
  }

  return { requests: rows };
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
    .select("id, status, complement_return_status, approval_tier, sector_id, amount, created_by, request_number")
    .eq("id", requestId)
    .single();

  if (fetchErr || !req) return { error: "Requisição não encontrada." };

  // Permite aprovar diretamente de dentro da Complementação: a decisão usa a
  // etapa de origem guardada em complement_return_status (gerente/diretor).
  const isComplement = req.status === "aguardando_complementacao";
  if (req.status !== "pendente" && req.status !== "pendente_diretor" && !isComplement)
    return { error: `Status atual: ${req.status}. Só é possível aprovar requisições pendentes.` };

  const effectiveStatus = isComplement
    ? ((req.complement_return_status as string | null) ?? "pendente")
    : req.status;
  const effectiveReq = { ...req, status: effectiveStatus } as ApprovableReq;

  const result = await applyApprovalStep(supabase, ctx, effectiveReq, comment);
  if ("error" in result) return result;

  // Saiu da complementação ao decidir — limpa a etapa de origem guardada.
  if (isComplement) {
    await supabase
      .from("ctrl_requests")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ complement_return_status: null } as any)
      .eq("id", requestId);
  }

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
  if (
    req.status !== "pendente" &&
    req.status !== "pendente_diretor" &&
    req.status !== "aguardando_complementacao"
  )
    return { error: "Só é possível pedir informação de requisições pendentes ou em complementação." };

  // Guarda a etapa de origem para a aprovação saber em que etapa decidir. Só
  // grava na PRIMEIRA pergunta (quando ainda está pendente); perguntas de
  // acompanhamento (já em complementação) preservam o complement_return_status.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const update: Record<string, any> = {
    status: "aguardando_complementacao",
    updated_at: new Date().toISOString(),
  };
  if (req.status === "pendente" || req.status === "pendente_diretor") {
    update.complement_return_status = req.status;
  }
  await supabase
    .from("ctrl_requests")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update(update as any)
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

  const { data: req } = await supabase
    .from("ctrl_requests")
    .select("id, status, request_number")
    .eq("id", requestId)
    .maybeSingle<{ id: string; status: string; request_number: number }>();

  if (!req) return { error: "Requisição não encontrada." };
  if (req.status !== "aguardando_complementacao")
    return { error: "Esta requisição não está aguardando complementação." };

  // Responder NÃO tira da complementação: a requisição PERMANECE em
  // `aguardando_complementacao` (preservando `complement_return_status`) e o
  // aprovador decide — aprovar/rejeitar/perguntar de novo — de dentro da própria
  // aba de Complementação. Só registra a resposta e marca atividade.
  await supabase
    .from("ctrl_requests")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", requestId);

  await supabase.from("ctrl_history").insert({
    request_id: requestId,
    user_id: ctx.id,
    action: "complementado",
    comment: answer.trim(),
  });

  // Avisa quem fez a última pergunta (aprovador) que há nova resposta a analisar.
  const { data: lastAsk } = await supabase
    .from("ctrl_history")
    .select("user_id")
    .eq("request_id", requestId)
    .eq("action", "complementacao_solicitada")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ user_id: string }>();

  if (lastAsk?.user_id && lastAsk.user_id !== ctx.id) {
    await notifyRequester({
      userId: lastAsk.user_id,
      requestId,
      requestNumber: req.request_number,
      title: "Nova resposta na complementação",
      message: `Há uma nova resposta na requisição #${req.request_number} aguardando sua análise.`,
      type: "info_solicitada",
    });
  }

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

export interface ComplementMessage {
  id: string;
  authorId: string;
  authorName: string | null;
  authorEmail: string | null;
  authorKind: "solicitante" | "aprovador";
  message: string;
  createdAt: string;
}

// Conversa COMPLETA da solicitação de complementação (pergunta do aprovador +
// respostas do solicitante, e novas perguntas), em ordem cronológica — cada
// turno é uma linha em ctrl_history (complementacao_solicitada = aprovador;
// complementado = solicitante). Admin client porque a RLS de ctrl_history não
// cruza as linhas entre aprovador e solicitante; a autorização é por papel +
// dono (mesma regra de getComplementQuestion).
export async function getComplementThread(
  requestId: string,
): Promise<{ messages?: ComplementMessage[]; error?: string }> {
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

  const { data, error } = await supabase
    .from("ctrl_history")
    .select(
      `id, user_id, action, comment, created_at,
       user:users!ctrl_history_user_id_fkey(name, email)`,
    )
    .eq("request_id", requestId)
    .in("action", ["complementacao_solicitada", "complementado"])
    .order("created_at", { ascending: true });

  if (error) return { error: error.message };

  type Row = {
    id: string;
    user_id: string;
    action: "complementacao_solicitada" | "complementado";
    comment: string | null;
    created_at: string;
    user:
      | { name: string | null; email: string | null }
      | Array<{ name: string | null; email: string | null }>
      | null;
  };
  const messages: ComplementMessage[] = ((data ?? []) as Row[]).map((row) => {
    const u = Array.isArray(row.user) ? row.user[0] ?? null : row.user;
    return {
      id: row.id,
      authorId: row.user_id,
      authorName: u?.name ?? null,
      authorEmail: u?.email ?? null,
      authorKind: row.action === "complementacao_solicitada" ? "aprovador" : "solicitante",
      message: row.comment ?? "",
      createdAt: row.created_at,
    };
  });

  return { messages };
}

// ─── Histórico de aprovações (para o modal de Detalhes) ──────────────────────
//
// Reconstrói o histórico persistente das DECISÕES de aprovação de uma requisição
// a partir de `ctrl_history` — a mesma tabela onde approveRequest /
// applyApprovalStep / batchApproveRequests / rejectRequest / reverseRequest e a
// auto-aprovação gerencial já gravam cada ação. Não altera nada do fluxo: só LÊ.
//
// Considera apenas as ações de decisão de aprovação (aprovado / rejeitado /
// estornado); a conversa de complementação tem sua própria thread. A etapa
// (gerente/diretor) e sinais de auto-aprovação vêm do `metadata` gravado na
// origem. Nomes dos autores são resolvidos via admin client porque a RLS de
// `users` não expõe o registro de outro usuário ao aprovador (mesma técnica de
// getComplementThread); a autorização é por papel + dono.

export type ApprovalHistoryAction = "aprovado" | "rejeitado" | "estornado" | "editado";

/** De/para de um campo alterado (evento 'editado'). */
export interface ApprovalHistoryChange {
  field: string;
  from: string | null;
  to: string | null;
}

export interface ApprovalHistoryEntry {
  id: string;
  action: ApprovalHistoryAction;
  /** Etapa do fluxo (quando aplicável): quem decidiu. */
  stage: "gerente" | "diretor" | null;
  /** true quando a etapa do gerente foi dispensada por auto-aprovação. */
  autoApproved: boolean;
  actorName: string | null;
  actorEmail: string | null;
  /** Comentário/motivo gravado no evento (motivo da rejeição/estorno, etc.). */
  comment: string | null;
  /** Campos alterados (só em 'editado'): lista de de/para legível. */
  changes?: ApprovalHistoryChange[];
  /** Origem da edição, quando 'editado' (ex.: "contas_a_pagar"). */
  editSource?: string | null;
  createdAt: string;
}

export async function getApprovalHistory(
  requestId: string,
): Promise<{ entries?: ApprovalHistoryEntry[]; error?: string }> {
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

  const { data, error } = await supabase
    .from("ctrl_history")
    .select(
      `id, user_id, action, comment, metadata, created_at,
       user:users!ctrl_history_user_id_fkey(name, email)`,
    )
    .eq("request_id", requestId)
    .in("action", ["aprovado", "rejeitado", "estornado", "editado"])
    .order("created_at", { ascending: true });

  if (error) return { error: error.message };

  type Row = {
    id: string;
    user_id: string;
    action: ApprovalHistoryAction;
    comment: string | null;
    metadata: Record<string, unknown> | null;
    created_at: string;
    user:
      | { name: string | null; email: string | null }
      | Array<{ name: string | null; email: string | null }>
      | null;
  };

  const entries: ApprovalHistoryEntry[] = ((data ?? []) as Row[]).map((row) => {
    const u = Array.isArray(row.user) ? row.user[0] ?? null : row.user;
    const stageRaw = row.metadata?.stage;
    const stage =
      stageRaw === "gerente" || stageRaw === "diretor" ? stageRaw : null;

    // 'editado': normaliza o mapa metadata.changes ({ campo: [de, para] }) numa
    // lista legível. Valores não-string (ids, números) viram texto ou null.
    let changes: ApprovalHistoryChange[] | undefined;
    let editSource: string | null | undefined;
    if (row.action === "editado") {
      const raw = row.metadata?.changes as
        | Record<string, [unknown, unknown]>
        | undefined;
      const toText = (v: unknown): string | null =>
        v === null || v === undefined ? null : String(v);
      changes = raw
        ? Object.entries(raw).map(([field, pair]) => ({
            field,
            from: toText(Array.isArray(pair) ? pair[0] : null),
            to: toText(Array.isArray(pair) ? pair[1] : null),
          }))
        : [];
      const src = row.metadata?.source;
      editSource = typeof src === "string" ? src : null;
    }

    return {
      id: row.id,
      action: row.action,
      stage,
      autoApproved: row.metadata?.auto_approved === true,
      actorName: u?.name ?? null,
      actorEmail: u?.email ?? null,
      comment: row.comment,
      changes,
      editSource,
      createdAt: row.created_at,
    };
  });

  return { entries };
}

// Dentre as requisições em `aguardando_complementacao`, quais têm o ÚLTIMO turno
// da conversa como resposta do solicitante (`complementado`) — ou seja, estão
// aguardando a análise do aprovador. Usado para o alerta da aba Complementação.
// Admin client (RLS de ctrl_history); autorização por papel de aprovação.
export async function getComplementsAwaitingApprover(
  requestIds: string[],
): Promise<{ ids?: string[]; error?: string }> {
  await requireCtrlRole("gerente", "diretor", "csc", "admin", "contas_a_pagar");
  if (requestIds.length === 0) return { ids: [] };

  const adminClient = createAdminClientIfAvailable();
  const supabase = adminClient ?? (await createClient());

  const { data, error } = await supabase
    .from("ctrl_history")
    .select("request_id, action, created_at")
    .in("request_id", requestIds)
    .in("action", ["complementacao_solicitada", "complementado"])
    .order("created_at", { ascending: true });

  if (error) return { error: error.message };

  // Última ação de complementação por requisição.
  const lastAction = new Map<string, string>();
  for (const row of (data ?? []) as Array<{ request_id: string; action: string }>) {
    lastAction.set(row.request_id, row.action);
  }
  const ids: string[] = [];
  lastAction.forEach((action, id) => {
    if (action === "complementado") ids.push(id);
  });

  return { ids };
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

// ─── Editar setor/tipo em Contas a Pagar (retorna à aprovação) ───────────────
//
// O usuário de Contas a Pagar (ou admin) corrige o SETOR e/ou o TIPO DE DESPESA
// de uma requisição já aprovada, ANTES de enviá-la ao Omie — campos que o
// solicitante pode ter informado errado e que definem o controle orçamentário e
// o mapeamento Omie (departamento/categoria). Após a correção a requisição VOLTA
// automaticamente ao fluxo de aprovação (gerente/diretor) para nova validação:
// recalcula o orçamento com o novo setor+tipo e roteia como na criação, mas SEM
// auto-aprovação — sempre exige decisão humana. A alteração fica registrada em
// ctrl_history (action 'editado', com o de/para e o motivo).
export async function editExpenseRoutingFromContasAPagar(
  requestId: string,
  input: { sector_id: string; expense_type_id: string | null; reason: string },
) {
  const ctx = await requireCtrlRole("contas_a_pagar", "admin");

  if (!input.reason?.trim()) return { error: "Informe o motivo da alteração." };
  if (!input.sector_id) return { error: "Selecione o setor." };

  const adminClient = createAdminClientIfAvailable();
  const supabase = adminClient ?? (await createClient());

  const { data: req, error: fetchErr } = await supabase
    .from("ctrl_requests")
    .select(
      `id, status, deleted_at, omie_contapagar_codigo, request_number,
       sector_id, expense_type_id, amount, due_date, reference_month, reference_year, created_by,
       ctrl_sectors(name), ctrl_expense_types(name)`,
    )
    .eq("id", requestId)
    .maybeSingle();

  if (fetchErr || !req) return { error: "Requisição não encontrada." };
  if (req.deleted_at) return { error: "Requisição excluída não pode ser editada." };
  // Só requisições aprovadas e ainda não lançadas no Omie (aba "Aguardando Envio").
  if (req.status !== "aprovado" || req.omie_contapagar_codigo != null) {
    return {
      error:
        "Só é possível editar requisições aprovadas que ainda não foram enviadas ao Omie.",
    };
  }

  const newSectorId = input.sector_id;
  const newExpenseTypeId = input.expense_type_id || null;
  const oldSectorId = (req.sector_id as string | null) ?? null;
  const oldExpenseTypeId = (req.expense_type_id as string | null) ?? null;

  const sectorChanged = newSectorId !== oldSectorId;
  const expenseChanged = newExpenseTypeId !== oldExpenseTypeId;
  if (!sectorChanged && !expenseChanged) {
    return { error: "Altere o setor e/ou o tipo de despesa." };
  }

  // Nomes (para o histórico legível): atuais via join, novos via consulta.
  const resolveName = (v: unknown): string | null => {
    if (!v) return null;
    if (Array.isArray(v)) return (v[0] as { name?: string } | undefined)?.name ?? null;
    return (v as { name?: string }).name ?? null;
  };
  const oldSectorName = resolveName(req.ctrl_sectors);
  const oldExpenseName = resolveName(req.ctrl_expense_types);

  const [newSectorRes, newExpenseRes, requesterRes] = await Promise.all([
    supabase.from("ctrl_sectors").select("name").eq("id", newSectorId).maybeSingle(),
    newExpenseTypeId
      ? supabase.from("ctrl_expense_types").select("name").eq("id", newExpenseTypeId).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("users").select("name, email").eq("id", req.created_by as string).maybeSingle(),
  ]);
  const newSectorName = (newSectorRes.data as { name?: string } | null)?.name ?? null;
  const newExpenseName = (newExpenseRes.data as { name?: string } | null)?.name ?? null;
  const requester = requesterRes.data as { name: string | null; email: string | null } | null;

  // Recalcula o orçamento com o NOVO setor+tipo (mês/ano pelo vencimento, com
  // fallback para a competência) e roteia como na criação.
  const verificationMonth = req.due_date
    ? new Date((req.due_date as string) + "T00:00:00").getMonth() + 1
    : (req.reference_month as number);
  const verificationYear = req.due_date
    ? new Date((req.due_date as string) + "T00:00:00").getFullYear()
    : (req.reference_year as number);

  let verification: BudgetVerification | null = null;
  if (newExpenseTypeId) {
    verification = await performBudgetVerification(
      supabase,
      newSectorId,
      newExpenseTypeId,
      Number(req.amount),
      verificationMonth,
      verificationYear,
    );
  }
  const approvalTier: ApprovalTier = verification?.approvalTier ?? "nivel_2";

  // Roteamento forçado ao diretor (setor Diretoria / solicitante especial), igual
  // à criação. Nunca auto-aprova: sempre volta a 'pendente' (ou 'pendente_diretor').
  const directorOnly = req.created_by === APPROVAL_ROUTING.directorOnly.requesterId;
  const directorSectorOnly = newSectorId === APPROVAL_ROUTING.directorSector.sectorId;
  const forceDirector = directorOnly || directorSectorOnly;
  const newStatus: CtrlRequestStatus = forceDirector ? "pendente_diretor" : "pendente";

  const now = new Date().toISOString();
  const { error: updErr } = await supabase
    .from("ctrl_requests")
    .update({
      sector_id: newSectorId,
      expense_type_id: newExpenseTypeId,
      is_budgeted: verification?.isBudgeted ?? false,
      approval_tier: approvalTier,
      approval_level: approvalTier === "nivel_3" ? 2 : 1,
      status: newStatus,
      approved_by: null,
      approved_at: null,
      complement_return_status: null,
      updated_at: now,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    .eq("id", requestId)
    // Guarda contra corrida: só reverte se ainda estiver aprovada (não enviada).
    .eq("status", "aprovado");
  if (updErr) return { error: updErr.message };

  const changes: Record<string, [string | null, string | null]> = {};
  if (sectorChanged) changes.setor = [oldSectorName, newSectorName];
  if (expenseChanged) changes.tipo_despesa = [oldExpenseName, newExpenseName];

  await supabase.from("ctrl_history").insert({
    request_id: requestId,
    user_id: ctx.id,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    action: "editado" as any,
    comment: input.reason.trim(),
    metadata: {
      source: "contas_a_pagar",
      changes,
      reason: input.reason.trim(),
      returned_to: newStatus,
      approval_tier: approvalTier,
      edited_by_roles: ctx.ctrlRoles,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  // Notifica a etapa de aprovação de destino (mesma lógica de roteamento da criação).
  const stage: "gerente" | "diretor" = forceDirector ? "diretor" : "gerente";
  let explicitApproverIds: string[] | undefined;
  if (directorOnly) {
    explicitApproverIds = [APPROVAL_ROUTING.directorOnly.directorId];
  } else if (
    !forceDirector &&
    newExpenseTypeId === APPROVAL_ROUTING.expenseTypeManager.expenseTypeId
  ) {
    explicitApproverIds = [APPROVAL_ROUTING.expenseTypeManager.managerId];
  }

  await notifyPendingApproval({
    requestId,
    requestNumber: req.request_number as number,
    requesterName: requester?.name ?? requester?.email ?? "Solicitante",
    sectorId: newSectorId,
    sectorName: newSectorName ?? "Setor",
    amount: Number(req.amount),
    stage,
    explicitApproverIds,
  });

  // Avisa o solicitante que a requisição voltou à aprovação após a correção.
  await notifyRequester({
    userId: req.created_by as string,
    requestId,
    requestNumber: req.request_number as number,
    title: "Requisição retornou à aprovação",
    message: `Sua requisição #${req.request_number} teve o setor/tipo de despesa ajustado por Contas a Pagar e voltou para nova validação.`,
    type: "info_solicitada",
  });

  revalidatePath("/ctrl/contas-a-pagar");
  revalidatePath("/ctrl/aprovacoes");
  revalidatePath("/ctrl/requisicoes");
  revalidatePath("/ctrl/orcamento");
  revalidatePath("/home");
  return { ok: true as const, returnedTo: newStatus, tier: approvalTier };
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
