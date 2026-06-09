"use server";

import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { CtrlRole } from "@/lib/supabase/types";

async function getSupabase() {
  return createAdminClientIfAvailable() ?? (await createClient());
}

/** Quantas notificações nao lidas o usuario tem. Retorna 0 em caso de erro
 *  (UI nao quebra por causa de contador). */
export async function getUnreadNotificationsCount(userId: string): Promise<number> {
  if (!userId) return 0;
  const supabase = await getSupabase();
  const { count, error } = await supabase
    .from("ctrl_notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("is_read", false);
  if (error) {
    console.error("[notifications] Falha ao contar nao lidas:", error);
    return 0;
  }
  return count ?? 0;
}

export async function notifyPendingApproval(params: {
  requestId: string;
  requestNumber: number;
  requesterName: string;
  sectorId: string;
  sectorName: string;
  amount: number;
  // Etapa que precisa aprovar agora: 'gerente' ou 'diretor'.
  stage: "gerente" | "diretor";
  // Quando informado, notifica exatamente estes usuarios (alem dos admins),
  // ignorando o roteamento por papel/setor. Usado para regras de negocio
  // especificas (gerente fixo por tipo de despesa, diretor fixo por solicitante).
  explicitApproverIds?: string[];
}) {
  const supabase = await getSupabase();

  let sectorFilteredIds: string[];

  if (params.explicitApproverIds && params.explicitApproverIds.length > 0) {
    sectorFilteredIds = [...params.explicitApproverIds];
  } else {
    // Etapa gerente → notifica gerentes; etapa diretor → notifica diretores.
    const targetCtrlRoles: CtrlRole[] = params.stage === "diretor" ? ["diretor"] : ["gerente"];

    // 1) Usuarios com a(s) role(s) granular(es) — modelo antigo (user_module_roles)
    const { data: moduleRows } = await supabase
      .from("user_module_roles")
      .select("user_id")
      .eq("module", "ctrl")
      .in("role", targetCtrlRoles);
    const moduleUserIds = (moduleRows ?? []).map((r) => r.user_id as string);

    // 2) Modelo novo (users.profile + can_compras): gerente/diretor unificados.
    const { data: profileRows } = await supabase
      .from("users")
      .select("id")
      .eq("active", true)
      .eq("can_compras", true)
      .in("profile", targetCtrlRoles as string[]);
    const profileUserIds = (profileRows ?? []).map((r) => r.id as string);

    // Uniao dos candidatos antes do filtro de setor.
    const candidateIds = Array.from(new Set([...moduleUserIds, ...profileUserIds]));

    // 3) Filtra por setor da requisicao via user_sectors. Regra:
    //    - quem NAO tem nenhum vinculo em user_sectors recebe tudo (fallback,
    //      pra nao quebrar fluxo enquanto cadastros estao incompletos);
    //    - quem tem vinculos so recebe se um deles for o setor da requisicao.
    sectorFilteredIds = [];
    if (candidateIds.length > 0) {
      const { data: linkRows } = await supabase
        .from("user_sectors")
        .select("user_id, sector_id")
        .in("user_id", candidateIds);
      const linksByUser = new Map<string, Set<string>>();
      for (const row of linkRows ?? []) {
        const uid = row.user_id as string;
        const sid = row.sector_id as string;
        if (!linksByUser.has(uid)) linksByUser.set(uid, new Set());
        linksByUser.get(uid)!.add(sid);
      }
      sectorFilteredIds = candidateIds.filter((uid) => {
        const links = linksByUser.get(uid);
        if (!links || links.size === 0) return true; // sem vinculos => recebe tudo
        return links.has(params.sectorId);
      });
    }
  }

  // 4) Admins DRE (acesso implicito ao ctrl, sem filtro de setor)
  const { data: adminRows } = await supabase
    .from("users")
    .select("id")
    .eq("role", "admin")
    .eq("active", true);
  const adminUserIds = (adminRows ?? []).map((r) => r.id as string);

  const userIds = Array.from(new Set([...sectorFilteredIds, ...adminUserIds]));
  if (userIds.length === 0) return;

  const { data: approvers } = await supabase
    .from("users")
    .select("id, name, email")
    .in("id", userIds);

  if (!approvers?.length) return;

  const fmt = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

  await supabase.from("ctrl_notifications").insert(
    approvers.map((u) => ({
      user_id: u.id,
      request_id: params.requestId,
      title: "Nova Requisição Pendente",
      message: `Requisição #${params.requestNumber} de ${params.requesterName} (${params.sectorName}) aguarda aprovação. Valor: ${fmt.format(params.amount)}`,
      type: "pendente",
    }))
  );
}

export async function notifyRequester(params: {
  userId: string;
  requestId: string;
  requestNumber: number;
  title: string;
  message: string;
  type: string;
}) {
  const supabase = await getSupabase();
  await supabase.from("ctrl_notifications").insert({
    user_id: params.userId,
    request_id: params.requestId,
    title: params.title,
    message: params.message,
    type: params.type,
  });
}

export async function notifyAdmins(params: {
  requestId: string | null;
  title: string;
  message: string;
  type: string;
}) {
  const supabase = await getSupabase();

  // Admins DRE (role=admin) + usuarios com permissao 'csc' em user_module_roles
  const { data: adminRows } = await supabase
    .from("users")
    .select("id")
    .eq("role", "admin")
    .eq("active", true);
  const adminIds = (adminRows ?? []).map((r) => r.id as string);

  const { data: cscRows } = await supabase
    .from("user_module_roles")
    .select("user_id")
    .eq("module", "ctrl")
    .eq("role", "csc");
  const cscIds = (cscRows ?? []).map((r) => r.user_id as string);

  const admins = Array.from(new Set([...adminIds, ...cscIds])).map((id) => ({ id }));
  if (!admins.length) return;
  await supabase.from("ctrl_notifications").insert(
    admins.map((u) => ({
      user_id: u.id,
      request_id: params.requestId,
      title: params.title,
      message: params.message,
      type: params.type,
    }))
  );
}
