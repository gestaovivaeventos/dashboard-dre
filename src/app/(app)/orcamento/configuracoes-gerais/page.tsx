import { redirect } from "next/navigation";

import { getOrcamentoAdmin } from "@/lib/orcamento/auth";
import { ConfigGeraisHub } from "@/components/orcamento/config-gerais-hub";

export const dynamic = "force-dynamic";

/**
 * Hub das Configurações gerais do orçamento — as caixas das seções.
 *
 * O que entra aqui: o que vale para TODAS as empresas (índices) e o que precisa
 * da empresa como FILTRO em vez de contexto fixo (grupos de despesa). As
 * configurações de uma empresa só continuam dentro do orçamento dela
 * (Orçamento → empresa → Configuração).
 */
export default async function ConfiguracoesGeraisPage() {
  // Admin-only, como toda configuração do módulo (espelha isOrcamentoConfigPath
  // em @/lib/auth/access). O layout desta subárvore repete o guard.
  if (!(await getOrcamentoAdmin())) redirect("/orcamento");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Configurações gerais</h1>
        <p className="text-muted-foreground">
          Ajustes do orçamento que não pertencem a uma empresa só. As configurações específicas de
          cada empresa ficam dentro do orçamento dela (Orçamento → empresa → Configuração).
        </p>
      </div>

      <ConfigGeraisHub />
    </div>
  );
}
