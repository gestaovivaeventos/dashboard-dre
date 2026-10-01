import { ValorFixoManager } from "@/components/orcamento/valor-fixo-manager";
import { guardMetodoDaEmpresa } from "@/lib/orcamento/guard-metodo";

import { getOrcamentoUser } from "@/lib/orcamento/auth";
import { podeEditarMetodo } from "@/lib/orcamento/metodos";

export const dynamic = "force-dynamic";

// Aba "Valor fixo com correção" do workspace. Empresa + ano vêm da rota; o guard
// admin fica no layout pai.
export default async function WorkspaceValorFixoPage({
  params,
}: {
  params: { companyId: string; ano: string };
}) {
  // Método em validação OU escondido nesta empresa (Configurações gerais ›
  // Telas por empresa). Esconder a caixa no hub não é defesa: o link direto
  // continua funcionando.
  await guardMetodoDaEmpresa("valor_fixo", params.companyId, Number(params.ano));

  // Gerente e gerente sócio leem este método, mas não editam — ver
  // `podeEditarMetodo`. A tela não é a autorização (as actions repetem a
  // trava), mas deixar digitar para recusar depois é pior que campo travado.
  const user = await getOrcamentoUser();
  const podeEditar = user ? podeEditarMetodo(user.papel, "valor_fixo") : false;
  // Só o admin finaliza e reabre o orçamento.
  const isAdmin = user?.papel === "admin";

  return (
    <div className="space-y-2">
      <div>
        <h2 className="text-xl font-bold tracking-tight">Valor fixo com correção de índices</h2>
        <p className="text-sm text-muted-foreground">
          Para cada categoria marcada com este método, informe o valor atual e o índice de correção; o
          valor corrigido passa a valer a partir do mês de reajuste escolhido. Ex.: aluguel de 1.000
          com IGP-M e reajuste em julho → 1.000/mês até junho, 1.048/mês de julho em diante.
        </p>
      </div>
      <ValorFixoManager
        companyId={params.companyId}
        year={Number(params.ano)}
        podeEditar={podeEditar}
        isAdmin={isAdmin}
      />
    </div>
  );
}
