import { Truck } from "lucide-react";
import { redirect } from "next/navigation";

import { getCtrlUser, hasCtrlRole } from "@/lib/ctrl/auth";
import { getOrgCompanyIds } from "@/lib/ctrl/orgs";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { FornecedoresTable } from "@/components/ctrl/fornecedores-table";
import { CriarFornecedorButton } from "@/components/ctrl/criar-fornecedor-button";
import { ImportarOmieButton } from "@/components/ctrl/importar-omie-button";

// `cep` e `bairro` chegaram na migration 20260730120000. Enquanto ela não é
// aplicada, uma coluna inexistente derruba o SELECT inteiro (42703) e a tela
// fica vazia — como se os fornecedores tivessem sumido. Por isso o select é
// montado com e sem essas duas colunas, com fallback automático.
const suppliersSelect = (comEndereco: boolean) =>
  `id, name, nome_fantasia, cnpj_cpf, email, phone, omie_id, from_omie, omie_sync_required,
   chave_pix, pix_key_type, banco, agencia, conta_corrente, titular_banco, doc_titular, transf_padrao, transf_tipo_conta, pix_padrao,
   estrangeiro, pais, codigo_pais, estado, cidade, endereco, endereco_numero, complemento,
   ${comEndereco ? "bairro, cep," : ""}
   status, rejection_reason, created_at, approved_at,
   approver:users!ctrl_suppliers_approved_by_fkey(name, email),
   ctrl_supplier_expense_types(expense_type_id)`;

// A API do Supabase devolve no máximo 1000 linhas por requisição. Como já há
// mais de 1000 fornecedores, paginamos em blocos para não cortar a cauda da
// lista (ex.: nomes com "T" em diante sumiam da tela e da busca).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAllSuppliers(supabase: any, orgId: string, comEndereco = true) {
  const pageSize = 1000;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const all: any[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("ctrl_suppliers")
      .select(suppliersSelect(comEndereco))
      // Multiempresa: só os fornecedores da empresa ATIVA. A tela lê com o admin
      // client (ignora RLS), então o recorte por empresa é explícito aqui — sem
      // isso, a Feat mostrava os ~1.195 fornecedores da Viva.
      .eq("org_id", orgId)
      .order("name")
      .range(from, from + pageSize - 1);
    if (error) {
      // 42703 = coluna inexistente: migration 20260730120000 ainda não aplicada.
      // Recarrega sem cep/bairro para a tela continuar de pé.
      if (comEndereco && error.code === "42703") return fetchAllSuppliers(supabase, orgId, false);
      return { data: all, error };
    }
    all.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return { data: all, error: null };
}

