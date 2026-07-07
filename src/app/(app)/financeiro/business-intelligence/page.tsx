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

// Empresas ocultadas do seletor de Empresa APENAS no Business Intelligence
// (pedido de negocio). Nao aparecem no filtro para NENHUM usuario, inclusive
// admin e quem tem acesso a empresa. Escopo restrito a esta tela: Dashboard,
// Fluxo de Caixa, Budget e Forecast etc. continuam mostrando a empresa.
const BI_HIDDEN_COMPANY_IDS = new Set<string>([
  "36e5e164-f5ca-4498-9771-ab0999b977d6", // Express
]);

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

  const visibleCompanies = (
    profile?.role === "admin"
      ? allCompanies
      : allCompanies.filter((c) => allowedCompanyIds.includes(c.id))
  ).filter((c) => !BI_HIDDEN_COMPANY_IDS.has(c.id));

  // Geracao liberada para quem tem acesso ao modulo Financeiro. A rota
  // /api/intelligence/one-page valida, por empresa, se o usuario pode gerar
  // (admin: qualquer empresa; franqueado e demais: apenas as liberadas em
  // user_company_access). As empresas no seletor ja sao as visiveis ao
  // usuario, entao o botao fica habilitado normalmente.
  const canGenerate = profile?.can_financeiro === true;

  // Habilita o botao "Gerar teste sem IA" apenas em desenvolvimento. Em
  // producao a rota dev-only nao existe (retorna 404), entao tambem nao
  // renderizamos o botao no client — evita confusao do usuario.
  const isDev = process.env.NODE_ENV !== "production";

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 p-4 sm:p-6">
      <BusinessIntelligenceClient
        companies={visibleCompanies}
        canGenerate={canGenerate}
        isDev={isDev}
      />
    </div>
  );
}
