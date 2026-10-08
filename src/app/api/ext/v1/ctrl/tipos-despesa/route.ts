import { NextResponse } from "next/server";

import { getExpenseTypes } from "@/lib/ctrl/actions/expense-types";
import { extError, withExtCtrl } from "@/lib/ext-api/handler";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withExtCtrl(request, async () => {
    const result = await getExpenseTypes();
    if ("error" in result) return extError(400, result.error ?? "Erro ao listar tipos de despesa.");
    return NextResponse.json({
      tiposDespesa: result.expenseTypes.map((t) => ({ id: t.id, nome: t.name })),
    });
  });
}
