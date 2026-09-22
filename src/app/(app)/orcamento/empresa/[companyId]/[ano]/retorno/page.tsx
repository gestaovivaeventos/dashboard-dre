import { redirect } from "next/navigation";

import { RetornoView } from "@/components/orcamento/retorno-view";
import { getOrcamentoUser } from "@/lib/orcamento/auth";

export const dynamic = "force-dynamic";

/**
 * Retorno da diretoria — a terceira etapa do ciclo, na visão de quem montou o
 * orçamento. Empresa + ano vêm da rota; o guard do módulo e o escopo de empresa
 * ficam no layout pai; o recorte por SETOR é aplicado na leitura (`getRetorno`).
 *
 * A tela é aberta a qualquer papel do módulo, inclusive à diretoria: para ela é
 * a conferência do que decidiu, e para o admin é a visão do ciclo todo.
 */
export default async function OrcamentoRetornoPage({
  params,
}: {
  params: { companyId: string; ano: string };
}) {
  const year = Number(params.ano);
  const user = await getOrcamentoUser();
  if (!user) redirect("/home");

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold tracking-tight">Retorno da diretoria</h2>
        <p className="text-sm text-muted-foreground">
          O que mudou no orçamento por decisão da diretoria, com o motivo de cada uma. Marque
          ciente no que entendeu, responda o que foi solicitado e peça liberação do que estiver
          travado.
        </p>
      </div>

      <RetornoView companyId={params.companyId} year={year} />
    </div>
  );
}
