import { CompanyHub } from "@/components/orcamento/company-hub";
import { getOrcamentoStatus } from "@/lib/orcamento/actions/status";
import { contarValidacoesPorMetodo } from "@/lib/orcamento/actions/validacao-diretoria";
import { getOrcamentoUser, podeValidarOrcamento } from "@/lib/orcamento/auth";

export const dynamic = "force-dynamic";

// Hub de "caixas" da empresa: escolhe o método de orçamento (ou Configuração).
// Empresa + ano vêm da rota; o guard do módulo e o cabeçalho ficam no layout pai.
// O status de andamento de cada caixa vem do RPC agregado (acessório: se faltar,
// as caixas só não mostram selo).
export default async function OrcamentoEmpresaHubPage({
  params,
}: {
  params: { companyId: string; ano: string };
}) {
  const year = Number(params.ano);
  // As contagens da validação são RECORTADAS PELO SETOR de quem pergunta (ver
  // a action): o gerente vê o número do setor dele, a diretoria e o admin veem
  // o da empresa. É por isso que o mesmo card diz coisas diferentes para cada
  // um — e é o comportamento pedido.
  const [{ statuses }, user, validacoes] = await Promise.all([
    getOrcamentoStatus(year),
    getOrcamentoUser(),
    contarValidacoesPorMetodo(params.companyId, year),
  ]);

  return (
    <CompanyHub
      companyId={params.companyId}
      year={year}
      status={statuses[params.companyId]}
      isAdmin={Boolean(user?.isAdmin)}
      validacoes={validacoes.contagens ?? {}}
      podeValidar={podeValidarOrcamento(user)}
    />
  );
}