async function getData(orgId: string | null) {
  const adminClient = createAdminClientIfAvailable();
  const supabase = adminClient ?? (await createClient());

  // Sem empresa ativa (não deveria ocorrer para quem tem o módulo): nada a listar.
  if (!orgId) {
    return {
      suppliersError: null,
      suppliers: [] as never[],
      expenseTypes: [] as Array<{ id: string; name: string }>,
      omieCompanies: [] as Array<{ id: string; name: string }>,
      linksBySupplier: new Map<string, Array<{ company_id: string; sync_status: string; sync_error: string | null }>>(),
    };
  }

  // CNPJs da empresa ativa — os únicos para onde um fornecedor dela sincroniza.
  const orgCompanyIds = await getOrgCompanyIds(supabase, orgId);

  const [suppliersResult, expenseTypesResult, omieCompaniesResult, linksResult] = await Promise.all([
    // Fornecedores e tipos de despesa são POR EMPRESA (migration multiempresa).
    fetchAllSuppliers(supabase, orgId),
    supabase.from("ctrl_expense_types").select("id, name").eq("org_id", orgId).order("name"),
    supabase
      .from("companies")
      .select("id, name")
      .eq("active", true)
      .not("omie_app_key", "is", null)
      .not("omie_app_secret", "is", null)
      // Só os CNPJs da empresa ativa. Lista vazia → `.in("id", [])` não casa nada.
      .in("id", orgCompanyIds)
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
      nome_fantasia: string | null;
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
      transf_tipo_conta: "corrente" | "poupanca" | null;
      pix_padrao: boolean | null;
      estrangeiro: boolean | null;
      pais: string | null;
      codigo_pais: string | null;
      estado: string | null;
      cidade: string | null;
      endereco: string | null;
      endereco_numero: string | null;
      bairro: string | null;
      complemento: string | null;
      cep: string | null;
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

/**
 * A tela abre em "Aprovados" por padrão, mas os alertas da tela inicial
 * ("N fornecedores aguardando homologação" / "Homologar →") apontam para uma
 * pendência específica: os cadastros novos, feitos pelo próprio time, que ainda
 * não foram homologados. Sem os parâmetros abaixo o clique caía na listagem
 * inteira e o usuário tinha que descobrir sozinho quais eram os 5 do alerta.
 *
 *   ?status=pendente   → abre já na aba Pendentes
 *   &novos=1           → esconde os ~1000 pendentes legados vindos do Omie
 *   &fornecedor=<id>   → destaca a linha daquele fornecedor
 */
interface FornecedoresPageProps {
  searchParams?: Record<string, string | string[] | undefined>;
}

const firstParam = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function FornecedoresPage({ searchParams }: FornecedoresPageProps) {
  const ctx = await getCtrlUser();
  if (!ctx) redirect("/login");

  // Tela colaborativa: qualquer perfil do CTRL pode listar/cadastrar/editar.
  // A aprovação fica restrita a gerente/CSC/admin/aprovador.
  if (!hasCtrlRole(ctx, "solicitante", "gerente", "diretor", "csc", "contas_a_pagar", "admin", "aprovacao_fornecedor")) {
    redirect("/ctrl/requisicoes");
  }

  const canApprove = hasCtrlRole(ctx, "gerente", "csc", "admin", "aprovacao_fornecedor");
  // Importar da Omie é operação de cadastro em lote — admin/Contas a Pagar, os
  // mesmos que operam o Mapeamento Omie. Escopada pela empresa ativa.
  const canImportOmie = hasCtrlRole(ctx, "admin", "contas_a_pagar");
  const activeOrgName = ctx.orgs.find((o) => o.id === ctx.orgId)?.nome ?? "esta empresa";

  const { suppliers, expenseTypes, suppliersError, omieCompanies, linksBySupplier } = await getData(ctx.orgId);

  const statusParam = firstParam(searchParams?.status);
  const initialTab =
    statusParam === "pendente" || statusParam === "aprovado" || statusParam === "rejeitado"
      ? statusParam
      : undefined;
  const novosParam = firstParam(searchParams?.novos);
  const initialOnlyNovos = novosParam === "1" || novosParam === "true";
  const highlightId = firstParam(searchParams?.fornecedor) ?? null;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Fornecedores</h1>
          <p className="text-muted-foreground">
            Gestão de fornecedores aprovados para pagamento
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canImportOmie && <ImportarOmieButton orgName={activeOrgName} />}
          <CriarFornecedorButton expenseTypes={expenseTypes} />
        </div>
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
              nome_fantasia: s.nome_fantasia,
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
              transf_tipo_conta: s.transf_tipo_conta ?? null,
              pix_padrao: s.pix_padrao ?? false,
              estrangeiro: s.estrangeiro ?? false,
              pais: s.pais,
              codigo_pais: s.codigo_pais,
              estado: s.estado,
              cidade: s.cidade,
              endereco: s.endereco,
              endereco_numero: s.endereco_numero,
              bairro: s.bairro ?? null,
              complemento: s.complemento,
              cep: s.cep ?? null,
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
          initialTab={initialTab}
          initialOnlyNovos={initialOnlyNovos}
          highlightId={highlightId}
        />
      )}
    </div>
  );
}
