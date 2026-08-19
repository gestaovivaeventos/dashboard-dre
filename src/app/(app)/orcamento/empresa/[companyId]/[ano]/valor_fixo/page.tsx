import { ValorFixoManager } from "@/components/orcamento/valor-fixo-manager";

export const dynamic = "force-dynamic";

// Aba "Valor fixo com correção" do workspace. Empresa + ano vêm da rota; o guard
// admin fica no layout pai.
export default function WorkspaceValorFixoPage({
  params,
}: {
  params: { companyId: string; ano: string };
}) {
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
      <ValorFixoManager companyId={params.companyId} year={Number(params.ano)} />
    </div>
  );
}
