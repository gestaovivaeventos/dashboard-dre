import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { getOrcamentoAdmin } from "@/lib/orcamento/auth";

export const dynamic = "force-dynamic";

/** Modelo .xlsx do Plano de Cargos, com as 5 colunas e linhas de exemplo. */
export async function GET() {
  const admin = await getOrcamentoAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Acesso restrito a administradores." }, { status: 403 });
  }

  const linhas = [
    ["Empresa", "Setor", "Cargo", "Nível", "Salário base"],
    ["Viva Eventos", "Comercial", "Analista Comercial", "Júnior", 3000],
    ["Viva Eventos", "Comercial", "Analista Comercial", "Pleno", 4500],
    ["Viva Eventos", "Comercial", "Analista Comercial", "Sênior", 6000],
    ["Viva Eventos", "Financeiro", "Analista Financeiro", "Pleno", 4200],
  ];

  const sheet = XLSX.utils.aoa_to_sheet(linhas);
  sheet["!cols"] = [{ wch: 26 }, { wch: 20 }, { wch: 28 }, { wch: 14 }, { wch: 14 }];

  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Plano de Cargos");
  const buffer = XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="modelo-plano-de-cargos.xlsx"',
    },
  });
}
