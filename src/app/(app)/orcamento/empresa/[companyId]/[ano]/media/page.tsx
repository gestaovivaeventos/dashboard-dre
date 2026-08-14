import { MediaCorrecaoManager } from "@/components/orcamento/media-correcao-manager";

export const dynamic = "force-dynamic";

// Aba "Média com correção" do workspace. Empresa + ano vêm da rota; o guard
// admin fica no layout pai.
export default function WorkspaceMediaPage({
  params,
}: {
  params: { companyId: string; ano: string };
}) {
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
      <MediaCorrecaoManager companyId={params.companyId} year={Number(params.ano)} />
    </div>
  );
}
