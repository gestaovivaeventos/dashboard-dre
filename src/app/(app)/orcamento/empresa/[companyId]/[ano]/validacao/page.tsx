import { redirect } from "next/navigation";

import { ValidacaoView } from "@/components/orcamento/validacao-view";
import { getCiclo } from "@/lib/orcamento/actions/ciclo";
import { getOrcamentoUser } from "@/lib/orcamento/auth";

export const dynamic = "force-dynamic";

/**
 * Tela de validação da diretoria. Empresa + ano vêm da rota; o guard do módulo
 * e o escopo de empresa ficam no layout pai.
 *
 * Quem DECIDE aqui é a diretoria (ou o admin) e só enquanto o ciclo está em
 * validação — fora disso a tela existe como leitura, que é o que permite ao
 * gestor conferir o que foi decidido sem depender de outra tela.
 */
export default async function OrcamentoValidacaoPage({
  params,
}: {
  params: { companyId: string; ano: string };
}) {
  const year = Number(params.ano);
  const user = await getOrcamentoUser();
  if (!user) redirect("/home");

  const { ciclo } = await getCiclo(params.companyId, year);
  const papelDecide = user.papel === "validador" || user.papel === "admin";
  // `podeEscrever` já compõe papel × fase: para o validador ele é true apenas
  // em `em_validacao`, que é exatamente a janela da diretoria.
  const podeDecidir = papelDecide && Boolean(ciclo?.podeEscrever);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold tracking-tight">Validação do orçamento</h2>
        <p className="text-sm text-muted-foreground">
          Percorra por setor e categoria. Cancelar, alterar ou solicitar um ajuste registra o
          motivo e avisa quem montou o orçamento — e o total acima se move a cada decisão.
        </p>
      </div>

      <ValidacaoView companyId={params.companyId} year={year} podeDecidir={podeDecidir} />
    </div>
  );
}
