import { redirect } from "next/navigation";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { getCompaniesBudgetConfig } from "@/lib/orcamento/actions/config";
import { OrcamentoPainel } from "@/components/orcamento/orcamento-painel";

export const dynamic = "force-dynamic";

// Painel de entrada do módulo Orçamento: escolher a EMPRESA (e o ano) e entrar
// no workspace dela. O fluxo do módulo é por empresa — o analista trabalha uma
// de cada vez, passando por todas as telas como abas.
export default async function OrcamentoPainelPage() {
  const { user, profile } = await getCurrentSessionContext();
  if (!user) redirect("/login");
  if (!profile || profile.profile !== "admin") redirect("/dashboard");

  const { items, error, needsMigration } = await getCompaniesBudgetConfig();
  const companies = (items ?? []).map((c) => ({
    companyId: c.companyId,
    companyName: c.companyName,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Orçamento</h1>
        <p className="text-muted-foreground">
          Escolha a empresa para montar o orçamento. Todas as telas — despesas com pessoal, média
          com correção e as demais — ficam num só lugar, sem precisar reselecionar a empresa a cada
          troca.
        </p>
      </div>

      {needsMigration ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
          <p className="font-medium">Migration pendente</p>
          <p className="mt-1 text-muted-foreground">
            As tabelas base do módulo Orçamento ainda não foram aplicadas no banco.
          </p>
        </div>
      ) : error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : (
        <OrcamentoPainel companies={companies} />
      )}
    </div>
  );
}
