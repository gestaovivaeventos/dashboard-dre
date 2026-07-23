import { Plus } from "lucide-react";
import { redirect } from "next/navigation";

import { getCtrlUser, hasCtrlRole } from "@/lib/ctrl/auth";
import { getRequests } from "@/lib/ctrl/actions/requests";
import { getSectors } from "@/lib/ctrl/actions/sectors";
import { getExpenseTypes } from "@/lib/ctrl/actions/expense-types";
import { RequisicoesTable } from "@/components/ctrl/requisicoes-table";
import type { RequestDetail } from "@/components/ctrl/request-detail-modal";

export default async function RequisicoesPage() {
  const ctx = await getCtrlUser();
  if (!ctx) redirect("/login");

  if (
    !hasCtrlRole(
      ctx,
      "solicitante",
      "gerente",
      "diretor",
      "csc",
      "contas_a_pagar",
      "admin",
    )
  ) {
    redirect("/ctrl");
  }

  const canCreateRequest = hasCtrlRole(
    ctx,
    "solicitante",
    "gerente",
    "diretor",
    "csc",
    "admin",
  );

  // Edição/exclusão administrativa (a princípio) só para admin. Carrega os
  // cadastros de setor/tipo só nesse caso, para alimentar o form de edição.
  const isAdmin = hasCtrlRole(ctx, "admin");
  const [sectorsRes, typesRes] = isAdmin
    ? await Promise.all([getSectors(), getExpenseTypes()])
    : [null, null];
  const sectors = (
    sectorsRes && "sectors" in sectorsRes ? sectorsRes.sectors ?? [] : []
  ).map((s) => ({ id: s.id, name: s.name }));
  const expenseTypes = (
    typesRes && "expenseTypes" in typesRes ? typesRes.expenseTypes ?? [] : []
  ).map((t) => ({ id: t.id, name: t.name }));

  const { requests, error } = await getRequests();

  // Projeta os campos que a tabela e o modal de detalhes precisam. O modal é o
  // mesmo componente compartilhado usado em Contas a Pagar (RequestDetail).
  const rows: RequestDetail[] =
    requests?.map((r) => ({
      id: r.id as string,
      request_number: r.request_number as number,
      title: r.title as string,
      description: (r.description as string | null) ?? null,
      amount: Number(r.amount),
      due_date: (r.due_date as string | null) ?? null,
      reference_month: (r.reference_month as number | null) ?? null,
      reference_year: (r.reference_year as number | null) ?? null,
      status: r.status as string,
      payment_method: (r.payment_method as string | null) ?? null,
      installment_number: (r.installment_number as number | null) ?? null,
      installment_total: (r.installment_total as number | null) ?? null,
      needs_credit_card: (r.needs_credit_card as boolean | null) ?? null,
      justification: (r.justification as string | null) ?? null,
      observations: (r.observations as string | null) ?? null,
      barcode: (r.barcode as string | null) ?? null,
      pix_key: (r.pix_key as string | null) ?? null,
      pix_key_type: (r.pix_key_type as string | null) ?? null,
      bank_name: (r.bank_name as string | null) ?? null,
      bank_agency: (r.bank_agency as string | null) ?? null,
      bank_account: (r.bank_account as string | null) ?? null,
      bank_account_digit: (r.bank_account_digit as string | null) ?? null,
      bank_cpf_cnpj: (r.bank_cpf_cnpj as string | null) ?? null,
      favorecido: (r.favorecido as string | null) ?? null,
      supplier_issues_invoice: (r.supplier_issues_invoice as string | null) ?? null,
      attachment_path: (r.attachment_path as string | null) ?? null,
      sector_id: (r.sector_id as string | null) ?? null,
      expense_type_id: (r.expense_type_id as string | null) ?? null,
      event_id: (r.event_id as string | null) ?? null,
      paying_company: (r.paying_company as string | null) ?? null,
      omie_contapagar_codigo: (r.omie_contapagar_codigo as number | null) ?? null,
      sent_to_payment_at: (r.sent_to_payment_at as string | null) ?? null,
      inactivated_at: (r.inactivated_at as string | null) ?? null,
      inactivation_reason: (r.inactivation_reason as string | null) ?? null,
      created_at: (r.created_at as string | null) ?? null,
      approved_at: (r.approved_at as string | null) ?? null,
      ctrl_suppliers: (r.ctrl_suppliers as RequestDetail["ctrl_suppliers"]) ?? null,
      ctrl_expense_types: (r.ctrl_expense_types as RequestDetail["ctrl_expense_types"]) ?? null,
      ctrl_sectors: (r.ctrl_sectors as RequestDetail["ctrl_sectors"]) ?? null,
      ctrl_events: (r.ctrl_events as RequestDetail["ctrl_events"]) ?? null,
      creator: (r.creator as RequestDetail["creator"]) ?? null,
      approver: (r.approver as RequestDetail["approver"]) ?? null,
    })) ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Requisições</h1>
          <p className="text-muted-foreground">
            {ctx.ctrlRoles.includes("solicitante") && ctx.ctrlRoles.length === 1
              ? "Suas requisições de pagamento"
              : "Todas as requisições"}
          </p>
        </div>
        {canCreateRequest ? (
          <a
            href="/ctrl/requisicoes/nova"
            className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Plus className="mr-2 h-4 w-4" />
            Nova Requisição
          </a>
        ) : null}
      </div>

      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : (
        <RequisicoesTable
          requests={rows}
          isAdmin={isAdmin}
          sectors={sectors}
          expenseTypes={expenseTypes}
        />
      )}
    </div>
  );
}
