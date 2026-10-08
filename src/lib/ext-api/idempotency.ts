import "server-only";

import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import { extError } from "@/lib/ext-api/handler";
import { createAdminClient } from "@/lib/supabase/admin";

// Idempotência das criações da API externa (tabela ctrl_api_idempotency).
//
// Só a resposta de SUCESSO é guardada: erro de validação apaga a reserva, para
// o cliente poder corrigir o corpo e reenviar com a mesma chave. A reserva é um
// INSERT na PK — duas chamadas simultâneas com a mesma chave não passam juntas.

const KEY_PATTERN = /^[\w.:-]{8,128}$/;

export function hashBody(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(body ?? null)).digest("hex");
}

export async function withIdempotency(
  request: Request,
  clientId: string,
  userId: string,
  body: unknown,
  run: () => Promise<Response>,
): Promise<Response> {
  const key = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!KEY_PATTERN.test(key)) {
    return extError(400, "Envie um Idempotency-Key (8 a 128 caracteres: letras, números, . _ : -).");
  }
  const hash = hashBody(body);
  const admin = createAdminClient();

  const { error: reserveErr } = await admin.from("ctrl_api_idempotency").insert({
    client: clientId,
    key,
    user_id: userId,
    request_hash: hash,
    status: "em_andamento",
  });

  if (reserveErr) {
    if (reserveErr.code !== "23505") throw new Error(reserveErr.message);
    const { data: prior } = await admin
      .from("ctrl_api_idempotency")
      .select("request_hash, status, http_status, response, user_id")
      .eq("client", clientId)
      .eq("key", key)
      .maybeSingle();
    if (!prior) return extError(409, "Idempotency-Key em uso; tente de novo.");
    if (prior.user_id !== userId || prior.request_hash !== hash) {
      return extError(422, "Este Idempotency-Key já foi usado com outro conteúdo.");
    }
    if (prior.status !== "concluido") {
      return extError(409, "Uma chamada com este Idempotency-Key ainda está em andamento.");
    }
    return NextResponse.json(prior.response, {
      status: prior.http_status ?? 200,
      headers: { "Idempotent-Replayed": "true" },
    });
  }

  let response: Response;
  try {
    response = await run();
  } catch (err) {
    await admin.from("ctrl_api_idempotency").delete().eq("client", clientId).eq("key", key);
    throw err;
  }

  if (response.ok) {
    const payload = await response.clone().json().catch(() => null);
    await admin
      .from("ctrl_api_idempotency")
      .update({ status: "concluido", http_status: response.status, response: payload })
      .eq("client", clientId)
      .eq("key", key);
  } else {
    await admin.from("ctrl_api_idempotency").delete().eq("client", clientId).eq("key", key);
  }
  return response;
}
