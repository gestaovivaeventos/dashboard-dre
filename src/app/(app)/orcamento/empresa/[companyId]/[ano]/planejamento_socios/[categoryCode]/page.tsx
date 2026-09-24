import { Suspense } from "react";

import { redirect } from "next/navigation";

import { getOrcamentoAdmin } from "@/lib/orcamento/auth";
import { metodoVisivelPara } from "@/lib/orcamento/metodos";
import { workspaceHubHref } from "@/lib/orcamento/workspace-tabs";
import { PlanejamentoMontagem } from "@/components/orcamento/planejamento-montagem";

export const dynamic = "force-dynamic";

/**
 * Montagem do orçamento de UMA categoria pelo Planejamento dos gestores.
 *
 * O código da categoria vem da rota (já codificado por `planejamentoCategoriaHref`)
 * e o setor vem da query `?setor=` — a categoria é a mesma, o que muda é de qual
 * setor é este orçamento.
 *
 * `Suspense` porque o componente usa `useSearchParams`: sem ele o Next força a
 * página inteira para client-side rendering na build.
 */
export default async function WorkspacePlanejamentoCategoriaPage({
  params,
}: {
  params: { companyId: string; ano: string; categoryCode: string };
}) {
  // Mesmo gate da lista (ver METODOS_EM_VALIDACAO em metodos.ts).
  const isAdmin = Boolean(await getOrcamentoAdmin());
  if (!metodoVisivelPara("planejamento_socios", isAdmin)) {
    redirect(workspaceHubHref(params.companyId, Number(params.ano)));
  }

  return (
    <Suspense fallback={null}>
      <PlanejamentoMontagem
        companyId={params.companyId}
        year={Number(params.ano)}
        categoryCode={decodeURIComponent(params.categoryCode)}
      />
    </Suspense>
  );
}
