import { NextResponse } from "next/server";

import { getCtrlUser } from "@/lib/ctrl/auth";
import { MANUAL_DOC_FILENAME, renderManualWordHtml } from "@/lib/ctrl/manual/word";

/**
 * Download do Manual do módulo Compras em Word (.doc).
 *
 * Mesmo conteúdo da tela /ctrl/manual — os dois leem @/lib/ctrl/manual/content.
 * Liberado para qualquer usuário com acesso ao módulo Compras (mesma régua da
 * tela), porque o manual é justamente o material de entrada de quem chega.
 */
export async function GET() {
  const ctx = await getCtrlUser();
  if (!ctx) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  const html = renderManualWordHtml();

  return new NextResponse(html, {
    headers: {
      "Content-Type": "application/msword; charset=utf-8",
      "Content-Disposition": `attachment; filename="${MANUAL_DOC_FILENAME}"`,
      "Cache-Control": "no-store",
    },
  });
}
