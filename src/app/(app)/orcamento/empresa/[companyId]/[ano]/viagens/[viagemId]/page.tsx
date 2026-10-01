import { guardMetodoDaEmpresa } from "@/lib/orcamento/guard-metodo";
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
  // Método em validação OU escondido nesta empresa (Configurações gerais ›
  // Telas por empresa). Esconder a caixa no hub não é defesa: o link direto
  // continua funcionando.
  await guardMetodoDaEmpresa("viagens", params.companyId, Number(params.ano));

  return (
    <ViagemMontagem
      companyId={params.companyId}
      year={Number(params.ano)}
      viagemId={params.viagemId}
    />
  );
}
