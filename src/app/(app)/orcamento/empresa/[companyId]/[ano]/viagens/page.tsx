import { redirect } from "next/navigation";

import { getOrcamentoAdmin } from "@/lib/orcamento/auth";
import { metodoVisivelPara } from "@/lib/orcamento/metodos";
import { workspaceHubHref } from "@/lib/orcamento/workspace-tabs";
import { ViagensLista } from "@/components/orcamento/viagens-lista";

export const dynamic = "force-dynamic";

/**
 * Aba "Viagens" — a LISTA.
 *
 * O caminho é: escolher o setor → criar a viagem → montar o roteiro em
 * `./[viagemId]`. Empresa e ano vêm da rota; o guard do módulo fica no layout
 * pai, e o recorte por setor/papel é resolvido dentro das actions
 * (`autorizarLeitura`), não aqui.
 */
export default async function WorkspaceViagensPage({
  params,
}: {
  params: { companyId: string; ano: string };
}) {
  // O hub já esconde a caixa de um método em validação; isto fecha a porta de
  // quem chega pela URL. Hoje METODOS_EM_VALIDACAO está vazio.
  const isAdmin = Boolean(await getOrcamentoAdmin());
  if (!metodoVisivelPara("viagens", isAdmin)) {
    redirect(workspaceHubHref(params.companyId, Number(params.ano)));
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold tracking-tight">Viagens</h2>
        <p className="text-sm text-muted-foreground">
          Monte o roteiro — trechos, noites, quartos e deslocamento — e o sistema calcula o custo a
          partir dele. O valor não é digitado: sai dos parâmetros da empresa, e tudo o que for
          estimado aparece dito na tela da viagem.
        </p>
      </div>
      <ViagensLista companyId={params.companyId} year={Number(params.ano)} />
    </div>
  );
}
