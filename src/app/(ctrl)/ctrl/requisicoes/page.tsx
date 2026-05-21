import { Plus } from "lucide-react";
import { redirect } from "next/navigation";

import { getCtrlUser, hasCtrlRole } from "@/lib/ctrl/auth";
import { getRequests } from "@/lib/ctrl/actions/requests";
import { RequisicoesTable } from "@/components/ctrl/requisicoes-table";

export default async function RequisicoesPage() {
  const ctx = await getCtrlUser();
  if (!ctx) redirect("/login");

  if (
    !hasCtrlRole(
      ctx,
      "solicitante",
      "gerente",
      "diretor",
      "csc",
      "contas_a_pagar",
      "admin",
    )
  ) {
    redirect("/ctrl");
  }

  const canCreateRequest = hasCtrlRole(
    ctx,
    "solicitante",
    "gerente",
    "diretor",
    "csc",
    "admin",
  );

  const { requests, error } = await getRequests();

  // Project only the columns the table component needs — keeps the client
  // payload small and the contract explicit.
  const rows =
    requests?.map((r) => ({
      id: r.id as string,
      request_number: r.request_number as number,
      title: r.title as string,
      amount: Number(r.amount),
      due_date: (r.due_date as string | null) ?? null,
      status: r.status as string,
      created_at: r.created_at as string,
    })) ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Requisições</h1>
          <p className="text-muted-foreground">
            {ctx.ctrlRoles.includes("solicitante") && ctx.ctrlRoles.length === 1
              ? "Suas requisições de pagamento"
              : "Todas as requisições"}
          </p>
        </div>
        {canCreateRequest ? (
          <a
            href="/ctrl/requisicoes/nova"
            className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Plus className="mr-2 h-4 w-4" />
            Nova Requisição
          </a>
        ) : null}
      </div>

      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : (
        <RequisicoesTable requests={rows} />
      )}
    </div>
  );
}
