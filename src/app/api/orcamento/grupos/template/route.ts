import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { getOrcamentoAdmin } from "@/lib/orcamento/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { isValidBudgetYear } from "@/lib/orcamento/years";
import { getCategoriaMetodo } from "@/lib/orcamento/actions/categoria-metodo";
import { orcaPorSetor } from "@/lib/orcamento/setor-gravacao";
import { compararNomes } from "@/lib/orcamento/grupos";

export const dynamic = "force-dynamic";

/**
 * Modelo .xlsx dos grupos de despesa, JÁ PREENCHIDO com os setores e as
 * categorias da empresa — só falta escrever o grupo em cada linha.
 *
 * Um modelo em branco obrigaria o admin a copiar nomes de setor e categoria à
 * mão, e é exatamente aí que nasce o erro de digitação que faz a linha não
 * casar na importação. Com a grade pronta, a coluna Grupo é a única a preencher.
 */
export async function GET(request: Request) {
  const admin = await getOrcamentoAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Acesso restrito a administradores." }, { status: 403 });
  }

  const url = new URL(request.url);
  const companyId = url.searchParams.get("companyId") ?? "";
  const year = Number(url.searchParams.get("year"));
  if (!companyId) {
    return NextResponse.json({ error: "Selecione uma empresa." }, { status: 400 });
  }
  if (!isValidBudgetYear(year)) {
    return NextResponse.json({ error: "Ano do orçamento inválido." }, { status: 400 });
  }

  const supabase = createAdminClientIfAvailable() ?? (await createClient());

  const cats = await getCategoriaMetodo(companyId, year);
  if (cats.error) return NextResponse.json({ error: cats.error }, { status: 400 });
  const categorias = (cats.items ?? [])
    .slice()
    .sort((a, b) => compararNomes(a.categoryName, b.categoryName));

  const porSetor = await orcaPorSetor(supabase, companyId, year);
  const { data: setoresRows } = porSetor
    ? await supabase
        .from("orcamento_setores")
        .select("name")
        .eq("company_id", companyId)
        .eq("year", year)
        .eq("active", true)
        .order("name")
    : { data: [] as { name: string }[] };
  const setores = (setoresRows ?? []).map((r) => r.name as string);

  // Escopos que já existem entram preenchidos: reimportar o arquivo não
  // desfaz nada (a importação é aditiva) e o admin vê o que já cadastrou.
  const { data: escopoRows } = await supabase
    .from("orcamento_grupo_escopo")
    .select("category_code, setor_id, orcamento_grupos_despesa(name), orcamento_setores(name)")
    .eq("company_id", companyId)
    .eq("year", year);
  const jaCadastrados = new Map<string, string[]>();
  ((escopoRows ?? []) as Array<Record<string, unknown>>).forEach((r) => {
    const grupo = (r.orcamento_grupos_despesa as { name?: string } | null)?.name;
    if (!grupo) return;
    const setorNome = (r.orcamento_setores as { name?: string } | null)?.name ?? "";
    const chave = `${setorNome}|${r.category_code as string}`;
    const lista = jaCadastrados.get(chave) ?? [];
    lista.push(grupo);
    jaCadastrados.set(chave, lista);
  });

  const linhas: (string | number)[][] = [["Setor", "Categoria", "Grupo"]];
  const nosSetores = setores.length > 0 ? setores : [""];
  nosSetores.forEach((setorNome) => {
    categorias.forEach((c) => {
      const grupos = jaCadastrados.get(`${setorNome}|${c.categoryCode}`) ?? [""];
      grupos.forEach((g) => linhas.push([setorNome, c.categoryName, g]));
    });
  });

  const ws = XLSX.utils.aoa_to_sheet(linhas);
  ws["!cols"] = [{ wch: 28 }, { wch: 42 }, { wch: 28 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Grupos");

  // Uma segunda aba com o CÓDIGO de cada categoria: a importação casa por nome
  // ou por código, e o código é o caminho seguro quando o nome muda na Omie.
  const wsRef = XLSX.utils.aoa_to_sheet([
    ["Categoria", "Código", "Método de orçamento"],
    ...categorias.map((c) => [c.categoryName, c.categoryCode, c.metodo ?? "sem método"]),
  ]);
  wsRef["!cols"] = [{ wch: 42 }, { wch: 16 }, { wch: 26 }];
  XLSX.utils.book_append_sheet(wb, wsRef, "Categorias");

  const buffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" }) as Buffer;
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="grupos-de-despesa-${year}.xlsx"`,
    },
  });
}
