import { createAdminClient } from "@/lib/supabase/admin";
import type { CtrlRole } from "@/lib/supabase/types";

// Contadores exibidos como badge na sidebar, por chave de item de navegacao:
//   - "ct-apr": requisicoes aguardando a etapa de aprovacao que o usuario pode agir
//   - "ct-req": requisicoes proprias que precisam de resposta (info pedida)
// Best-effort: qualquer falha retorna o que tiver (sem derrubar o shell).
export async function loadNavBadges(params: {
  userId: string;
  ctrlRoles: CtrlRole[];
}): Promise<Record<string, number>> {
  const badges: Record<string, number> = {};
  const roles = params.ctrlRoles;
  const canApprove = roles.some((r) => ["gerente", "diretor", "csc", "admin"].includes(r));
  const canRequest = roles.some((r) =>
    ["solicitante", "gerente", "diretor", "csc", "admin"].includes(r),
  );
  if (!canApprove && !canRequest) return badges;

  try {
    const db = createAdminClient();
    const tasks: Promise<void>[] = [];

    if (canApprove) {
      const canDirector = roles.some((r) => ["diretor", "csc", "admin"].includes(r));
      const statuses = canDirector ? ["pendente", "pendente_diretor"] : ["pendente"];
      tasks.push(
        (async () => {
          const { count } = await db
            .from("ctrl_requests")
            .select("id", { count: "exact", head: true })
            .in("status", statuses);
          if (count && count > 0) badges["ct-apr"] = count;
        })(),
      );
    }

    if (canRequest) {
      tasks.push(
        (async () => {
          const { count } = await db
            .from("ctrl_requests")
            .select("id", { count: "exact", head: true })
            .eq("created_by", params.userId)
            .in("status", ["aguardando_complementacao", "info_pagamento_pendente"]);
          if (count && count > 0) badges["ct-req"] = count;
        })(),
      );
    }

    await Promise.all(tasks);
  } catch {
    // badges sao best-effort — silenciar falha
  }
  return badges;
}
