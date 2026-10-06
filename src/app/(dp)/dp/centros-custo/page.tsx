import { redirect } from "next/navigation";

import { DpCentrosCustoClient } from "@/components/dp/centros-custo-client";
import { DpEmpresaSelect } from "@/components/dp/empresa-select";
import { DpNaoInstalado } from "@/components/dp/nao-instalado";
import { getDpUser } from "@/lib/dp/auth";
import { getDpCargosPagina, listDpEmpresasComQuadro } from "@/lib/dp/cargos-queries";
import { DpNaoInstaladoError } from "@/lib/dp/queries";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Centros de custo por empresa. Centro de custo ≠ departamento/setor (o DP
 * trata como coisas diferentes). O padrão de cada pessoa vem da linha da
 * tabela salarial; a exceção é feita na ficha.
 */
export default async function DpCentrosCustoPage({ searchParams }: { searchParams: { empresa?: string } }) {
  const user = await getDpUser();
  if (!user) redirect("/");
  const db = createAdminClient();
  try {
    const empresas = await listDpEmpresasComQuadro(db);
    const escolhida =
      empresas.find((e) => e.id === searchParams.empresa) ?? empresas.slice().sort((a, b) => b.ativos - a.ativos)[0] ?? null;
    const pagina = escolhida ? await getDpCargosPagina(db, escolhida.id) : null;

    // Uso de cada centro: linhas da tabela que o têm como padrão e pessoas que caem nele.
    const uso = new Map<string, { linhas: number; pessoas: number }>();
    for (const l of pagina?.tabela ?? []) {
      if (!l.centroCustoId) continue;
      const u = uso.get(l.centroCustoId) ?? { linhas: 0, pessoas: 0 };
      u.linhas += 1;
      uso.set(l.centroCustoId, u);
    }
    for (const r of pagina?.enquadramento ?? []) {
      if (!r.centroId) continue;
      const u = uso.get(r.centroId) ?? { linhas: 0, pessoas: 0 };
      u.pessoas += 1;
      uso.set(r.centroId, u);
    }
    const semCentro = (pagina?.enquadramento ?? []).filter((r) => !r.centroId).length;

    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-ink-primary">Centros de custo</h1>
            <p className="text-sm text-ink-muted">
              Diferente do departamento e do setor. O centro de custo de cada pessoa vem da linha dela na tabela salarial — exceções
              se fazem na ficha.
            </p>
          </div>
          {escolhida && <DpEmpresaSelect empresas={empresas} value={escolhida.id} />}
        </div>
        {escolhida && pagina ? (
          <DpCentrosCustoClient
            key={escolhida.id}
            companyId={escolhida.id}
            centros={pagina.centros.map((c) => ({ ...c, ...(uso.get(c.id) ?? { linhas: 0, pessoas: 0 }) }))}
            semCentro={semCentro}
            ativos={pagina.enquadramento.length}
          />
        ) : (
          <p className="text-sm text-ink-muted">Nenhuma empresa ativa encontrada.</p>
        )}
      </div>
    );
  } catch (error) {
    if (error instanceof DpNaoInstaladoError) return <DpNaoInstalado migration="20261002150000_dp_base_cadastral.sql" />;
    throw error;
  }
}
