import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { getOrcamentoAdmin } from "@/lib/orcamento/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { isValidBudgetYear } from "@/lib/orcamento/years";

export const dynamic = "force-dynamic";

/**
 * Modelo .xlsx do histórico de viagens, JÁ COM OS DESTINOS que a empresa orça.
 *
 * Modelo em branco obrigaria a digitar nome de cidade à mão, e é daí que vem o
 * erro de grafia que faz o destino não casar com a linha da grade — o histórico
 * de "Floripa" não serviria a uma viagem para "Florianópolis". Com as cidades já
 * escritas, o que falta é preencher o que foi pago.
 *
 * A segunda aba explica cada coluna, porque duas delas têm pegadinha: PASSAGEM é o
 * total pago (ida e volta, todas as pessoas) e PESSOAS é obrigatório.
 */
export async function GET(request: Request) {
  const admin = await getOrcamentoAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Acesso restrito a administradores." }, { status: 403 });
  }

  const url = new URL(request.url);
  const companyId = url.searchParams.get("companyId") ?? "";
  const year = Number(url.searchParams.get("year"));
  const anoBase = Number(url.searchParams.get("anoBase")) || year - 1;
  if (!companyId) {
    return NextResponse.json({ error: "Selecione uma empresa." }, { status: 400 });
  }
  if (!isValidBudgetYear(year)) {
    return NextResponse.json({ error: "Ano do orçamento inválido." }, { status: 400 });
  }

  const supabase = createAdminClientIfAvailable() ?? (await createClient());

  // As cidades que a empresa já usou em viagens orçadas (de qualquer ano) e as que
  // já estão no histórico: é a lista de quem interessa cotar.
  const cidades = new Set<string>();
  const { data: paradas } = await supabase
    .from("orcamento_viagem_paradas")
    .select("cidade, orcamento_viagens!inner(company_id)")
    .eq("orcamento_viagens.company_id", companyId)
    .limit(500);
  for (const p of (paradas ?? []) as Array<Record<string, unknown>>) {
    const c = String(p.cidade ?? "").trim();
    if (c) cidades.add(c);
  }
  const { data: hist } = await supabase
    .from("orcamento_viagem_historico")
    .select("cidade")
    .eq("company_id", companyId)
    .limit(1000);
  for (const h of (hist ?? []) as Array<Record<string, unknown>>) {
    const c = String(h.cidade ?? "").trim();
    if (c) cidades.add(c);
  }

  const cabecalho = [
    "Cidade",
    "Mês",
    "Pessoas",
    "Noites",
    "Pessoas por quarto",
    "Modal",
    "Passagem",
    "Hospedagem",
    "Alimentação",
    "Observação",
  ];

  const ordenadas = Array.from(cidades).sort((a, b) => a.localeCompare(b, "pt-BR"));
  const linhas: unknown[][] = [cabecalho];
  for (const cidade of ordenadas) {
    linhas.push([cidade, "", "", "", "", "", "", "", "", ""]);
  }
  // Sem destino nenhum ainda: três linhas em branco, para a planilha não chegar
  // com só o cabeçalho e parecer quebrada.
  if (ordenadas.length === 0) {
    for (let i = 0; i < 3; i += 1) linhas.push(["", "", "", "", "", "", "", "", "", ""]);
  }

  const ajuda: unknown[][] = [
    [`Histórico de viagens realizadas — ano-base ${anoBase}`],
    [],
    ["Uma linha por VIAGEM que aconteceu. Repita a cidade quantas vezes for preciso:"],
    ["duas idas ao mesmo destino são duas linhas, e as duas contam (o sistema usa a mediana)."],
    [],
    ["Coluna", "O que preencher"],
    ["Cidade", "Destino da viagem. Obrigatório."],
    ["Mês", "1 a 12, ou o nome do mês. Serve para a premissa dizer de quando é o número."],
    [
      "Pessoas",
      "Quantas pessoas viajaram. OBRIGATÓRIO — é o que transforma o gasto em custo por pessoa.",
    ],
    ["Noites", "Noites fora. 0 em bate-volta."],
    ["Pessoas por quarto", "1 = cada um no seu quarto. Em branco assume 2. Muda a diária em até 2x."],
    ["Modal", "Avião, Ônibus, Carro ou Van. Carro e van não viram preço de passagem (lá vale o R$/km)."],
    [
      "Passagem",
      "TOTAL PAGO de passagem na viagem: ida e volta, todas as pessoas. O sistema divide.",
    ],
    ["Hospedagem", "Total pago de hotel na viagem (todas as noites, todos os quartos)."],
    ["Alimentação", "Total pago de alimentação na viagem (todas as pessoas, todos os dias)."],
    ["Observação", "Opcional. Ex.: 'congresso', 'compra de última hora'."],
    [],
    ["Em branco = não informado, que é diferente de zero. Deixe em branco o que não souber."],
    ["Subir a planilha SUBSTITUI o histórico deste ano-base inteiro."],
  ];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(linhas);
  ws["!cols"] = [
    { wch: 24 },
    { wch: 8 },
    { wch: 9 },
    { wch: 8 },
    { wch: 18 },
    { wch: 10 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 28 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, "Viagens");
  const wsAjuda = XLSX.utils.aoa_to_sheet(ajuda);
  wsAjuda["!cols"] = [{ wch: 22 }, { wch: 92 }];
  XLSX.utils.book_append_sheet(wb, wsAjuda, "Como preencher");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="historico-viagens-${anoBase}.xlsx"`,
    },
  });
}
