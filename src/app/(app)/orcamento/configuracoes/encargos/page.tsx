import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { getEncargosCompanies } from "@/lib/orcamento/actions/encargos";
import { defaultBudgetYear } from "@/lib/orcamento/years";
import { EncargosManager } from "@/components/orcamento/encargos-manager";

export const dynamic = "force-dynamic";

export default async function EncargosPage() {
  const { user, profile } = await getCurrentSessionContext();
  if (!user) redirect("/login");
  if (!profile || profile.profile !== "admin") redirect("/dashboard");

  const year = defaultBudgetYear();
  const { items, error, needsMigration } = await getEncargosCompanies(year);

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
          <h1 className="text-2xl font-bold tracking-tight">Encargos sobre a folha</h1>
          <p className="text-muted-foreground">
            Alíquotas usadas na prévia de despesas com pessoal. Cada empresa começa com o padrão do
            seu <strong>regime tributário</strong> — no Simples Nacional a contribuição patronal já
            está no DAS e sobra o FGTS; no Lucro Presumido/Real incidem INSS, RAT×FAP e terceiros.
            Como o RAT vem do CNAE e o FAP é calculado empresa a empresa, o padrão pode ser
            ajustado individualmente por ano.
          </p>
        </div>
      </div>

      {needsMigration ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
          <p className="font-medium">Migration pendente</p>
          <p className="mt-1 text-muted-foreground">
            Rode a migration{" "}
            <code className="rounded bg-muted px-1 py-0.5">
              20260730140000_orcamento_pessoal_admissao_encargos
            </code>{" "}
            para habilitar esta tela.
          </p>
        </div>
      ) : error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : (
        <EncargosManager initialItems={items ?? []} initialYear={year} />
      )}
    </div>
  );
}
