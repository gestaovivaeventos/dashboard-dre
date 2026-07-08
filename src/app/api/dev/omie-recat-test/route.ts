import { NextRequest, NextResponse } from "next/server";

import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { getCaseOmieCreds } from "@/lib/case/omie-creds";
import { omieCall } from "@/lib/omie/client";

// Rota TEMPORÁRIA de teste (reclassificação de categoria via API Omie).
// Protegida por token one-off; remover após o teste.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TOKEN = "59d4890154692cca3ae077d166a96d5023cefd61f2767056";
const CONTAPAGAR_URL = "https://app.omie.com.br/api/v1/financas/contapagar/";

export async function POST(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${TOKEN}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json()) as { call?: string; param?: Record<string, unknown> };
  // Escopo mínimo do teste: só consultar/alterar, e só o lançamento do teste.
  const ALLOWED_CALLS = ["ConsultarContaPagar", "AlterarContaPagar"];
  const TEST_LANCAMENTO = 9893736705;
  if (!body.call || !ALLOWED_CALLS.includes(body.call)) {
    return NextResponse.json({ error: "call não permitida" }, { status: 400 });
  }
  if (Number(body.param?.codigo_lancamento_omie) !== TEST_LANCAMENTO) {
    return NextResponse.json({ error: "lançamento não permitido" }, { status: 400 });
  }

  const db = createAdminClientIfAvailable();
  if (!db) return NextResponse.json({ error: "admin client indisponível" }, { status: 500 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const creds = await getCaseOmieCreds(db as any);
  if (!creds) return NextResponse.json({ error: "credenciais Omie indisponíveis" }, { status: 500 });

  try {
    const res = await omieCall(CONTAPAGAR_URL, body.call, creds.appKey, creds.appSecret, body.param ?? {});
    return NextResponse.json({ ok: true, notFound: res.notFound ?? false, data: res.data });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}
