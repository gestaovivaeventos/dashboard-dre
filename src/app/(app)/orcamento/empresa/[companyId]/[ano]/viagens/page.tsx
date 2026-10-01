import { guardMetodoDaEmpresa } from "@/lib/orcamento/guard-metodo";
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
  // Método em validação OU escondido nesta empresa: o hub já não oferece a
  // caixa, e isto fecha a porta de quem chega pela URL.
  await guardMetodoDaEmpresa("viagens", params.companyId, Number(params.ano));

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
