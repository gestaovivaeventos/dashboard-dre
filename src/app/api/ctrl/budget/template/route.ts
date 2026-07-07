import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { getCtrlUser, hasCtrlRole } from "@/lib/ctrl/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";

const MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

export async function GET(request: Request) {
  const ctx = await getCtrlUser();
  if (!ctx) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!hasCtrlRole(ctx, "csc", "admin")) {
    return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  }

  const year = Number(new URL(request.url).searchParams.get("year")) || new Date().getFullYear();

  const db = createAdminClientIfAvailable() ?? (await createClient());
  const [sectorsRes, typesRes] = await Promise.all([
    db.from("ctrl_sectors").select("name").order("name"),
    db.from("ctrl_expense_types").select("name").eq("active", true).order("name"),
  ]);
  const sectors = (sectorsRes.data ?? []).map((s) => s.name);
  const types = (typesRes.data ?? []).map((t) => t.name);

  const wb = XLSX.utils.book_new();

  // Sheet 1: empty grid the user fills in.
  const budgetSheet = XLSX.utils.aoa_to_sheet([["Setor", "Tipo de Despesa", ...MONTHS]]);
  budgetSheet["!cols"] = [{ wch: 28 }, { wch: 32 }, ...MONTHS.map(() => ({ wch: 12 }))];
  XLSX.utils.book_append_sheet(wb, budgetSheet, `Orçamento ${year}`);

  // Sheet 2: valid names for copy/paste — avoids typos that block the upload.
  const refRows: (string | null)[][] = [["Setores válidos", "Tipos de despesa válidos"]];
  const maxLen = Math.max(sectors.length, types.length);
  for (let i = 0; i < maxLen; i += 1) {
    refRows.push([sectors[i] ?? null, types[i] ?? null]);
  }
  const refSheet = XLSX.utils.aoa_to_sheet(refRows);
  refSheet["!cols"] = [{ wch: 32 }, { wch: 36 }];
  XLSX.utils.book_append_sheet(wb, refSheet, "Listas válidas");

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="orcamento-modelo-${year}.xlsx"`,
    },
  });
}
