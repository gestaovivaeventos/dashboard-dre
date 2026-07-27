import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { getCompaniesBudgetConfig } from "@/lib/orcamento/actions/config";
import { OrcarPorSetorManager } from "@/components/orcamento/orcar-por-setor-manager";

export const dynamic = "force-dynamic";

export default async function OrcarPorSetorPage() {
  const { user, profile } = await getCurrentSessionContext();
  if (!user) redirect("/login");
  if (!profile || profile.profile !== "admin") redirect("/dashboard");

  const { items, error, needsMigration } = await getCompaniesBudgetConfig();

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
          <h1 className="text-2xl font-bold tracking-tight">Orçar por setor</h1>
          <p className="text-muted-foreground">
            Defina, por empresa, se o orçamento é detalhado por setor. Quando
            desligado, a empresa orça apenas por categoria.
          </p>
        </div>
      </div>

      {needsMigration ? (
        <MigrationNotice />
      ) : error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : (
        <OrcarPorSetorManager companies={items ?? []} />
      )}
    </div>
  );
}

function MigrationNotice() {
  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
      <p className="font-medium">Migration pendente</p>
      <p className="mt-1 text-muted-foreground">
        As tabelas do módulo Orçamento ainda não foram aplicadas no banco. Rode o{" "}
        <code className="rounded bg-muted px-1 py-0.5">db push</code> da migration{" "}
        <code className="rounded bg-muted px-1 py-0.5">
          20260727140000_orcamento_config_setores
        </code>{" "}
        para habilitar esta tela.
      </p>
    </div>
  );
}
