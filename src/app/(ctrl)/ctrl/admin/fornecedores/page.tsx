import { Truck } from "lucide-react";
import { redirect } from "next/navigation";

import { getCtrlUser, hasCtrlRole } from "@/lib/ctrl/auth";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { FornecedoresTable } from "@/components/ctrl/fornecedores-table";

async function getData() {
  const adminClient = createAdminClientIfAvailable();
  const supabase = adminClient ?? (await createClient());

  const [suppliersResult, expenseTypesResult] = await Promise.all([
    supabase
      .from("ctrl_suppliers")
      .select(
        `id, name, cnpj_cpf, email, phone, omie_id, from_omie,
         chave_pix, banco, agencia, conta_corrente, titular_banco, doc_titular, transf_padrao,
         status, rejection_reason, created_at, approved_at,
         approver:users!ctrl_suppliers_approved_by_fkey(name, email),
         ctrl_supplier_expense_types(expense_type_id)`,
      )
      .order("name"),
    supabase.from("ctrl_expense_types").select("id, name").order("name"),
  ]);

  return {
    suppliersError: suppliersResult.error?.message ?? null,
    suppliers: (suppliersResult.data ?? []) as Array<{
      id: string;
      name: string;
      cnpj_cpf: string | null;
      email: string | null;
      phone: string | null;
      omie_id: number | null;
      from_omie: boolean | null;
      chave_pix: string | null;
      banco: string | null;
      agencia: string | null;
      conta_corrente: string | null;
      titular_banco: string | null;
      doc_titular: string | null;
      transf_padrao: boolean | null;
      status: string;
      rejection_reason: string | null;
      created_at: string;
      approved_at: string | null;
      approver:
        | { name: string | null; email: string | null }
        | Array<{ name: string | null; email: string | null }>
        | null;
      ctrl_supplier_expense_types: Array<{ expense_type_id: string }> | null;
    }>,
    expenseTypes: (expenseTypesResult.data ?? []) as Array<{
      id: string;
      name: string;
    }>,
  };
}

export default async function FornecedoresPage() {
  const ctx = await getCtrlUser();
  if (!ctx) redirect("/login");

  if (!hasCtrlRole(ctx, "csc", "admin", "aprovacao_fornecedor")) {
    redirect("/ctrl/requisicoes");
  }

  const canApprove = hasCtrlRole(ctx, "csc", "admin", "aprovacao_fornecedor");

  const { suppliers, expenseTypes, suppliersError } = await getData();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Fornecedores</h1>
        <p className="text-muted-foreground">
          Gestão de fornecedores aprovados para pagamento
        </p>
      </div>

      {suppliersError ? (
        <p className="text-sm text-destructive">{suppliersError}</p>
      ) : !suppliers.length ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
          <Truck className="mb-4 h-12 w-12 text-muted-foreground/40" />
          <h3 className="font-semibold">Nenhum fornecedor cadastrado</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Adicione fornecedores para habilitar requisições de pagamento.
          </p>
        </div>
      ) : (
        <FornecedoresTable
          suppliers={suppliers.map((s) => {
            const approver = Array.isArray(s.approver) ? s.approver[0] ?? null : s.approver;
            return {
              id: s.id,
              name: s.name,
              cnpj_cpf: s.cnpj_cpf,
              email: s.email,
              phone: s.phone,
              omie_id: s.omie_id,
              from_omie: s.from_omie ?? false,
              chave_pix: s.chave_pix,
              banco: s.banco,
              agencia: s.agencia,
              conta_corrente: s.conta_corrente,
              titular_banco: s.titular_banco,
              doc_titular: s.doc_titular,
              transf_padrao: s.transf_padrao ?? false,
              status: s.status,
              rejection_reason: s.rejection_reason,
              created_at: s.created_at,
              approved_at: s.approved_at,
              approver_name: approver?.name ?? approver?.email ?? null,
              expense_type_ids:
                s.ctrl_supplier_expense_types?.map((l) => l.expense_type_id) ?? [],
            };
          })}
          expenseTypes={expenseTypes}
          canApprove={canApprove}
        />
      )}
    </div>
  );
}
