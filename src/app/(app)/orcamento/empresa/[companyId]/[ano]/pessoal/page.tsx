import { DespesasPessoalManager } from "@/components/orcamento/despesas-pessoal-manager";
import { getOrcamentoAdmin, podeValidarOrcamento, getOrcamentoUser } from "@/lib/orcamento/auth";

export const dynamic = "force-dynamic";

// Aba "Despesas com pessoal" do workspace. Empresa + ano vêm da rota (o
// cabeçalho do layout é quem os troca); o guard admin fica no layout pai.
export default async function WorkspacePessoalPage({
  params,
}: {
  params: { companyId: string; ano: string };
}) {
  // Só o admin desfaz um cancelamento da diretoria (ver `reativarColaborador`).
  const isAdmin = Boolean(await getOrcamentoAdmin());
  // A diretoria decide NA LINHA de cada colaborador, como no Planejamento.
  const podeValidar = podeValidarOrcamento(await getOrcamentoUser());

  return (
    <div className="space-y-2">
      <div>
        <h2 className="text-xl font-bold tracking-tight">Despesas com pessoal</h2>
        <p className="text-sm text-muted-foreground">
          Quadro de colaboradores: vínculo, cargo e salário atuais (do Plano de Cargos),
          movimentações previstas e justificativa. Empresas que orçam por setor têm um quadro por
          setor.
        </p>
      </div>
      <DespesasPessoalManager
        companyId={params.companyId}
        year={Number(params.ano)}
        isAdmin={isAdmin}
        podeValidar={podeValidar}
      />
    </div>
  );
}
