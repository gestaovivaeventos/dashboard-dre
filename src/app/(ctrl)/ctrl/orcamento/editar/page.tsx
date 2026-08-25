import { redirect } from "next/navigation";

import { getCtrlUser, hasCtrlRole } from "@/lib/ctrl/auth";
import { getCadastros } from "@/lib/ctrl/actions/cadastros";
import { listBudgetLines } from "@/lib/ctrl/actions/budget-editor";
import { currentYearBR } from "@/lib/ctrl/datetime";
import { BudgetLinesManager } from "@/components/ctrl/budget-lines-manager";

export const dynamic = "force-dynamic";

export default async function EditarOrcamentoPage() {
  const ctx = await getCtrlUser();
  if (!ctx) redirect("/login");

  // Configurações do módulo: admin + perfil Contas a Pagar (ver
  // @/lib/auth/access, canAccessPathByProfile).
  if (!hasCtrlRole(ctx, "contas_a_pagar", "admin")) {
    redirect("/ctrl/orcamento");
  }

  const year = currentYearBR();
  const [sectorsRes, typesRes, linesRes] = await Promise.all([
    getCadastros("sector"),
    getCadastros("expense_type"),
    listBudgetLines(year),
  ]);
  const { items: sectorItems = [] } = sectorsRes;
  const { items: typeItems = [] } = typesRes;
  const sectors = sectorItems
    .filter((s) => s.active)
    .map((s) => ({ id: s.id, name: s.name }));
  const expenseTypes = typeItems
    .filter((t) => t.active)
    .map((t) => ({ id: t.id, name: t.name }));
  const initialLines = "lines" in linesRes ? linesRes.lines : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Editar Orçamento</h1>
        <p className="text-muted-foreground">
          Adicione, edite, mova ou exclua linhas do orçamento (setor × tipo de despesa), direto no
          sistema — sem planilha. Atenção: um upload de planilha substitui o ano inteiro e sobrescreve
          estes ajustes.
        </p>
      </div>

      <BudgetLinesManager
        sectors={sectors}
        expenseTypes={expenseTypes}
        defaultYear={year}
        initialLines={initialLines}
      />
    </div>
  );
}
