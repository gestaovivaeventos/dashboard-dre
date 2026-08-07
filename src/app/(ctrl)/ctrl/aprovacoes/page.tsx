import { redirect } from "next/navigation";

import { AprovacoesClient } from "@/components/ctrl/aprovacoes-client";
import { getCtrlUser, hasCtrlRole } from "@/lib/ctrl/auth";
import { getRequests, getComplementsAwaitingApprover } from "@/lib/ctrl/actions/requests";
import { hasCtrlFullView } from "@/lib/ctrl/full-view";
import { directorHighlightSectorsFor, normalizeSectorName } from "@/lib/ctrl/routing";
import { createClient } from "@/lib/supabase/server";

export default async function AprovacoesPage() {
  const ctx = await getCtrlUser();
  if (!ctx) redirect("/login");

  const fullView = hasCtrlFullView(ctx.email);
  if (
    !fullView &&
    !hasCtrlRole(ctx, "gerente", "diretor", "csc", "contas_a_pagar", "admin")
  ) {
    redirect("/ctrl");
  }

  // Override de destaque "Do seu setor" para responsáveis fora do perfil diretor
  // (ex.: admin que também é diretor de aprovação de setores específicos). Quando
  // configurado, resolve os nomes → IDs de ctrl_sectors e liga o agrupamento.
  const highlightNames = directorHighlightSectorsFor({ email: ctx.email });
  let ownSectorIds = ctx.sectorIds;
  let forceSectorGroups = false;
  if (highlightNames && highlightNames.size > 0) {
    const supabase = await createClient();
    const { data: sectors } = await supabase.from("ctrl_sectors").select("id, name");
    ownSectorIds = (sectors ?? [])
      .filter((s) => highlightNames.has(normalizeSectorName(s.name)))
      .map((s) => s.id);
    forceSectorGroups = ownSectorIds.length > 0;
  } else if (fullView) {
    // Visão completa do módulo: a listagem passa a mostrar TODAS as requisições,
    // então o destaque deixa de ser cosmético — é ele que separa o que depende
    // da aprovação dela do que é só acompanhamento. Os setores vêm do vínculo em
    // Usuários (user_sectors), a mesma fonte da alçada.
    forceSectorGroups = ownSectorIds.length > 0;
  }

  // Setores em que o usuário de fato pode aprovar. Só restringe quem tem a visão
  // completa (e algum setor vinculado) — para os demais, null = sem restrição, a
  // alçada segue exatamente como era. Espelha o fullViewSectorBlock do servidor,
  // que é a trava de verdade; aqui é só para não oferecer o botão.
  const actionSectorIds =
    fullView &&
    ownSectorIds.length > 0 &&
    !hasCtrlRole(ctx, "diretor", "csc", "admin")
      ? ownSectorIds
      : null;

  const { requests = [], error } = await getRequests({
    // Aba "Aprovadas" mostra o histórico completo do que já passou pela aprovação:
    // além de "aprovado" (ainda não enviada), inclui as que seguiram para o Contas
    // a Pagar (agendado / info pendente). Sem isso, a aba só listava as que ainda
    // não tinham sido enviadas ao pagamento.
    statuses: [
      "pendente",
      "pendente_diretor",
      "aguardando_complementacao",
      "aprovado",
      "agendado",
      "info_pagamento_pendente",
      "rejeitado",
    ],
    approvalScope: true,
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
          ownSectorIds={ownSectorIds}
          forceSectorGroups={forceSectorGroups}
          actionSectorIds={actionSectorIds}
          awaitingApproverIds={awaitingApproverIds}
        />
      )}
    </div>
  );
}
