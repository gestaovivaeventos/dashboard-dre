import { Truck } from "lucide-react";
import { redirect } from "next/navigation";

import { getCtrlUser, hasCtrlRole } from "@/lib/ctrl/auth";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { FornecedoresTable } from "@/components/ctrl/fornecedores-table";
import { CriarFornecedorButton } from "@/components/ctrl/criar-fornecedor-button";

async function getData() {
  const adminClient = createAdminClientIfAvailable();
  const supabase = adminClient ?? (await createClient());

  const [suppliersResult, expenseTypesResult, omieCompaniesResult, linksResult] = await Promise.all([
    supabase
      .from("ctrl_suppliers")
      .select(
        `id, name, cnpj_cpf, email, phone, omie_id, from_omie, omie_sync_required,
         chave_pix, pix_key_type, banco, agencia, conta_corrente, titular_banco, doc_titular, transf_padrao, pix_padrao,
         status, rejection_reason, created_at, approved_at,
         approver:users!ctrl_suppliers_approved_by_fkey(name, email),
         ctrl_supplier_expense_types(expense_type_id)`,
      )
      .order("name"),
    supabase.from("ctrl_expense_types").select("id, name").order("name"),
    supabase
      .from("companies")
      .select("id, name")
      .eq("active", true)
      .not("omie_app_key", "is", null)
      .not("omie_app_secret", "is", null)
      .order("name"),
    supabase
      .from("ctrl_supplier_omie_links")
      .select("supplier_id, company_id, sync_status, sync_error"),
  ]);

  const linksBySupplier = new Map<string, Array<{ company_id: string; sync_status: string; sync_error: string | null }>>();
  for (const link of (linksResult.data ?? []) as Array<{ supplier_id: string; company_id: string; sync_status: string; sync_error: string | null }>) {
    const list = linksBySupplier.get(link.supplier_id) ?? [];
    list.push({ company_id: link.company_id, sync_status: link.sync_status, sync_error: link.sync_error });
    linksBySupplier.set(link.supplier_id, list);
  }

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
      omie_sync_required: boolean | null;
      chave_pix: string | null;
      pix_key_type: string | null;
      banco: string | null;
      agencia: string | null;
      conta_corrente: string | null;
      titular_banco: string | null;
      doc_titular: string | null;
      transf_padrao: boolean | null;
      pix_padrao: boolean | null;
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
    omieCompanies: (omieCompaniesResult.data ?? []) as Array<{ id: string; name: string }>,
    linksBySupplier,
  };
}

export default async function FornecedoresPage() {
  const ctx = await getCtrlUser();
  if (!ctx) redirect("/login");

  // Tela colaborativa: qualquer perfil do CTRL pode listar/cadastrar/editar.
  // A aprovação fica restrita ao CSC/admin/aprovador.
  if (!hasCtrlRole(ctx, "solicitante", "gerente", "diretor", "csc", "contas_a_pagar", "admin", "aprovacao_fornecedor")) {
    redirect("/ctrl/requisicoes");
  }

  const canApprove = hasCtrlRole(ctx, "csc", "admin", "aprovacao_fornecedor");

  const { suppliers, expenseTypes, suppliersError, omieCompanies, linksBySupplier } = await getData();

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Fornecedores</h1>
          <p className="text-muted-foreground">
            Gestão de fornecedores aprovados para pagamento
          </p>
        </div>
        <CriarFornecedorButton />
      </div>

      {suppliersError ? (
        <p className="text-sm text-destructive">{suppliersError}</p>
      ) : !suppliers.length ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
          <Truck className="mb-4 h-12 w-12 text-muted-foreground/40" />
          <h3 className="font-semibold">Nenhum fornecedor cadastrado</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Use o botão acima para adicionar o primeiro fornecedor.
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
              pix_key_type: s.pix_key_type,
              banco: s.banco,
              agencia: s.agencia,
              conta_corrente: s.conta_corrente,
              titular_banco: s.titular_banco,
              doc_titular: s.doc_titular,
              transf_padrao: s.transf_padrao ?? false,
              pix_padrao: s.pix_padrao ?? false,
              status: s.status,
              rejection_reason: s.rejection_reason,
              created_at: s.created_at,
              approved_at: s.approved_at,
              approver_name: approver?.name ?? approver?.email ?? null,
              expense_type_ids:
                s.ctrl_supplier_expense_types?.map((l) => l.expense_type_id) ?? [],
              omie_sync_required: s.omie_sync_required ?? false,
              omie_links: linksBySupplier.get(s.id) ?? [],
            };
          })}
          expenseTypes={expenseTypes}
          canApprove={canApprove}
          omieCompanies={omieCompanies}
        />
      )}
    </div>
  );
}
