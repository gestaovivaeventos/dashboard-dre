import { NextResponse } from "next/server";

import {
  getApprovalHistory,
  getComplementThread,
  getPaymentInfoThread,
  getRequestAttachmentUrl,
  getRequestComprovantes,
  getRequestExtraAttachments,
} from "@/lib/ctrl/actions/requests";
import { extError, withExtCtrl } from "@/lib/ext-api/handler";
import { getOwnRequest } from "@/lib/ext-api/requisicoes-db";

export const dynamic = "force-dynamic";

function ok<T, K extends string>(r: ({ [P in K]?: T } & { error?: string }) | { error: string }, key: K): T | null {
  return "error" in r && r.error ? null : ((r as Record<K, T>)[key] ?? null);
}

// Detalhe para o solicitante. A posse é conferida ANTES de chamar as actions
// (getOwnRequest recorta por empresa + criador): algumas delas confiam só no
// papel e dariam a requisição de outra pessoa a um gerente.
export async function GET(request: Request, { params }: { params: { id: string } }) {
  return withExtCtrl(request, async ({ ctx }) => {
    const requisicao = await getOwnRequest(ctx, params.id);
    if (!requisicao) return extError(404, "Requisição não encontrada.");

    const [historico, complemento, infoPagamento, anexo, extras, comprovantes] = await Promise.all([
      getApprovalHistory(params.id),
      getComplementThread(params.id),
      getPaymentInfoThread(params.id),
      getRequestAttachmentUrl(params.id),
      getRequestExtraAttachments(params.id),
      getRequestComprovantes(params.id),
    ]);

    return NextResponse.json({
      requisicao,
      historico: ok(historico, "entries") ?? [],
      conversaComplemento: ok(complemento, "messages") ?? [],
      conversaInfoPagamento: ok(infoPagamento, "messages") ?? [],
      anexos: {
        principal: ok(anexo, "url"),
        extras: ok(extras, "attachments") ?? [],
        comprovantes: ok(comprovantes, "comprovantes") ?? [],
        validadeUrlMinutos: 5,
      },
    });
  });
}
