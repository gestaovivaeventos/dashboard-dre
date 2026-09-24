import { redirect } from "next/navigation";

import { getOrcamentoUser } from "@/lib/orcamento/auth";

export const dynamic = "force-dynamic";

/**
 * Guard das CONFIGURAÇÕES GERAIS do módulo.
 *
 * Mesmo enquadramento do layout de configuração da empresa: a rota já é negada
 * em `canAccessPathByProfile` (`isOrcamentoConfigPath`), e isto é a segunda
 * linha, na própria árvore — o módulo deixou de ser admin-only quando abriu
 * para gerentes e diretores, e configuração redefine PREMISSAS do orçamento.
 */
export default async function OrcamentoConfigGeraisLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await getOrcamentoUser();
  if (!user) redirect("/home");
  if (!user.isAdmin) redirect("/orcamento");
  return <>{children}</>;
}
