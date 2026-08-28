import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { markTourSeen } from "@/lib/tour/seen";

// POST /api/tour/seen
//
// Marca que o tour guiado já foi apresentado a este usuário — é o que faz o
// passo a passo aparecer UMA vez só. Disparado pelo próprio tour, no momento em
// que ele abre sozinho.
//
// O id do usuário vem SEMPRE da sessão, nunca do corpo do request: a rota é
// aberta a qualquer autenticado (é a própria marca dele), então aceitar um id
// de fora deixaria qualquer um carimbar a marca de outra pessoa e sumir com o
// onboarding dela. A escrita usa service role porque as policies de
// `user_module_roles` só permitem escrita de admin.

export async function POST() {
  const { user } = await getCurrentSessionContext();
  if (!user) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  const adminClient = createAdminClientIfAvailable();
  if (!adminClient) {
    // Sem service role a marca não persiste. Não é erro para o usuário: o tour
    // já está rodando, e no pior caso volta a aparecer no próximo acesso.
    return NextResponse.json({ ok: false, persisted: false });
  }

  const { error } = await markTourSeen(adminClient, user.id);
  if (error) {
    return NextResponse.json({ error }, { status: 500 });
  }

  return NextResponse.json({ ok: true, persisted: true });
}
