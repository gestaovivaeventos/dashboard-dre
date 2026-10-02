import { redirect } from "next/navigation";

import { DpEmpresaSelect } from "@/components/dp/empresa-select";
import { DpNaoInstalado } from "@/components/dp/nao-instalado";
import { DpSimulacoesClient } from "@/components/dp/simulacoes-client";
import { currentYearBR } from "@/lib/ctrl/datetime";
import { getDpUser } from "@/lib/dp/auth";
import { getDpCargosPagina, listDpEmpresasComQuadro } from "@/lib/dp/cargos-queries";
import { lerEncargosDaEmpresa } from "@/lib/dp/encargos-dp";
import { DpNaoInstaladoError } from "@/lib/dp/queries";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Simulações de custo por empresa: aumento, promoção, contratação e
 * enquadramento de quem está abaixo da tabela, com encargos. Nada é gravado —
 * o cenário vive na tela; a conta é a de @/lib/dp/simulacao.
 */
export default async function DpSimulacoesPage({ searchParams }: { searchParams: { empresa?: string } }) {
  const user = await getDpUser();
  if (!user) redirect("/");

  const db = createAdminClient();
  try {
    const empresas = await listDpEmpresasComQuadro(db);
    const escolhida =
      empresas.find((e) => e.id === searchParams.empresa) ??
      empresas.slice().sort((a, b) => b.ativos - a.ativos)[0] ??
      null;
    const ano = currentYearBR();
    const [pagina, encargos] = escolhida
      ? await Promise.all([getDpCargosPagina(db, escolhida.id), lerEncargosDaEmpresa(db, escolhida.id, ano)])
      : [null, null];

    return (
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-ink-primary">Simulações</h1>
            <p className="text-sm text-ink-muted">Quanto custa uma decisão de pessoal antes de tomá-la.</p>
          </div>
          {escolhida && <DpEmpresaSelect empresas={empresas} value={escolhida.id} />}
        </div>
        {escolhida && pagina && encargos ? (
          <DpSimulacoesClient
            key={escolhida.id}
            companyName={escolhida.name}
            ano={ano}
            pessoas={pagina.enquadramento.map((r) => ({
              id: r.colaboradorId,
              nome: r.nome,
              departamento: r.departamento,
              tipoContrato: r.tipoContrato,
              salario: r.salario,
              salarioTabela: r.salarioTabela,
            }))}
            tabela={pagina.tabela.map((l) => ({ id: l.id, setor: l.setor, cargo: l.cargo, salario: l.salario }))}
            encargos={encargos}
          />
        ) : (
          <p className="text-sm text-ink-muted">Nenhuma empresa ativa encontrada.</p>
        )}
      </div>
    );
  } catch (error) {
    if (error instanceof DpNaoInstaladoError) return <DpNaoInstalado />;
    throw error;
  }
}
