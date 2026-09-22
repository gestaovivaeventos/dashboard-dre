import { redirect } from "next/navigation";

import { getOrcamentoUser } from "@/lib/orcamento/auth";

export const dynamic = "force-dynamic";

/**
 * Guard das telas de CONFIGURAÇÃO da empresa (método por categoria, plano de
 * cargos, encargos, setores, orçar por setor).
 *
 * Existe porque o layout pai deixou de ser admin-only quando o módulo abriu
 * para gerentes e diretores: sem este arquivo, a configuração da empresa —
 * que redefine as PREMISSAS do orçamento — ficaria acessível a qualquer
 * construtor. A rota já é negada em `canAccessPathByProfile`
 * (`isOrcamentoConfigPath`); isto é a segunda linha, na própria árvore.
 */
export default async function OrcamentoConfigLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await getOrcamentoUser();
  if (!user) redirect("/home");
  if (!user.isAdmin) redirect("/orcamento");
  return <>{children}</>;
}
