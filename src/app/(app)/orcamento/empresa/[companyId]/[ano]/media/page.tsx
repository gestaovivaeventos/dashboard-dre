import { MediaCorrecaoManager } from "@/components/orcamento/media-correcao-manager";

import { getOrcamentoUser } from "@/lib/orcamento/auth";
import { podeEditarMetodo } from "@/lib/orcamento/metodos";

export const dynamic = "force-dynamic";

// Aba "Média com correção" do workspace. Empresa + ano vêm da rota; o guard
// admin fica no layout pai.
export default async function WorkspaceMediaPage({
  params,
}: {
  params: { companyId: string; ano: string };
}) {
  // Gerente e gerente sócio leem este método, mas não editam — ver
  // `podeEditarMetodo`. A tela não é a autorização (as actions repetem a
  // trava), mas deixar digitar para recusar depois é pior que campo travado.
  const user = await getOrcamentoUser();
  const podeEditar = user ? podeEditarMetodo(user.papel, "media") : false;
  // Só o admin finaliza e reabre o orçamento.
  const isAdmin = user?.papel === "admin";

  return (
    <div className="space-y-2">
      <div>
        <h2 className="text-xl font-bold tracking-tight">Média com correção de índices</h2>
        <p className="text-sm text-muted-foreground">
          Para cada categoria marcada com este método, o sistema calcula a média de consumo do ano
          anterior (dados da Omie) e projeta o valor mensal do orçamento, opcionalmente corrigido por
          um índice. A média pode ser recalculada e editada.
        </p>
      </div>
      <MediaCorrecaoManager
        companyId={params.companyId}
        year={Number(params.ano)}
        podeEditar={podeEditar}
        isAdmin={isAdmin}
      />
    </div>
  );
}
