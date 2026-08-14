import { notFound } from "next/navigation";

import { getCompaniesBudgetConfig } from "@/lib/orcamento/actions/config";
import { getEncargosCompanies } from "@/lib/orcamento/actions/encargos";
import { CONFIG_SECOES, isConfigSecao } from "@/lib/orcamento/workspace-tabs";
import { OrcarPorSetorManager } from "@/components/orcamento/orcar-por-setor-manager";
import { SetoresManager } from "@/components/orcamento/setores-manager";
import { CategoriaMetodoManager } from "@/components/orcamento/categoria-metodo-manager";
import { PlanoCargosManager } from "@/components/orcamento/plano-cargos-manager";
import { EmpresaEncargosManager } from "@/components/orcamento/empresa-encargos-manager";
import { EncargosManager } from "@/components/orcamento/encargos-manager";

export const dynamic = "force-dynamic";

function MigrationNotice() {
  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
      <p className="font-medium">Migration pendente</p>
      <p className="mt-1 text-muted-foreground">
        As tabelas do módulo Orçamento ainda não foram aplicadas no banco.
      </p>
    </div>
  );
}

// Seção de Configuração da empresa. Empresa + ano vêm da rota (fixos); cada
// manager roda travado nesse contexto (sem seletor próprio). O guard admin e o
// cabeçalho (com as abas das seções) ficam no layout pai.
export default async function OrcamentoConfigSecaoPage({
  params,
}: {
  params: { companyId: string; ano: string; secao: string };
}) {
  const { companyId, secao } = params;
  const year = Number(params.ano);
  if (!isConfigSecao(secao)) notFound();

  const meta = CONFIG_SECOES.find((s) => s.slug === secao)!;
  const key = `${companyId}-${year}`;

  let body: React.ReactNode;

  if (secao === "encargos") {
    const { items, error, needsMigration } = await getEncargosCompanies(year);
    body = needsMigration ? (
      <MigrationNotice />
    ) : error ? (
      <p className="text-sm text-destructive">{error}</p>
    ) : (
      <EncargosManager
        key={key}
        initialItems={items ?? []}
        initialYear={year}
        fixedCompanyId={companyId}
        fixedYear={year}
      />
    );
  } else {
    const { items, error, needsMigration } = await getCompaniesBudgetConfig(year);
    if (needsMigration) {
      body = <MigrationNotice />;
    } else if (error) {
      body = <p className="text-sm text-destructive">{error}</p>;
    } else {
      const companies = (items ?? []).map((c) => ({
        companyId: c.companyId,
        companyName: c.companyName,
      }));
      if (secao === "orcar-por-setor") {
        body = (
          <OrcarPorSetorManager
            key={key}
            companies={items ?? []}
            initialYear={year}
            fixedCompanyId={companyId}
            fixedYear={year}
          />
        );
      } else if (secao === "setores") {
        body = (
          <SetoresManager
            key={key}
            companies={items ?? []}
            fixedCompanyId={companyId}
            fixedYear={year}
          />
        );
      } else if (secao === "categoria-metodo") {
        body = (
          <CategoriaMetodoManager
            key={key}
            companies={companies}
            fixedCompanyId={companyId}
            fixedYear={year}
          />
        );
      } else if (secao === "plano-cargos") {
        body = (
          <PlanoCargosManager
            key={key}
            companies={companies}
            fixedCompanyId={companyId}
            fixedYear={year}
          />
        );
      } else if (secao === "empresa-encargos") {
        body = (
          <EmpresaEncargosManager
            key={key}
            companies={items ?? []}
            initialYear={year}
            fixedCompanyId={companyId}
            fixedYear={year}
          />
        );
      }
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold tracking-tight">{meta.label}</h2>
        <p className="text-sm text-muted-foreground">{meta.desc}</p>
      </div>
      {body}
    </div>
  );
}
