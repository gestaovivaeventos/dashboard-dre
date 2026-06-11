import { redirect } from "next/navigation";

import { DocumentosAnexosClient } from "@/components/financeiro/documentos/DocumentosAnexosClient";
import { resolveAllowedCompanyIds } from "@/lib/dashboard/dre";
import { getCurrentSessionContext } from "@/lib/auth/session";

// ============================================================================
// /financeiro/documentos — Documentos anexos
//
// Server component: autentica, carrega as empresas que o usuario pode ver
// (mesmo padrao do dashboard/BI — resolveAllowedCompanyIds), e renderiza o
// client component que controla o filtro de empresa, a listagem e (para admin)
// o upload/exclusao.
//
// Visibilidade de empresa = mesma regra das demais telas: admin ve todas;
// franqueado e demais perfis veem apenas as de user_company_access.
// ============================================================================

export const dynamic = "force-dynamic";

export default async function DocumentosAnexosPage() {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user) {
    redirect("/login");
  }

  const { data: companiesData } = await supabase
    .from("companies")
    .select("id,name,active")
    .eq("active", true)
    .order("name");

  const allCompanies = (companiesData ?? []).map((c) => ({
    id: c.id as string,
    name: c.name as string,
  }));

  const allowedCompanyIds = await resolveAllowedCompanyIds(
    supabase,
    profile,
    allCompanies.map((c) => c.id),
  );

  const visibleCompanies =
    profile?.role === "admin"
      ? allCompanies
      : allCompanies.filter((c) => allowedCompanyIds.includes(c.id));

  // Apenas admin envia/exclui documentos. A rota POST/DELETE tambem valida
  // isso no backend — o flag aqui apenas controla a UI.
  const canManage = profile?.role === "admin";

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 p-4 sm:p-6">
      <DocumentosAnexosClient companies={visibleCompanies} canManage={canManage} />
    </div>
  );
}
