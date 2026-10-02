import { redirect } from "next/navigation";

import { DpCargosClient } from "@/components/dp/cargos-client";
import { DpEmpresaSelect } from "@/components/dp/empresa-select";
import { DpNaoInstalado } from "@/components/dp/nao-instalado";
import { getDpUser } from "@/lib/dp/auth";
import { getDpCargosPagina, listDpEmpresasComQuadro } from "@/lib/dp/cargos-queries";
import { DpNaoInstaladoError } from "@/lib/dp/queries";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Cargos e salários, por empresa: a estrutura (cargo → níveis → salário), o
 * de-para dos cargos da Sólides para um nível e o enquadramento de cada pessoa.
 */
export default async function DpCargosPage({ searchParams }: { searchParams: { empresa?: string } }) {
  const user = await getDpUser();
  if (!user) redirect("/");

  const db = createAdminClient();
  try {
    const empresas = await listDpEmpresasComQuadro(db);
    // Sem escolha (ou escolha inválida): a de maior quadro — é por onde se começa.
    const escolhida =
      empresas.find((e) => e.id === searchParams.empresa) ??
      empresas.slice().sort((a, b) => b.ativos - a.ativos)[0] ??
      null;
    const pagina = escolhida ? await getDpCargosPagina(db, escolhida.id) : null;

    return (
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-ink-primary">Cargos e salários</h1>
            <p className="text-sm text-ink-muted">
              A estrutura de cada empresa e onde cada pessoa está em relação a ela.
            </p>
          </div>
          {escolhida && <DpEmpresaSelect empresas={empresas} value={escolhida.id} />}
        </div>
        {escolhida && pagina ? (
          <DpCargosClient key={escolhida.id} companyId={escolhida.id} companyName={escolhida.name} pagina={pagina} />
        ) : (
          <p className="text-sm text-ink-muted">Nenhuma empresa ativa encontrada.</p>
        )}
      </div>
    );
  } catch (error) {
    if (error instanceof DpNaoInstaladoError) return <DpNaoInstalado migration="20261002120000_dp_cargos_salarios.sql" />;
    throw error;
  }
}
