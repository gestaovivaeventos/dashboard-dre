import { NextResponse } from "next/server";

import { createRequest } from "@/lib/ctrl/actions/requests";
import { extError, withExtCtrl } from "@/lib/ext-api/handler";
import { withIdempotency } from "@/lib/ext-api/idempotency";
import { parseCreateRequest, type Etapa } from "@/lib/ext-api/requisicoes";
import { getOwnRequest, listOwnRequests } from "@/lib/ext-api/requisicoes-db";

export const dynamic = "force-dynamic";

// Requisições criadas por quem age, na empresa da chave. `?etapa=` filtra.
export async function GET(request: Request) {
  return withExtCtrl(request, async ({ ctx }) => {
    const etapa = new URL(request.url).searchParams.get("etapa") as Etapa | null;
    const all = await listOwnRequests(ctx);
    return NextResponse.json({ requisicoes: etapa ? all.filter((r) => r.etapa === etapa) : all });
  });
}

export async function POST(request: Request) {
  return withExtCtrl(request, async ({ client, ctx }) => {
    const body = await request.json().catch(() => null);
    const parsed = parseCreateRequest(body, ctx);
    if (!parsed.ok) return extError(400, parsed.error);

    return withIdempotency(request, client.id, ctx.id, body, async () => {
      const result = await createRequest(parsed.input);
      if ("error" in result && result.error) return extError(400, result.error);
      if (!("requestId" in result) || !result.requestId) {
        return extError(500, "A requisição não foi criada.");
      }
      const requisicao = await getOwnRequest(ctx, result.requestId);
      return NextResponse.json(
        {
          requisicao,
          // Parcelas e recorrência criam várias linhas; esta é a primeira.
          totalCriadas: result.totalCreated,
          verificacaoOrcamento: result.verification ?? null,
        },
        { status: 201 },
      );
    });
  });
}
