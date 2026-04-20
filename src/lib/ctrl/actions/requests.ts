"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { requireCtrlRole } from "@/lib/ctrl/auth";
import type { CtrlRequest, CtrlRequestStatus } from "@/lib/supabase/types";

export interface CreateRequestInput {
  title: string;
  description?: string;
  sector_id: string;
  expense_type_id?: string;
  supplier_id?: string;
  amount: number;
  due_date?: string;
}

export async function createRequest(data: CreateRequestInput) {
  const ctx = await requireCtrlRole("solicitante", "gerente", "diretor", "csc", "admin");
  const supabase = await createClient();

  const { data: inserted, error } = await supabase
    .from("ctrl_requests")
    .insert({
      title: data.title,
      description: data.description ?? null,
      sector_id: data.sector_id,
      expense_type_id: data.expense_type_id ?? null,
      supplier_id: data.supplier_id ?? null,
      amount: data.amount,
      due_date: data.due_date ?? null,
      created_by: ctx.id,
      status: "pendente",
      approval_level: 0,
    })
    .select("id, request_number")
    .single();

  if (error) return { error: error.message };

  await supabase.from("ctrl_history").insert({
    request_id: inserted.id,
    user_id: ctx.id,
    action: "criado",
    comment: null,
  });

  revalidatePath("/ctrl/requisicoes");
  return { requestId: inserted.id, requestNumber: inserted.request_number };
}

export async function getRequests(filters?: {
  status?: CtrlRequestStatus;
  sector_id?: string;
}) {
  const ctx = await requireCtrlRole("solicitante", "gerente", "diretor", "csc", "admin");
  const supabase = await createClient();

  let query = supabase
    .from("ctrl_requests")
    .select(`
      *,
      ctrl_sectors(name),
      ctrl_expense_types(name),
      ctrl_suppliers(name),
      creator:users!ctrl_requests_created_by_fkey(name, email)
    `)
    .order("created_at", { ascending: false });

  if (filters?.status) query = query.eq("status", filters.status);
  if (filters?.sector_id) query = query.eq("sector_id", filters.sector_id);

  // solicitante só vê as próprias (RLS garante, mas filtra aqui também)
  if (ctx.ctrlRole === "solicitante") {
    query = query.eq("created_by", ctx.id);
  }

  const { data, error } = await query;
  if (error) return { error: error.message };
  return { requests: data as CtrlRequest[] };
}

export async function updateRequestStatus(
  requestId: string,
  newStatus: CtrlRequestStatus,
  comment?: string,
) {
  const ctx = await requireCtrlRole("gerente", "diretor", "csc", "admin");
  const adminClient = createAdminClientIfAvailable();
  const supabase = adminClient ?? (await createClient());

  const actionMap: Record<string, "aprovado" | "rejeitado" | "estornado" | "travado" | "inativado"> = {
    aprovado: "aprovado",
    rejeitado: "rejeitado",
    estornado: "estornado",
    travado: "travado",
    inativado_csc: "inativado",
  };

  const { error } = await supabase
    .from("ctrl_requests")
    .update({
      status: newStatus,
      approved_by: newStatus === "aprovado" ? ctx.id : undefined,
      approved_at: newStatus === "aprovado" ? new Date().toISOString() : undefined,
      rejected_at: newStatus === "rejeitado" ? new Date().toISOString() : undefined,
      updated_at: new Date().toISOString(),
    })
    .eq("id", requestId);

  if (error) return { error: error.message };

  const historyAction = actionMap[newStatus];
  if (historyAction) {
    await supabase.from("ctrl_history").insert({
      request_id: requestId,
      user_id: ctx.id,
      action: historyAction,
      comment: comment ?? null,
    });
  }

  revalidatePath("/ctrl/requisicoes");
  revalidatePath("/ctrl/aprovacoes");
  return { ok: true };
}
