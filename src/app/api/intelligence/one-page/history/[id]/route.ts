import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

// ============================================================================
// GET /api/intelligence/one-page/history/[id]
//
// Retorna o `content_json` completo de um relatorio One Page salvo no
// historico. Defesa em duas camadas:
//   1. Filtro WHERE created_by = user.id na query.
//   2. Checagem explicita do `created_by` da row apos o fetch.
//
// Garante que um usuario NUNCA consiga ler o content_json de outro usuario,
// mesmo via id valido.
// ============================================================================

interface Params {
  params: { id: string };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, { params }: Params) {
  const { user, profile } = await getCurrentSessionContext();
  if (!user || !profile) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  // Pre-requisito: acesso ao modulo Financeiro. A propriedade do relatorio
  // (created_by) e validada em duas camadas abaixo.
  if (!profile.can_financeiro) {
    return NextResponse.json({ error: "Acesso restrito." }, { status: 403 });
  }

  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ error: "ID invalido." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("ai_reports")
    .select("id, content_json, created_by, type")
    .eq("id", params.id)
    .eq("type", "one-page")
    .maybeSingle<{
      id: string;
      content_json: Record<string, unknown> | null;
      created_by: string;
      type: string;
    }>();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Relatorio nao encontrado." }, { status: 404 });
  }
  if (data.created_by !== user.id) {
    // Defesa extra: mesmo que o ID seja conhecido, so o autor pode acessar.
    return NextResponse.json({ error: "Acesso restrito." }, { status: 403 });
  }
  if (!data.content_json) {
    return NextResponse.json(
      { error: "Conteudo do relatorio vazio." },
      { status: 500 },
    );
  }

  return NextResponse.json(data.content_json);
}
