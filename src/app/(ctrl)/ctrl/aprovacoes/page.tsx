import { redirect } from "next/navigation";

import { AprovacoesClient } from "@/components/ctrl/aprovacoes-client";
import { getCtrlUser } from "@/lib/ctrl/auth";
import { getRequests } from "@/lib/ctrl/actions/requests";

export default async function AprovacoesPage() {
  const ctx = await getCtrlUser();
  if (!ctx) redirect("/login");

  const { requests = [], error } = await getRequests({
    statuses: ["pendente", "aguardando_complementacao", "aprovado", "rejeitado", "estornado"],
  });

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
        />
      )}
    </div>
  );
}
