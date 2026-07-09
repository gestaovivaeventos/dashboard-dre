import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { verifyWebhook } from "@/lib/case/clicksign";
import { launchContractToOmie } from "@/lib/case/actions/contract-launch";

// Lançamento automático no Omie na assinatura pode levar dezenas de chamadas.
export const maxDuration = 300;

// Eventos do ClickSign que indicam documento finalizado (todos assinaram).
const FINALIZED_EVENTS = new Set(["auto_close", "close", "document_closed"]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<any>;

export async function POST(request: Request) {
  const raw = await request.text();
  const hmac = request.headers.get("Content-Hmac") ?? request.headers.get("content-hmac");

  if (!verifyWebhook(raw, hmac)) {
    return NextResponse.json({ error: "HMAC inválido" }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "corpo inválido" }, { status: 400 });
  }

  const event = (payload.event as Record<string, unknown> | undefined) ?? {};
  const eventName = String(event.name ?? "");
  const document = (payload.document as Record<string, unknown> | undefined) ?? {};
  const documentKey = String(document.key ?? "");

  // Observabilidade no 1º teste real: identificar o nome exato do evento de conclusão.
  console.log(`[case/clicksign] evento="${eventName}" documentKey="${documentKey}"`);

  // Só agimos no fechamento do documento; demais eventos são ACKados.
  if (!FINALIZED_EVENTS.has(eventName) || !documentKey) {
    return NextResponse.json({ ok: true, ignored: eventName || "sem-evento" });
  }

  let db: DB;
  try {
    db = createAdminClient() as DB;
  } catch {
    // Sem service role não há como escrever com segurança — ClickSign re-tenta.
    return NextResponse.json({ error: "indisponível" }, { status: 503 });
  }

  const { data: contract } = await db
    .from("case_contracts")
    .select("id, status")
    .eq("clicksign_document_key", documentKey)
    .maybeSingle();

  if (!contract) {
    return NextResponse.json({ ok: true, ignored: "contrato-nao-encontrado" });
  }

  // Não sobrescreve o status de um contrato que já avançou (lancado/parcial).
  if (["lancado", "parcial"].includes(contract.status as string)) {
    await db
      .from("case_contracts")
      .update({ clicksign_status: eventName, signed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", contract.id);
    return NextResponse.json({ ok: true, signedOnly: true });
  }

  await db
    .from("case_contracts")
    .update({
      status: "assinado",
      clicksign_status: eventName,
      signed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", contract.id);

  await db.from("case_history").insert({
    contract_id: contract.id,
    action: "assinado",
    comment: "Contrato assinado pelo cliente (ClickSign).",
  });

  // Assinou → lança tudo que estiver pendente no Omie (a receber como custódia
  // + despesas já salvas). Best-effort: falha vira status erro/parcial no
  // contrato e pode ser reprocessada pelo botão Lançar no Omie.
  try {
    await launchContractToOmie(db, contract.id);
  } catch (e) {
    console.error("[case/clicksign] falha no lançamento automático pós-assinatura:", e);
  }

  return NextResponse.json({ ok: true });
}
