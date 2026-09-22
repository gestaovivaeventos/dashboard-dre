import { redirect } from "next/navigation";

import { getCtrlUser, hasCtrlRole } from "@/lib/ctrl/auth";
import { getRequests } from "@/lib/ctrl/actions/requests";
import { RelatoriosClient } from "@/components/ctrl/relatorios-client";

export default async function RelatoriosPage() {
  const ctx = await getCtrlUser();
  if (!ctx) redirect("/login");

  if (
    !hasCtrlRole(ctx, "solicitante", "gerente", "diretor", "csc", "contas_a_pagar", "admin")
  ) {
    redirect("/ctrl/requisicoes");
  }

  // Visibilidade por SETOR — fonte única em getRequests (mesma regra das telas
  // de Requisições e Aprovações): cada usuário (inclusive o solicitante) vê os
  // relatórios só dos setores vinculados a ele; diretor, admin e a visão completa
  // nominal veem todos.
  const result = await getRequests({ reportScope: true });
  const requests = "requests" in result ? result.requests : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Relatórios</h1>
        <p className="text-muted-foreground">
          Filtre por qualquer coluna, ordene clicando no cabeçalho e exporte em XLSX
        </p>
      </div>

      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <RelatoriosClient requests={requests as any} />
    </div>
  );
}
