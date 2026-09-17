import { NextResponse } from "next/server";

import { getCaixaUser } from "@/lib/caixa/auth";
import { listCaixaCompanyRefs } from "@/lib/caixa/sync";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * GET /api/caixa/companies — empresas que entram na varredura.
 *
 * A tela pede esta lista antes de "Sincronizar contas" / "Atualizar saldos" e
 * então chama /api/caixa/sync uma vez por empresa, mostrando progresso real.
 * Fatiar assim é o que mantém cada requisição curta: a varredura inteira leva
 * ~430s serializada (medição de 17/09/2026), acima do teto da Vercel.
 *
 * Usa o admin client porque `companies` tem RLS por vínculo de usuário e o
 * módulo Caixa é explicitamente de todas as empresas — o gate é o do módulo.
 */
export async function GET() {
  const user = await getCaixaUser();
  if (!user) return NextResponse.json({ error: "Acesso negado." }, { status: 403 });

  try {
    const companies = await listCaixaCompanyRefs(createAdminClient());
    return NextResponse.json({ companies });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao listar empresas.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
