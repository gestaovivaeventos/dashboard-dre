import { redirect } from "next/navigation";

import { getOrcamentoUser, podeVerEmpresa } from "@/lib/orcamento/auth";
import { getCompaniesBudgetConfig } from "@/lib/orcamento/actions/config";
import { WorkspaceHeader } from "@/components/orcamento/workspace-header";
import { isValidBudgetYear } from "@/lib/orcamento/years";

export const dynamic = "force-dynamic";

// Layout do workspace de uma empresa: guarda o módulo e o escopo de empresa,
// resolve empresa + ano da
// rota e monta o cabeçalho fixo (empresa/ano travados + abas). As páginas de
// aba (pessoal, media, …) renderizam dentro dele.
export default async function OrcamentoEmpresaLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { companyId: string; ano: string };
}) {
  const user = await getOrcamentoUser();
  if (!user) redirect("/home");
  // Empresa fora do escopo (URL montada à mão) volta ao painel, que mostra só
  // as que ele alcança.
  if (!podeVerEmpresa(user, params.companyId)) redirect("/orcamento");

  const year = Number(params.ano);
  // Ano fora da faixa (URL adulterada) → volta ao painel para reescolher.
  if (!isValidBudgetYear(year)) redirect("/orcamento");

  const { items } = await getCompaniesBudgetConfig(year);
  const companyName =
    (items ?? []).find((c) => c.companyId === params.companyId)?.companyName ?? "Empresa";

  return (
    <div className="space-y-6">
      <WorkspaceHeader
        companyName={companyName}
        companyId={params.companyId}
        year={year}
      />
      {children}
    </div>
  );
}
