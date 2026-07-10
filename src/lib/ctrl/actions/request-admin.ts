"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { requireCtrlRole } from "@/lib/ctrl/auth";

// Ações administrativas (admin-only, a princípio) para editar e excluir uma
// requisição direto da tela de Requisições.
//
// Contabilidade do orçamento: NÃO tocamos em ctrl_budget. O consumo é dinâmico
// (soma de ctrl_requests por status). Editar os campos da requisição ou
// ocultá-la (soft delete via deleted_at) já move/libera o valor no orçamento na
// próxima leitura. Todas as leituras que somam por status filtram deleted_at.

// Campos que o admin pode editar (foco no que move o orçamento).
export interface AdminEditRequestInput {
  title?: string;
  description?: string | null;
  amount?: number;
  sector_id?: string;
  expense_type_id?: string | null;
  due_date?: string | null;
  reference_month?: number;
  reference_year?: number;
}

// Uma requisição está "no Omie" (bloqueada para edição/exclusão) quando já foi
// agendada para pagamento ou tem título em contas a pagar. Editar/excluir aqui
// divergiria do Omie — o admin resolve no Omie primeiro.
function isLaunchedToOmie(req: {
  status: string;
  omie_contapagar_codigo: number | null;
}): boolean {
  return req.status === "agendado" || req.omie_contapagar_codigo != null;
}

export async function updateRequestByAdmin(
  requestId: string,
  data: AdminEditRequestInput,
) {
  const ctx = await requireCtrlRole("admin");
  const supabase = createAdminClientIfAvailable() ?? (await createClient());

  const { data: req, error: fetchErr } = await supabase
    .from("ctrl_requests")
    .select(
      "id, status, deleted_at, omie_contapagar_codigo, title, description, amount, sector_id, expense_type_id, due_date, reference_month, reference_year",
    )
    .eq("id", requestId)
    .maybeSingle();

  if (fetchErr || !req) return { error: "Requisição não encontrada." };
  if (req.deleted_at) return { error: "Requisição excluída não pode ser editada." };
  if (isLaunchedToOmie(req as { status: string; omie_contapagar_codigo: number | null })) {
    return {
      error: "Requisição já lançada no Omie — ajuste no Omie antes de editar.",
    };
  }

  // Monta o payload só com os campos enviados e diferentes do atual, guardando o
  // diff campo a campo para o histórico.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const current = req as Record<string, any>;
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const changes: Record<string, [unknown, unknown]> = {};
  const set = (key: string, value: unknown) => {
    if ((current[key] ?? null) !== (value ?? null)) {
      payload[key] = value;
      changes[key] = [current[key] ?? null, value ?? null];
    }
  };

  if (data.title !== undefined) {
    const t = data.title.trim();
    if (!t) return { error: "O título é obrigatório." };
    set("title", t);
  }
  if (data.description !== undefined) set("description", data.description?.trim() || null);
  if (data.amount !== undefined) {
    if (!(data.amount > 0)) return { error: "O valor deve ser maior que zero." };
    set("amount", data.amount);
  }
  if (data.sector_id !== undefined) {
    if (!data.sector_id) return { error: "Setor é obrigatório." };
    set("sector_id", data.sector_id);
  }
  if (data.expense_type_id !== undefined) set("expense_type_id", data.expense_type_id || null);
  if (data.due_date !== undefined) set("due_date", data.due_date || null);
  if (data.reference_month !== undefined) {
    if (data.reference_month < 1 || data.reference_month > 12) {
      return { error: "Mês de referência inválido." };
    }
    set("reference_month", data.reference_month);
  }
  if (data.reference_year !== undefined) set("reference_year", data.reference_year);

  if (Object.keys(changes).length === 0) return { ok: true as const, unchanged: true };

  const { error: updErr } = await supabase
    .from("ctrl_requests")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update(payload as any)
    .eq("id", requestId);
  if (updErr) return { error: updErr.message };

  await supabase.from("ctrl_history").insert({
    request_id: requestId,
    user_id: ctx.id,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    action: "editado" as any,
    comment: `Editada pelo admin ${ctx.name ?? ctx.email}`,
    metadata: { changes, edited_by_roles: ctx.ctrlRoles },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  revalidatePath("/ctrl/requisicoes");
  revalidatePath("/ctrl/aprovacoes");
  revalidatePath("/ctrl/contas-a-pagar");
  revalidatePath("/ctrl/orcamento");
  revalidatePath("/home");
  return { ok: true as const };
}

export async function deleteRequestByAdmin(requestId: string, reason?: string) {
  const ctx = await requireCtrlRole("admin");
  const supabase = createAdminClientIfAvailable() ?? (await createClient());

  const { data: req, error: fetchErr } = await supabase
    .from("ctrl_requests")
    .select("id, status, deleted_at, omie_contapagar_codigo, request_number")
    .eq("id", requestId)
    .maybeSingle();

  if (fetchErr || !req) return { error: "Requisição não encontrada." };
  if (req.deleted_at) return { error: "Requisição já excluída." };
  if (isLaunchedToOmie(req as { status: string; omie_contapagar_codigo: number | null })) {
    return {
      error: "Requisição já lançada no Omie — ajuste no Omie antes de excluir.",
    };
  }

  const now = new Date().toISOString();
  const { error: updErr } = await supabase
    .from("ctrl_requests")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update({ deleted_at: now, deleted_by: ctx.id, updated_at: now } as any)
    .eq("id", requestId)
    .is("deleted_at", null);
  if (updErr) return { error: updErr.message };

  await supabase.from("ctrl_history").insert({
    request_id: requestId,
    user_id: ctx.id,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    action: "excluido" as any,
    comment: reason?.trim() || `Excluída pelo admin ${ctx.name ?? ctx.email}`,
    metadata: { deleted_by_roles: ctx.ctrlRoles, reason: reason?.trim() ?? null },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  revalidatePath("/ctrl/requisicoes");
  revalidatePath("/ctrl/aprovacoes");
  revalidatePath("/ctrl/contas-a-pagar");
  revalidatePath("/ctrl/orcamento");
  revalidatePath("/home");
  return { ok: true as const, requestNumber: req.request_number };
}
