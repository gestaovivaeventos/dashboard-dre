import { PlanejamentoSociosManager } from "@/components/orcamento/planejamento-socios-manager";

export const dynamic = "force-dynamic";

// Aba "Planejamento dos sócios" do workspace. Empresa + ano vêm da rota; o guard
// admin fica no layout pai. As categorias marcadas com este método são orçadas
// por uma entrevista conduzida por IA (Gemini).
export default function WorkspacePlanejamentoSociosPage({
  params,
}: {
  params: { companyId: string; ano: string };
}) {
  return (
    <div className="space-y-2">
      <div>
        <h2 className="text-xl font-bold tracking-tight">Planejamento dos sócios</h2>
        <p className="text-sm text-muted-foreground">
          Para cada categoria marcada com este método, uma entrevista guiada por IA ajuda a chegar
          nos 12 valores mensais do ano. Escolha por qual categoria começar.
        </p>
      </div>
      <PlanejamentoSociosManager companyId={params.companyId} year={Number(params.ano)} />
    </div>
  );
}
