import { DespesasPessoalManager } from "@/components/orcamento/despesas-pessoal-manager";

export const dynamic = "force-dynamic";

// Aba "Despesas com pessoal" do workspace. Empresa + ano vêm da rota (o
// cabeçalho do layout é quem os troca); o guard admin fica no layout pai.
export default function WorkspacePessoalPage({
  params,
}: {
  params: { companyId: string; ano: string };
}) {
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
      <DespesasPessoalManager companyId={params.companyId} year={Number(params.ano)} />
    </div>
  );
}
