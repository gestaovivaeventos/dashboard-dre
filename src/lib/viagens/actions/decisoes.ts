"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { requireViagensAprovador, requireViagensAdmin } from "@/lib/viagens/auth";
import { notifyViagemUser } from "@/lib/viagens/notifications";
import type { ViagemConfigRow } from "@/lib/viagens/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<any>;

async function getDb(): Promise<DB> {
  return (createAdminClientIfAvailable() as DB | null) ?? ((await createClient()) as DB);
}

function revalidate(requestId: string) {
  revalidatePath("/viagens/requisicoes");
  revalidatePath("/viagens/aprovacoes");
  revalidatePath(`/viagens/requisicoes/${requestId}`);
}

/** Gerente escolhe um dos 3 orçamentos → requisição aprovada. */
export async function escolherOpcao(
  requestId: string,
  quoteId: string,
): Promise<{ ok: true } | { error: string }> {
  const ctx = await requireViagensAprovador();
  const db = await getDb();

  const { data: req } = await db
    .from("viagem_requests")
    .select("id, request_number, status, created_by, origem, destino")
    .eq("id", requestId)
    .maybeSingle();
  if (!req) return { error: "Requisição não encontrada." };
  if (req.status !== "cotado") return { error: `Requisição não está aguardando escolha (status: ${req.status}).` };

  const { data: quote } = await db
    .from("viagem_quotes")
    .select("id, modal, total")
    .eq("id", quoteId)
    .eq("request_id", requestId)
    .maybeSingle();
  if (!quote) return { error: "Orçamento não encontrado para esta viagem." };

  const now = new Date().toISOString();
  await db.from("viagem_quotes").update({ selected: false }).eq("request_id", requestId);
  await db.from("viagem_quotes").update({ selected: true }).eq("id", quoteId);
  await db
    .from("viagem_requests")
    .update({
      status: "aprovado",
      chosen_quote_id: quoteId,
      approved_by: ctx.id,
      approved_at: now,
      updated_at: now,
    })
    .eq("id", requestId);
  await db.from("viagem_history").insert({
    request_id: requestId,
    user_id: ctx.id,
    action: "aprovado",
    metadata: { modal: quote.modal, total: Number(quote.total) },
  });
  await notifyViagemUser(db, {
    userId: req.created_by as string,
    requestId,
    title: `Viagem #${req.request_number} aprovada`,
    message: `Opção escolhida: ${quote.modal} (R$ ${Number(quote.total).toFixed(2)}). Aguardando reserva.`,
    type: "aprovado",
  });

  revalidate(requestId);
  return { ok: true };
}

export async function rejeitarRequisicao(
  requestId: string,
  reason: string,
): Promise<{ ok: true } | { error: string }> {
  const ctx = await requireViagensAprovador();
  if (!reason?.trim()) return { error: "Informe o motivo da rejeição." };
  const db = await getDb();

  const { data: req } = await db
    .from("viagem_requests")
    .select("id, request_number, status, created_by")
    .eq("id", requestId)
    .maybeSingle();
  if (!req) return { error: "Requisição não encontrada." };
  if (!["cotado", "buscando", "erro"].includes(req.status as string)) {
    return { error: `Não dá pra rejeitar no status atual (${req.status}).` };
  }

  const now = new Date().toISOString();
  await db
    .from("viagem_requests")
    .update({ status: "rejeitado", rejected_reason: reason.trim(), updated_at: now })
    .eq("id", requestId);
  await db.from("viagem_history").insert({
    request_id: requestId,
    user_id: ctx.id,
    action: "rejeitado",
    comment: reason.trim(),
  });
  await notifyViagemUser(db, {
    userId: req.created_by as string,
    requestId,
    title: `Viagem #${req.request_number} rejeitada`,
    message: reason.trim(),
    type: "rejeitado",
  });

  revalidate(requestId);
  return { ok: true };
}

/**
 * Fecha a reserva da opção escolhida. MVP: registra a reserva, congela a
 * requisição e envia o roteiro + link de compra ao solicitante — a emissão
 * automática (Amadeus Flight Create Orders) entra quando a conta de produção
 * estiver habilitada (flag VIAGENS_AUTO_ISSUE).
 */
export async function reservarViagem(requestId: string): Promise<{ ok: true } | { error: string }> {
  const ctx = await requireViagensAprovador();
  const db = await getDb();

  const { data: req } = await db
    .from("viagem_requests")
    .select("id, request_number, status, created_by, chosen_quote_id, origem, destino, data_ida, data_volta")
    .eq("id", requestId)
    .maybeSingle();
  if (!req) return { error: "Requisição não encontrada." };
  if (req.status !== "aprovado") return { error: `Requisição não está aprovada (status: ${req.status}).` };
  if (!req.chosen_quote_id) return { error: "Nenhuma opção escolhida." };

  const { data: quote } = await db
    .from("viagem_quotes")
    .select("modal, titulo, total, booking_link")
    .eq("id", req.chosen_quote_id)
    .maybeSingle();
  if (!quote) return { error: "Orçamento escolhido não encontrado." };

  const now = new Date().toISOString();
  await db
    .from("viagem_requests")
    .update({ status: "reservado", reservado_por: ctx.id, reservado_em: now, updated_at: now })
    .eq("id", requestId);
  await db.from("viagem_history").insert({
    request_id: requestId,
    user_id: ctx.id,
    action: "reservado",
    metadata: { modal: quote.modal, total: Number(quote.total) },
  });

  const link = quote.booking_link ? ` Link de compra: ${quote.booking_link}` : "";
  await notifyViagemUser(db, {
    userId: req.created_by as string,
    requestId,
    title: `Viagem #${req.request_number} reservada`,
    message:
      `${req.origem} → ${req.destino} (${req.data_ida} a ${req.data_volta}) — ` +
      `${quote.titulo ?? quote.modal}, total R$ ${Number(quote.total).toFixed(2)}.${link}`,
    type: "reservado",
  });

  revalidate(requestId);
  return { ok: true };
}

/** Atualiza os parâmetros de custo (admin). */
export async function salvarViagemConfig(
  input: ViagemConfigRow,
): Promise<{ ok: true } | { error: string }> {
  await requireViagensAdmin();
  const fields: Array<keyof ViagemConfigRow> = [
    "rate_per_km",
    "aluguel_diaria",
    "preco_combustivel_litro",
    "consumo_km_litro",
    "tarifa_onibus_km",
    "diaria_alimentacao",
    "hotel_diaria_padrao",
  ];
  for (const f of fields) {
    const v = Number(input[f]);
    if (!Number.isFinite(v) || v < 0) return { error: `Valor inválido em ${f}.` };
  }

  const db = await getDb();
  const { error } = await db
    .from("viagem_config")
    .upsert({ id: 1, ...input, updated_at: new Date().toISOString() }, { onConflict: "id" });
  if (error) return { error: error.message };

  revalidatePath("/viagens/config");
  return { ok: true };
}
