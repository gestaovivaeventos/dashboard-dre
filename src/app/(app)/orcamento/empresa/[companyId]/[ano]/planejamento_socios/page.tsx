import { guardMetodoDaEmpresa } from "@/lib/orcamento/guard-metodo";
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
  // Método em validação OU escondido nesta empresa: o hub já não oferece a
  // caixa, e isto fecha a porta de quem chega pela URL.
  await guardMetodoDaEmpresa("planejamento_socios", params.companyId, Number(params.ano));

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
