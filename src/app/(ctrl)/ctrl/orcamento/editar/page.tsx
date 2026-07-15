import { redirect } from "next/navigation";

import { getCtrlUser, hasCtrlRole } from "@/lib/ctrl/auth";
import { getCadastros } from "@/lib/ctrl/actions/cadastros";
import { BudgetLineEditor } from "@/components/ctrl/budget-line-editor";

export const dynamic = "force-dynamic";

export default async function EditarOrcamentoPage() {
  const ctx = await getCtrlUser();
  if (!ctx) redirect("/login");

  if (!hasCtrlRole(ctx, "admin")) {
    redirect("/ctrl/orcamento");
  }

  const [sectorsRes, typesRes] = await Promise.all([
    getCadastros("sector"),
    getCadastros("expense_type"),
  ]);
  const { items: sectorItems = [] } = sectorsRes;
  const { items: typeItems = [] } = typesRes;
  const sectors = sectorItems
    .filter((s) => s.active)
    .map((s) => ({ id: s.id, name: s.name }));
  const expenseTypes = typeItems
    .filter((t) => t.active)
    .map((t) => ({ id: t.id, name: t.name }));
  const year = new Date().getFullYear();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Editar Orçamento</h1>
        <p className="text-muted-foreground">
          Ajuste manualmente o orçado e o realizado por setor, tipo de despesa e mês. Alternativa ao
          upload da planilha — atenção: um upload substitui o ano inteiro e sobrescreve estes ajustes.
        </p>
      </div>

      <BudgetLineEditor sectors={sectors} expenseTypes={expenseTypes} defaultYear={year} />
    </div>
  );
}
