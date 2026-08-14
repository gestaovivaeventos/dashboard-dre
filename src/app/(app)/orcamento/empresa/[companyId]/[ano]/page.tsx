import { CompanyHub } from "@/components/orcamento/company-hub";
import { getOrcamentoStatus } from "@/lib/orcamento/actions/status";

export const dynamic = "force-dynamic";

// Hub de "caixas" da empresa: escolhe o método de orçamento (ou Configuração).
// Empresa + ano vêm da rota; o guard admin e o cabeçalho ficam no layout pai.
// O status de andamento de cada caixa vem do RPC agregado (acessório: se faltar,
// as caixas só não mostram selo).
export default async function OrcamentoEmpresaHubPage({
  params,
}: {
  params: { companyId: string; ano: string };
}) {
  const year = Number(params.ano);
  const { statuses } = await getOrcamentoStatus(year);

  return (
    <CompanyHub companyId={params.companyId} year={year} status={statuses[params.companyId]} />
  );
}
