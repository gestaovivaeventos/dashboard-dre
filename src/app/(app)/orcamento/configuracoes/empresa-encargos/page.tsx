import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { getCompaniesBudgetConfig } from "@/lib/orcamento/actions/config";
import { defaultBudgetYear } from "@/lib/orcamento/years";
import { EmpresaEncargosManager } from "@/components/orcamento/empresa-encargos-manager";

export const dynamic = "force-dynamic";

export default async function EmpresaEncargosPage() {
  const { user, profile } = await getCurrentSessionContext();
  if (!user) redirect("/login");
  if (!profile || profile.profile !== "admin") redirect("/dashboard");

  const { items, year, error, needsMigration } = await getCompaniesBudgetConfig();

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
          <h1 className="text-2xl font-bold tracking-tight">Empresa dos encargos</h1>
          <p className="text-muted-foreground">
            Liga a coluna <strong>Empresa</strong> no quadro de Despesas com pessoal. Serve para as
            empresas que têm gente registrada em outro CNPJ do grupo: o custo continua no orçamento
            da empresa orçada, mas os encargos daquele colaborador seguem o regime tributário da
            empresa em que ele é registrado.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Desligado, a coluna some <strong>e</strong> os encargos de todo o quadro voltam a seguir
            o regime da própria empresa — o que estiver marcado nos colaboradores fica gravado, mas
            deixa de valer. Assim nenhuma regra invisível mexe no orçamento.
          </p>
        </div>
      </div>

      {needsMigration ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
          <p className="font-medium">Migration pendente</p>
          <p className="mt-1 text-muted-foreground">
            Rode a migration{" "}
            <code className="rounded bg-muted px-1 py-0.5">
              20260731160000_orcamento_usar_empresa_encargos
            </code>{" "}
            para habilitar esta tela.
          </p>
        </div>
      ) : error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : (
        <EmpresaEncargosManager
          companies={items ?? []}
          initialYear={year ?? defaultBudgetYear()}
        />
      )}
    </div>
  );
}
