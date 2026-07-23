import { redirect } from "next/navigation";

import { AprovacoesClient } from "@/components/ctrl/aprovacoes-client";
import { getCtrlUser, hasCtrlRole } from "@/lib/ctrl/auth";
import { getRequests, getComplementsAwaitingApprover } from "@/lib/ctrl/actions/requests";

export default async function AprovacoesPage() {
  const ctx = await getCtrlUser();
  if (!ctx) redirect("/login");

  if (!hasCtrlRole(ctx, "gerente", "diretor", "csc", "contas_a_pagar", "admin")) {
    redirect("/ctrl");
  }

  const { requests = [], error } = await getRequests({
    statuses: ["pendente", "pendente_diretor", "aguardando_complementacao", "aprovado", "rejeitado", "estornado"],
  });

  // Requisições em complementação cujo último turno é resposta do solicitante
  // (aguardando análise do aprovador) — alimenta o alerta da aba Complementação.
  const complementIds = (requests as Array<{ id: string; status: string }>)
    .filter((r) => r.status === "aguardando_complementacao")
    .map((r) => r.id);
  const awaitingApproverIds = complementIds.length
    ? (await getComplementsAwaitingApprover(complementIds)).ids ?? []
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Aprovações</h1>
        <p className="text-muted-foreground">
          Gerencie requisições pendentes de aprovação
        </p>
      </div>

      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : (
        <AprovacoesClient
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          requests={requests as any}
          ctrlRoles={ctx.ctrlRoles}
          ownSectorIds={ctx.sectorIds}
          awaitingApproverIds={awaitingApproverIds}
        />
      )}
    </div>
  );
}
