"use server";

import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { CtrlRole } from "@/lib/supabase/types";

async function getSupabase() {
  return createAdminClientIfAvailable() ?? (await createClient());
}

export async function notifyPendingApproval(params: {
  requestId: string;
  requestNumber: number;
  requesterName: string;
  sectorId: string;
  sectorName: string;
  amount: number;
  approvalTier: "nivel_2" | "nivel_3";
}) {
  const supabase = await getSupabase();

  // nivel_2 → notifica gerentes; nivel_3 → notifica diretores.
  // 'admin' (DRE role) e sempre incluido.
  const targetCtrlRoles: CtrlRole[] =
    params.approvalTier === "nivel_3" ? ["diretor"] : ["gerente"];

  // 1) Usuarios com a(s) role(s) granular(es) em user_module_roles
  const { data: moduleRows } = await supabase
    .from("user_module_roles")
    .select("user_id")
    .eq("module", "ctrl")
    .in("role", targetCtrlRoles);

  const moduleUserIds = (moduleRows ?? []).map((r) => r.user_id as string);

  // 2) Admins DRE (acesso implicito ao ctrl)
  const { data: adminRows } = await supabase
    .from("users")
    .select("id")
    .eq("role", "admin")
    .eq("active", true);
  const adminUserIds = (adminRows ?? []).map((r) => r.id as string);

  const userIds = Array.from(new Set([...moduleUserIds, ...adminUserIds]));
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
