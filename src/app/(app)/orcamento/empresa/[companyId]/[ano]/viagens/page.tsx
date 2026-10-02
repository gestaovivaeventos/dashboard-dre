import { guardMetodoDaEmpresa } from "@/lib/orcamento/guard-metodo";
import { ViagensGrade } from "@/components/orcamento/viagens-grade";

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
          Uma linha por viagem: destino, mês, noites e pessoas. O custo vem das faixas de referência
          da empresa — nunca digitado — e cada linha abre na árvore de grupos. Para uma viagem
          multi-destino, abra a viagem e monte o roteiro lá.
        </p>
      </div>
      <ViagensGrade companyId={params.companyId} year={Number(params.ano)} />
    </div>
  );
}
