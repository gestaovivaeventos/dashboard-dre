import { NextResponse } from "next/server";

import { getCaixaUser } from "@/lib/caixa/auth";
import { CAIXA_REAL_PREFS_KEY, parseCaixaRealPrefs } from "@/lib/caixa/prefs";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * PUT /api/caixa/prefs — salva os filtros da tela Caixa Real do usuário logado.
 *
 * O user_id vem da SESSÃO, nunca do corpo: a rota não é um jeito de escrever
 * a preferência de outra pessoa. O corpo passa pelo mesmo parser que a
 * leitura usa, então o que fica gravado é sempre um JSON que a tela sabe ler.
 */
export async function PUT(request: Request) {
  const user = await getCaixaUser();
  if (!user) return NextResponse.json({ error: "Acesso negado." }, { status: 403 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
  }

  const prefs = parseCaixaRealPrefs(body);
  if (!prefs) return NextResponse.json({ error: "Preferências inválidas." }, { status: 400 });

  const { error } = await createAdminClient().from("user_preferences").upsert(
    {
      user_id: user.id,
      key: CAIXA_REAL_PREFS_KEY,
      value: prefs,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,key" },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
