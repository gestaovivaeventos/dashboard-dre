import { PlanejamentoSociosManager } from "@/components/orcamento/planejamento-socios-manager";
import { getOrcamentoAdmin } from "@/lib/orcamento/auth";

export const dynamic = "force-dynamic";

// Aba "Planejamento dos sócios" do workspace. Empresa + ano vêm da rota; o guard
// admin fica no layout pai. As categorias marcadas com este método são orçadas
// por uma entrevista conduzida por IA (Gemini). A base de pagamentos do ano
// anterior é visível só para admin (o construtor do orçamento).
export default async function WorkspacePlanejamentoSociosPage({
  params,
}: {
  params: { companyId: string; ano: string };
}) {
  const isAdmin = Boolean(await getOrcamentoAdmin());
  return (
    <div className="space-y-2">
      <div>
        <h2 className="text-xl font-bold tracking-tight">Planejamento dos sócios</h2>
        <p className="text-sm text-muted-foreground">
          Para cada categoria marcada com este método, uma entrevista guiada por IA ajuda a chegar
          nos itens do orçamento do ano. Escolha por qual categoria começar.
        </p>
      </div>
      <PlanejamentoSociosManager companyId={params.companyId} year={Number(params.ano)} isAdmin={isAdmin} />
    </div>
  );
}
