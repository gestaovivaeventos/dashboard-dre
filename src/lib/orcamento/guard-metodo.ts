import { redirect } from "next/navigation";

import { getOrcamentoAdmin } from "@/lib/orcamento/auth";
import { metodoVisivelPara, type OrcamentoMetodo } from "@/lib/orcamento/metodos";
import { getMetodosOcultos } from "@/lib/orcamento/actions/metodos-empresa";
import { metodoVisivelNaEmpresa } from "@/lib/orcamento/metodos-visiveis";
import { workspaceHubHref } from "@/lib/orcamento/workspace-tabs";

/**
 * Guard de uma rota de MÉTODO do orçamento.
 *
 * Duas perguntas, as duas num só lugar — e é esse o ponto deste módulo existir:
 *
 *   1. o método está EM VALIDAÇÃO? (`METODOS_EM_VALIDACAO`, só admin vê);
 *   2. o método está escondido NESTA EMPRESA? (Configurações gerais › Telas por
 *      empresa).
 *
 * Esconder a caixa no hub não é defesa: o link direto continua funcionando, e é
 * por isso que a rota confere também. Dois guards separados em cinco páginas
 * seriam dez chamadas para alguém esquecer; aqui é uma, e `guard-metodo.test.ts`
 * confere que toda rota de método a chama.
 *
 * Redireciona ao hub da empresa em vez de dar 404: a empresa existe e o usuário a
 * alcança — o que não existe é aquela tela ali.
 */
export async function guardMetodoDaEmpresa(
  metodo: OrcamentoMetodo,
  companyId: string,
  year: number,
): Promise<void> {
  const isAdmin = Boolean(await getOrcamentoAdmin());
  if (!metodoVisivelPara(metodo, isAdmin)) {
    redirect(workspaceHubHref(companyId, year));
  }

  const { ocultos } = await getMetodosOcultos(companyId);
  // **Admin NÃO passa por cima.** A visibilidade por empresa é uma decisão de
  // cadastro ("esta unidade não orça viagem"), não uma alçada: deixar o admin
  // entrar faria a tela existir só para ele, preencher dado que ninguém mais vê
  // e somar na Prévia da empresa. Quem precisa mexer liga a tela antes — e aí o
  // que mudou fica visível no cadastro em vez de ser contornado em silêncio. É o
  // mesmo enquadramento da trava de finalização.
  if (!metodoVisivelNaEmpresa(metodo, new Set(ocultos))) {
    redirect(workspaceHubHref(companyId, year));
  }
}
