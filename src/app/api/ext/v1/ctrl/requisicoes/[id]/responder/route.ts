import { NextResponse } from "next/server";

import { answerComplement, answerPaymentInfo } from "@/lib/ctrl/actions/requests";
import { extError, withExtCtrl } from "@/lib/ext-api/handler";
import { getOwnRequest } from "@/lib/ext-api/requisicoes-db";

export const dynamic = "force-dynamic";

// Resposta do solicitante a um pedido de complemento (aprovador) ou de
// informação de pagamento (contas a pagar). A rota decide qual pelo estado da
// requisição — o hubfeat só manda o texto. A posse é conferida aqui: as duas
// actions não checam quem responde.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  return withExtCtrl(request, async ({ ctx }) => {
    const body = (await request.json().catch(() => null)) as { resposta?: unknown } | null;
    if (!body || typeof body.resposta !== "string" || !body.resposta.trim()) {
      return extError(400, "Informe a resposta em `resposta`.");
    }
    const requisicao = await getOwnRequest(ctx, params.id);
    if (!requisicao) return extError(404, "Requisição não encontrada.");

    const result =
      requisicao.respostaPendente === "complemento"
        ? await answerComplement(params.id, body.resposta)
        : requisicao.respostaPendente === "info_pagamento"
          ? await answerPaymentInfo(params.id, body.resposta)
          : { error: "Esta requisição não está aguardando resposta." };
    if ("error" in result && result.error) return extError(400, result.error);

    return NextResponse.json({ requisicao: await getOwnRequest(ctx, params.id) });
  });
}
