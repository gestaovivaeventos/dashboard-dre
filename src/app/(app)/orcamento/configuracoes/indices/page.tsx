import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { getIndices } from "@/lib/orcamento/actions/indices";
import { IndicesManager } from "@/components/orcamento/indices-manager";

export const dynamic = "force-dynamic";

export default async function IndicesPage() {
  const { user, profile } = await getCurrentSessionContext();
  if (!user) redirect("/login");
  if (!profile || profile.profile !== "admin") redirect("/dashboard");

  const { items, error, needsMigration } = await getIndices();

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
          <h1 className="text-2xl font-bold tracking-tight">Índices de correção</h1>
          <p className="text-muted-foreground">
            IPCA, IGP-M e salário mínimo por ano. Cada ano é congelado de forma
            independente — cadastrar um ano novo não altera os anteriores, então
            orçamentos já feitos não mudam.
          </p>
        </div>
      </div>

      {needsMigration ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
          <p className="font-medium">Migration pendente</p>
          <p className="mt-1 text-muted-foreground">
            A tabela de índices ainda não foi aplicada no banco. Rode o{" "}
            <code className="rounded bg-muted px-1 py-0.5">db push</code> da migration{" "}
            <code className="rounded bg-muted px-1 py-0.5">
              20260727150000_orcamento_indices
            </code>{" "}
            para habilitar esta tela.
          </p>
        </div>
      ) : error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : (
        <IndicesManager initialItems={items ?? []} />
      )}
    </div>
  );
}
