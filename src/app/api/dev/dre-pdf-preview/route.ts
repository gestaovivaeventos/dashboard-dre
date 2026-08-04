import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { buildDreGerencialPdf, type DreGerencialInput } from "@/lib/pdf/dre-gerencial";
import { buildSampleRows, MESES } from "@/lib/pdf/dre-gerencial-sample";

// Preview visual do template do PDF do DRE Gerencial com os dados de exemplo
// do layout aprovado (unidade Village, Jan a Jun/2026). Abra logado:
//   GET /api/dev/dre-pdf-preview
// Rota de conferência apenas — a exportação real é POST /api/export/dre/pdf.

export const maxDuration = 60;

export async function GET() {
  const { user } = await getCurrentSessionContext();
  if (!user) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }

  const { rows, formulas } = buildSampleRows();
  const input: DreGerencialInput = {
    unidade: "Village",
    segmento: "Real Estate",
    periodo: "Jan/2026 a Jun/2026",
    geradoEm: "04/08/2026 09:57",
    geradoPor: "diretoria@controlhub.com.br",
    meses: MESES,
    rows,
  };

  const pdf = await buildDreGerencialPdf(input, formulas);
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'inline; filename="DRE_Gerencial_preview.pdf"',
    },
  });
}
