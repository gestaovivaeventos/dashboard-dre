import { NextResponse } from "next/server";

import { extError, withExtCtrl } from "@/lib/ext-api/handler";
import { safeFileName } from "@/lib/ext-api/requisicoes";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const BUCKET = "ctrl-attachments";

// Anexo em dois passos: aqui se reserva o caminho e se devolve uma URL de
// upload assinada; o hubfeat sobe o arquivo DIRETO no storage (PUT na URL) e
// depois manda o `path` na criação da requisição. Passar o arquivo por esta
// rota esbarraria no limite de 4,5 MB de corpo da Vercel — a tela aceita 10 MB.
// O path começa pelo id de quem age, a mesma regra do upload da tela.
export async function POST(request: Request) {
  return withExtCtrl(request, async ({ ctx }) => {
    const body = (await request.json().catch(() => null)) as { nome?: unknown } | null;
    if (!body || typeof body.nome !== "string" || !body.nome.trim()) {
      return extError(400, "Informe o nome do arquivo em `nome`.");
    }
    const path = `${ctx.id}/${Date.now()}-${safeFileName(body.nome)}`;
    const { data, error } = await createAdminClient().storage.from(BUCKET).createSignedUploadUrl(path);
    if (error || !data) return extError(500, error?.message ?? "Não foi possível preparar o upload.");
    return NextResponse.json(
      { path, uploadUrl: data.signedUrl, token: data.token, limiteBytes: 10 * 1024 * 1024 },
      { status: 201 },
    );
  });
}
