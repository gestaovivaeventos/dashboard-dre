import { redirect } from "next/navigation";

import { getOrcamentoAdmin } from "@/lib/orcamento/auth";
import { getIndices } from "@/lib/orcamento/actions/indices";
import { IndicesManager } from "@/components/orcamento/indices-manager";
import { GruposArvoreManager } from "@/components/orcamento/grupos-arvore-manager";
import { getCompaniesBudgetConfig } from "@/lib/orcamento/actions/config";
import { defaultBudgetYear } from "@/lib/orcamento/years";

export const dynamic = "force-dynamic";

// Configurações GERAIS do orçamento: o que NÃO é por empresa. Hoje só os Índices
// de correção (nacionais, por ano). As configs por empresa vivem dentro do
// workspace de cada empresa (Orçamento → empresa → Configuração).
export default async function ConfiguracoesGeraisPage() {
  // Índices valem para TODAS as empresas: continua admin-only mesmo para quem
  // tem o módulo (espelha isOrcamentoConfigPath em @/lib/auth/access).
  if (!(await getOrcamentoAdmin())) redirect("/orcamento");

  const { items, error, needsMigration } = await getIndices();
  // A árvore dos grupos filtra a empresa por dentro; aqui só se passa a lista.
  const { items: empresas } = await getCompaniesBudgetConfig(defaultBudgetYear());

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Configurações gerais</h1>
        <p className="text-muted-foreground">
          Ajustes do orçamento que valem para todas as empresas. As configurações específicas de
          cada empresa ficam dentro do orçamento dela (Orçamento → empresa → Configuração).
        </p>
      </div>

      <div>
        <h2 className="text-lg font-semibold tracking-tight">Índices de correção</h2>
        <p className="text-sm text-muted-foreground">
          IPCA, IGP-M, salário mínimo e demais índices por ano. Cada ano é congelado de forma
          independente — cadastrar um ano novo não altera os anteriores, então orçamentos já feitos
          não mudam.
        </p>
      </div>

      {needsMigration ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
          <p className="font-medium">Migration pendente</p>
          <p className="mt-1 text-muted-foreground">
            A tabela de índices ainda não foi aplicada no banco. Rode o{" "}
            <code className="rounded bg-muted px-1 py-0.5">db push</code> da migration{" "}
            <code className="rounded bg-muted px-1 py-0.5">20260727150000_orcamento_indices</code>{" "}
            para habilitar esta tela.
          </p>
        </div>
      ) : error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : (
        <IndicesManager initialItems={items ?? []} />
      )}

      <div className="border-t pt-6">
        <h2 className="text-lg font-semibold tracking-tight">Grupos de despesas</h2>
        <p className="text-sm text-muted-foreground">
          O nível entre a categoria e a despesa, usado no Planejamento dos gestores. Escolha a
          empresa, abra o setor e a categoria, e cadastre ali os grupos que valem naquele ponto —
          é essa a lista que a IA oferece ao gestor e o subnível que a Prévia abre.
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          O nome vive <strong>uma vez por empresa</strong>: digitar &quot;Publicidade&quot; num
          segundo setor reaproveita o mesmo grupo, e por isso a Prévia soma os dois setores num
          subnível só em vez de repetir o nome.
        </p>
        <div className="mt-4">
          <GruposArvoreManager
            companies={(empresas ?? []).map((c) => ({
              companyId: c.companyId,
              companyName: c.companyName,
            }))}
          />
        </div>
      </div>
    </div>
  );
}
