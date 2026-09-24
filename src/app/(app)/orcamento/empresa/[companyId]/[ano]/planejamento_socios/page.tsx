import { redirect } from "next/navigation";

import { getOrcamentoAdmin } from "@/lib/orcamento/auth";
import { metodoVisivelPara } from "@/lib/orcamento/metodos";
import { workspaceHubHref } from "@/lib/orcamento/workspace-tabs";
import { PlanejamentoLista } from "@/components/orcamento/planejamento-lista";

export const dynamic = "force-dynamic";

/**
 * Aba "Planejamento dos gestores" — a LISTA.
 *
 * O caminho é: filtrar os setores → escolher a categoria → montar o orçamento
 * dela na tela de montagem (`./[categoryCode]`). Empresa e ano vêm da rota; o
 * guard do módulo fica no layout pai, e o recorte por setor/papel é resolvido
 * dentro das actions (`autorizarLeitura`), não aqui.
 */
export default async function WorkspacePlanejamentoPage({
  params,
}: {
  params: { companyId: string; ano: string };
}) {
  // EM VALIDAÇÃO: o método só aparece para administradores enquanto estiver em
  // METODOS_EM_VALIDACAO (metodos.ts). O hub já esconde a caixa; isto fecha a
  // porta de quem chega pela URL.
  const isAdmin = Boolean(await getOrcamentoAdmin());
  if (!metodoVisivelPara("planejamento_socios", isAdmin)) {
    redirect(workspaceHubHref(params.companyId, Number(params.ano)));
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold tracking-tight">Planejamento dos gestores</h2>
        <p className="text-sm text-muted-foreground">
          Escolha os setores e a categoria que quer orçar. Dentro de cada categoria, uma entrevista
          guiada por IA ajuda a montar as despesas do ano — e a prévia do setor vai se preenchendo
          enquanto você conversa.
        </p>
      </div>
      <PlanejamentoLista companyId={params.companyId} year={Number(params.ano)} />
    </div>
  );
}
