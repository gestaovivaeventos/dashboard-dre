"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { requireViagensUser } from "@/lib/viagens/auth";
import { processPendingSearchRuns } from "@/lib/viagens/process-search";
import type { ViagemRequestInput } from "@/lib/viagens/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<any>;

async function getDb(): Promise<DB> {
  return (createAdminClientIfAvailable() as DB | null) ?? ((await createClient()) as DB);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function criarRequisicao(
  input: ViagemRequestInput,
): Promise<{ requestId: string } | { error: string }> {
  const ctx = await requireViagensUser();

  const origem = input.origem?.trim();
  const destino = input.destino?.trim();
  if (!origem || !destino) return { error: "Informe origem e destino." };
  if (!DATE_RE.test(input.data_ida) || !DATE_RE.test(input.data_volta)) {
    return { error: "Datas inválidas." };
  }
  if (input.data_volta < input.data_ida) return { error: "A volta não pode ser antes da ida." };
  const passageiros = Math.max(1, Math.floor(input.passageiros || 1));
  const janela = Math.min(15, Math.max(0, Math.floor(input.janela_flex_dias || 0)));
  if (!["km", "aluguel", "ambos"].includes(input.modo_carro)) return { error: "Modo do carro inválido." };

  const db = await getDb();
  const { data: created, error } = await db
    .from("viagem_requests")
    .insert({
      origem,
      destino,
      data_ida: input.data_ida,
      data_volta: input.data_volta,
      janela_flex_dias: janela,
      passageiros,
      modo_carro: input.modo_carro,
      incluir_hospedagem: Boolean(input.incluir_hospedagem),
      monitorar: Boolean(input.monitorar),
      observacao: input.observacao?.trim() || null,
      status: "buscando",
      created_by: ctx.id,
    })
    .select("id")
    .single();
  if (error || !created) return { error: `Falha ao criar a requisição: ${error?.message ?? "?"}` };

  const requestId = created.id as string;
  await db.from("viagem_search_runs").insert({ request_id: requestId, kind: "inicial" });
  await db.from("viagem_history").insert({
    request_id: requestId,
    user_id: ctx.id,
    action: "criado",
    metadata: { origem, destino, data_ida: input.data_ida, data_volta: input.data_volta, passageiros },
  });

  revalidatePath("/viagens/requisicoes");
  return { requestId };
}

/** Processa a fila agora (busca imediata) — o cron cobre o resto. */
export async function buscarAgora(): Promise<{ ok: true } | { error: string }> {
  await requireViagensUser();
  const db = await getDb();
  try {
    await processPendingSearchRuns(db, { maxRuns: 2, timeBudgetMs: 120_000 });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Falha na busca." };
  }
  revalidatePath("/viagens/requisicoes");
  return { ok: true };
}

export async function cancelarRequisicao(requestId: string): Promise<{ ok: true } | { error: string }> {
  const ctx = await requireViagensUser();
  const db = await getDb();

  const { data: req } = await db
    .from("viagem_requests")
    .select("id, status, created_by")
    .eq("id", requestId)
    .maybeSingle();
  if (!req) return { error: "Requisição não encontrada." };
  if (!ctx.isAprovador && req.created_by !== ctx.id) return { error: "Sem permissão para cancelar." };
  if (["reservado", "concluido", "cancelado"].includes(req.status as string)) {
    return { error: "Requisição já finalizada." };
  }

  await db
    .from("viagem_requests")
    .update({ status: "cancelado", updated_at: new Date().toISOString() })
    .eq("id", requestId);
  await db.from("viagem_history").insert({ request_id: requestId, user_id: ctx.id, action: "cancelado" });

  revalidatePath("/viagens/requisicoes");
  revalidatePath(`/viagens/requisicoes/${requestId}`);
  return { ok: true };
}
