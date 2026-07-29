import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { getCompaniesBudgetConfig } from "@/lib/orcamento/actions/config";
import { DespesasPessoalManager } from "@/components/orcamento/despesas-pessoal-manager";

export const dynamic = "force-dynamic";

export default async function DespesasPessoalPage() {
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
          <h1 className="text-2xl font-bold tracking-tight">Despesas com pessoal</h1>
          <p className="text-muted-foreground">
            Quadro de colaboradores por empresa e ano. Vínculo, cargo e salário atuais (do Plano de
            Cargos), movimentações previstas e justificativa. Empresas que orçam por setor têm um
            quadro por setor.
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
        <DespesasPessoalManager companies={companies} />
      )}
    </div>
  );
}
