import { redirect } from "next/navigation";

import { BusinessIntelligenceClient } from "@/components/financeiro/relatorios/BusinessIntelligenceClient";
import { resolveAllowedCompanyIds } from "@/lib/dashboard/dre";
import { getCurrentSessionContext } from "@/lib/auth/session";

// ============================================================================
// /financeiro/business-intelligence
//
// Page server-rendered: autentica, carrega empresas que o usuario pode ver
// (mesmo padrao de filtragem do dashboard), e renderiza o client component
// que controla os filtros + a chamada manual a /api/intelligence/one-page.
//
// IMPORTANTE: a rota NAO e chamada aqui. A geracao do relatorio so acontece
// quando o usuario clica em "Gerar relatório" no client.
// ============================================================================

export const dynamic = "force-dynamic";

export default async function BusinessIntelligencePage() {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user) {
    redirect("/login");
  }

  // Lista de empresas ativas + filtragem por permissao do usuario (mesma
  // logica do dashboard). Admin ve tudo; demais roles veem apenas as
  // empresas em user_segment_access / user_company_access.
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

  // A rota /api/intelligence/one-page exige role admin. Quando o usuario
  // nao for admin, mostramos a UI mas com o botao desabilitado e um aviso.
  const canGenerate = profile?.role === "admin";

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 p-4 sm:p-6">
      <BusinessIntelligenceClient
        companies={visibleCompanies}
        canGenerate={canGenerate}
      />
    </div>
  );
}
