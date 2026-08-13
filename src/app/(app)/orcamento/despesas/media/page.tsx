import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { getCompaniesBudgetConfig } from "@/lib/orcamento/actions/config";
import { MediaCorrecaoManager } from "@/components/orcamento/media-correcao-manager";

export const dynamic = "force-dynamic";

export default async function DespesasMediaPage() {
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
          Orçamento
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Média com correção de índices</h1>
          <p className="text-muted-foreground">
            Para cada categoria marcada com este método, o sistema calcula a média de consumo do ano
            anterior (dados da Omie) e projeta o valor mensal do orçamento, opcionalmente corrigido
            por um índice. A média pode ser recalculada e editada; cada empresa tem seus próprios
            valores.
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
        <MediaCorrecaoManager companies={companies} />
      )}
    </div>
  );
}
