import { redirect } from "next/navigation";

import { NovaRequisicaoForm } from "@/components/ctrl/nova-requisicao-form";
import { getCtrlUser, hasCtrlRole } from "@/lib/ctrl/auth";
import { getExpenseTypes } from "@/lib/ctrl/actions/expense-types";
import { getSectors } from "@/lib/ctrl/actions/sectors";
import { getSuppliers } from "@/lib/ctrl/actions/suppliers";
import { createClient } from "@/lib/supabase/server";

async function getActiveEvents() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("ctrl_events")
    .select("id, name, description, is_active, created_by, created_at, updated_at")
    .eq("is_active", true)
    .order("name");
  return data ?? [];
}

export default async function NovaRequisicaoPage() {
  const ctx = await getCtrlUser();
  if (!ctx) redirect("/login");

  if (!hasCtrlRole(ctx, "solicitante", "gerente", "diretor", "csc", "admin")) {
    redirect("/ctrl/requisicoes");
  }

  const [sectorsSettled, expenseTypesSettled, suppliersSettled, eventsSettled] =
    await Promise.allSettled([
      getSectors(),
      getExpenseTypes(),
      getSuppliers("aprovado"),
      getActiveEvents(),
    ]);

  const sectors =
    sectorsSettled.status === "fulfilled"
      ? sectorsSettled.value.sectors ?? []
      : [];
  const expenseTypes =
    expenseTypesSettled.status === "fulfilled"
      ? expenseTypesSettled.value.expenseTypes ?? []
      : [];
  const suppliers =
    suppliersSettled.status === "fulfilled"
      ? suppliersSettled.value.suppliers ?? []
      : [];
  const events = eventsSettled.status === "fulfilled" ? eventsSettled.value : [];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Nova Requisição</h1>
        <p className="text-muted-foreground">
          Preencha os dados para solicitar um pagamento
        </p>
      </div>

      <div className="rounded-lg border bg-card p-6">
        <NovaRequisicaoForm
          sectors={sectors}
          expenseTypes={expenseTypes}
          suppliers={suppliers}
          events={events}
        />
      </div>
    </div>
  );
}
