import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { getDpUser } from "@/lib/dp/auth";
import { getDpTabela, listDpCargosSolidesDaEmpresa } from "@/lib/dp/cargos-queries";
import { DpNaoInstaladoError } from "@/lib/dp/queries";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Modelo .xlsx da tabela salarial de UMA empresa (`Setor | Cargo | Step | Salário`).
 *
 * Vem PREENCHIDO: com a tabela atual, quando ela existe (baixar, ajustar e
 * reimportar é o caminho de quem prefere o Excel); senão, com os cargos que os
 * ativos da empresa têm na Sólides e o departamento como setor — falta só o
 * step e o salário. Copiar nome de cargo à mão é de onde vem o erro de
 * digitação que depois impede a sugestão do de-para de casar.
 */
export async function GET(request: Request) {
  const user = await getDpUser();
  if (!user) return NextResponse.json({ error: "Acesso negado." }, { status: 403 });

  const companyId = new URL(request.url).searchParams.get("companyId") ?? "";
  const db = createAdminClient();
  const { data: company } = await db.from("companies").select("id, name").eq("id", companyId).maybeSingle();
  if (!company) return NextResponse.json({ error: "Empresa não encontrada." }, { status: 400 });

  let linhas: (string | number)[][];
  try {
    const tabela = await getDpTabela(db, companyId);
    if (tabela.length > 0) {
      linhas = tabela.map((l) => [l.setor, l.cargo, l.step, l.salario]);
    } else {
      const cargos = await listDpCargosSolidesDaEmpresa(db, companyId);
      // "COMERCIAL - VIVA BH" → "COMERCIAL": o sufixo é a empresa, que a planilha já é.
      linhas = cargos.map((c) => [(c.departamento ?? "").replace(/\s+-\s+.*$/, "").trim(), c.cargo, "", ""]);
    }
  } catch (error) {
    if (error instanceof DpNaoInstaladoError) {
      return NextResponse.json({ error: "Tabela salarial ainda não instalada no banco (migration 20261002130000)." }, { status: 400 });
    }
    throw error;
  }

  const ws = XLSX.utils.aoa_to_sheet([["Setor", "Cargo", "Step", "Salário"], ...linhas]);
  ws["!cols"] = [{ wch: 26 }, { wch: 44 }, { wch: 16 }, { wch: 14 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Tabela salarial");
  const buffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" }) as Buffer;

  const nome = String(company.name).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]+/g, "-").toLowerCase();
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="tabela-salarial-${nome}.xlsx"`,
    },
  });
}
