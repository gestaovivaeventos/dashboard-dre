import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { getCompaniesBudgetConfig } from "@/lib/orcamento/actions/config";
import { PlanoCargosManager } from "@/components/orcamento/plano-cargos-manager";

export const dynamic = "force-dynamic";

export default async function PlanoCargosPage() {
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
      <div className="space-y-2">
        <Link
          href="/orcamento/configuracoes"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          Configurações
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Plano de cargos e salários</h1>
          <p className="text-muted-foreground">
            Cargos e seus níveis (ex.: Júnior, Pleno, Sênior), cada um com o
            salário-base. É o ponto de partida do orçamento de despesas com
            pessoal — no quadro, o salário do nível pré-preenche o funcionário e
            continua editável.
          </p>
        </div>
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
        <PlanoCargosManager companies={companies} />
      )}
    </div>
  );
}
