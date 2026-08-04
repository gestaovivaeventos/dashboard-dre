import { redirect } from "next/navigation";

import { BiSubscriptionsClient } from "@/components/admin/BiSubscriptionsClient";
import { getCurrentSessionContext } from "@/lib/auth/session";

// ============================================================================
// /admin/relatorios-bi
//
// Gestao das assinaturas do relatorio mensal de Business Intelligence:
// quais usuarios recebem o One Page Report de quais unidades.
//
// Esta tela define APENAS os destinatarios. O envio e regido pela tela
// Financeiro > Validacao Relatorio (dia 4 gera → aceite do CSC envia em 1
// clique → dia 10 envia o que sobrou). O antigo disparo automatico do dia 5
// (/api/cron/monthly-bi-report) foi REMOVIDO — nao reintroduzir.
// ============================================================================

export const dynamic = "force-dynamic";

export default async function RelatoriosBiPage() {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user) {
    redirect("/login");
  }
  if (!profile || profile.role !== "admin") {
    redirect("/dashboard");
  }

  const [{ data: usersData }, { data: companiesData }] = await Promise.all([
    supabase
      .from("users")
      .select("id,name,email")
      .eq("active", true)
      .order("name"),
    supabase
      .from("companies")
      .select("id,name")
      .eq("active", true)
      .order("name"),
  ]);

  const users = (usersData ?? []).map((u) => ({
    id: u.id as string,
    name: (u.name as string | null) ?? null,
    email: u.email as string,
  }));

  const companies = (companiesData ?? []).map((c) => ({
    id: c.id as string,
    name: c.name as string,
  }));

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 p-4 sm:p-6">
      <BiSubscriptionsClient users={users} companies={companies} />
    </div>
  );
}
