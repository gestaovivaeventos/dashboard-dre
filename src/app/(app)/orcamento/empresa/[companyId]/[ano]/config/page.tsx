import { ConfigHub } from "@/components/orcamento/config-hub";

export const dynamic = "force-dynamic";

// Sub-hub de Configuração da empresa (caixas das seções de config por empresa).
// Empresa + ano vêm da rota; o guard admin e o cabeçalho ficam no layout pai.
export default function OrcamentoEmpresaConfigHubPage({
  params,
}: {
  params: { companyId: string; ano: string };
}) {
  return <ConfigHub companyId={params.companyId} year={Number(params.ano)} />;
}
