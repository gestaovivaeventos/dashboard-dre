import { redirect } from "next/navigation";

import { getOrcamentoAdmin } from "@/lib/orcamento/auth";
import { metodoVisivelPara } from "@/lib/orcamento/metodos";
import { workspaceHubHref } from "@/lib/orcamento/workspace-tabs";
import { ViagemMontagem } from "@/components/orcamento/viagem-montagem";

export const dynamic = "force-dynamic";

/**
 * Tela de UMA viagem: o roteiro à esquerda, o custo calculado à direita, a
 * prévia do setor embaixo.
 *
 * O id é uuid e sempre existe: "Nova viagem" grava a linha antes de abrir
 * (ver `criarViagem`), então esta rota nunca precisa do estado "ainda não
 * existe". Viagem de outra empresa ou de setor fora do escopo é recusada dentro
 * da action — inclusive no link direto.
 */
export default async function WorkspaceViagemPage({
  params,
}: {
  params: { companyId: string; ano: string; viagemId: string };
}) {
  const isAdmin = Boolean(await getOrcamentoAdmin());
  if (!metodoVisivelPara("viagens", isAdmin)) {
    redirect(workspaceHubHref(params.companyId, Number(params.ano)));
  }

  return (
    <ViagemMontagem
      companyId={params.companyId}
      year={Number(params.ano)}
      viagemId={params.viagemId}
    />
  );
}
