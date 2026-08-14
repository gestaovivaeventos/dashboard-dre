import { PreviaOrcamentoView } from "@/components/orcamento/previa-orcamento-view";

export const dynamic = "force-dynamic";

// Tela "Prévia do orçamento": a estrutura DRE da empresa preenchida com os
// valores que os métodos orçaram. Empresa + ano vêm da rota; o guard admin fica
// no layout pai. É recalculada ao abrir (view ao vivo), sem etapa de publicar.
export default function WorkspacePreviaPage({
  params,
}: {
  params: { companyId: string; ano: string };
}) {
  return (
    <div className="space-y-2">
      <div>
        <h2 className="text-xl font-bold tracking-tight">Prévia do orçamento</h2>
        <p className="text-sm text-muted-foreground">
          A DRE da empresa montada com os valores orçados em cada método. Atualiza sozinha: mudou um
          valor em Despesas com pessoal ou Média com correção, é só voltar aqui que a prévia já reflete.
        </p>
      </div>
      <PreviaOrcamentoView companyId={params.companyId} year={Number(params.ano)} />
    </div>
  );
}
