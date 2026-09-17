import { NextResponse } from "next/server";

import { getCaixaUser } from "@/lib/caixa/auth";
import type { CaixaHistoryPoint } from "@/lib/caixa/types";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/** Janelas que a tela oferece. Fechado para o cliente não pedir 10 anos. */
const ALLOWED_DAYS = new Set([30, 90, 180, 365]);
/** Bem acima das 378 contas de hoje; é só para não aceitar payload absurdo. */
const MAX_ACCOUNTS = 5000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/caixa/history — série diária do saldo das contas informadas.
 *
 * Body: { accountIds: string[], days: 30 | 90 | 180 | 365 }
 *
 * A tela manda exatamente as contas que está mostrando, então o gráfico
 * obedece a qualquer filtro (empresa, tipo, status, banco, busca) sem que
 * este endpoint precise conhecer nenhum deles. A conta é feita no banco
 * (caixa_history, com carry-forward) e volta um ponto por dia.
 */
export async function POST(request: Request) {
  const user = await getCaixaUser();
  if (!user) return NextResponse.json({ error: "Acesso negado." }, { status: 403 });

  let body: { accountIds?: unknown; days?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
  }

  const ids = Array.isArray(body.accountIds) ? body.accountIds : [];
  if (ids.length === 0) return NextResponse.json({ points: [] });
  if (ids.length > MAX_ACCOUNTS || !ids.every((id) => typeof id === "string" && UUID.test(id))) {
    return NextResponse.json({ error: "accountIds inválido." }, { status: 400 });
  }
  const days = Number(body.days ?? 90);
  if (!ALLOWED_DAYS.has(days)) {
    return NextResponse.json({ error: "days deve ser 30, 90, 180 ou 365." }, { status: 400 });
  }

  const { data, error } = await createAdminClient().rpc("caixa_history", {
    p_account_ids: ids,
    p_days: days,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const points: CaixaHistoryPoint[] = ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    day: String(r.day),
    total: Number(r.total ?? 0),
    contas: Number(r.contas ?? 0),
  }));
  return NextResponse.json({ points });
}
