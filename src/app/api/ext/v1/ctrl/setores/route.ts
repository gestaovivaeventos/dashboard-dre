import { NextResponse } from "next/server";

import { getSectors } from "@/lib/ctrl/actions/sectors";
import { extError, withExtCtrl } from "@/lib/ext-api/handler";

export const dynamic = "force-dynamic";

// Setores em que o usuário pode abrir requisição (os vinculados a ele na Feat).
export async function GET(request: Request) {
  return withExtCtrl(request, async () => {
    const result = await getSectors();
    if ("error" in result) return extError(400, result.error ?? "Erro ao listar setores.");
    return NextResponse.json({
      setores: result.sectors.map((s) => ({ id: s.id, nome: s.name })),
    });
  });
}
