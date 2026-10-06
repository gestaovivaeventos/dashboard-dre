import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { getOrcamentoAdmin } from "@/lib/orcamento/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { isValidBudgetYear } from "@/lib/orcamento/years";
import { numDaLinha as num, textoDaLinha as texto } from "@/lib/viagens/colunas";
import { GRUPO_LABEL } from "@/lib/viagens/custo/tipos";
import { GRUPOS_COTACAO, normalizarEstado, entraNaExportacao } from "@/lib/viagens/fluxo";

export const dynamic = "force-dynamic";

const MESES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

/**
 * O .xls que a Controladoria leva para cotar FORA (IA no cowork).
 *
 * ── Só as FECHADAS ────────────────────────────────────────────────────────
 * `entraNaExportacao` = `em_cotacao`. Se o arquivo saísse das que têm apenas o OK
 * do gestor, ele editaria depois e a cotação seria feita sobre um dado que mudou —
 * sem nada avisar. Fechar significa exatamente "estes são os dados que eu vou
 * cotar", e é por isso que fechar vem ANTES de baixar.
 *
 * ── A coluna ID é a chave, e a planilha diz isso ─────────────────────────
 * A volta casa por ID, nunca por destino + mês: duas idas a São Paulo em março
 * colidiriam, e casamento por nome já se queimou neste projeto. A coluna vai na
 * frente, com o aviso de não apagá-la.
 *
 * ── Os seis grupos vão VAZIOS ────────────────────────────────────────────
 * É o que a pessoa (ou a IA) preenche. Os grupos são os mesmos do sistema, porque é
 * por eles que a linha abre em árvore para o diretor e por eles que a Prévia soma.
 */
export async function GET(request: Request) {
  const admin = await getOrcamentoAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Acesso restrito a administradores." }, { status: 403 });
  }

  const url = new URL(request.url);
  const companyId = url.searchParams.get("companyId") ?? "";
  const year = Number(url.searchParams.get("year"));
  const setorId = url.searchParams.get("setorId");
  if (!companyId) return NextResponse.json({ error: "Selecione uma empresa." }, { status: 400 });
  if (!isValidBudgetYear(year)) {
    return NextResponse.json({ error: "Ano do orçamento inválido." }, { status: 400 });
  }

  const supabase = createAdminClientIfAvailable() ?? (await createClient());

  let q = supabase
    .from("orcamento_viagens")
    .select(
      "id, titulo, origem, mes_ida, pessoas, pessoas_por_quarto, volta_modal, finalidade, status, tipo_id, cot_passagem, cot_translado, cot_transporte_local, cot_hospedagem, cot_alimentacao, cot_outros, cotacao_data_base, cotacao_observacao",
    )
    .eq("company_id", companyId)
    .eq("year", year);
  if (setorId) q = q.eq("setor_id", setorId);
  const { data, error } = await q.order("mes_ida", { ascending: true, nullsFirst: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const fechadas = ((data ?? []) as Array<Record<string, unknown>>).filter((r) =>
    entraNaExportacao(normalizarEstado(r.status)),
  );
  if (fechadas.length === 0) {
    return NextResponse.json(
      {
        error:
          "Nenhuma viagem fechada para cotação. Feche as que estão aguardando cotação antes de baixar — é o que garante que o dado não muda enquanto você cota.",
      },
      { status: 400 },
    );
  }

  const ids = fechadas.map((r) => r.id as string);
  const paradas = new Map<string, { cidade: string; uf: string; noites: number }>();
  const { data: pRows } = await supabase
    .from("orcamento_viagem_paradas")
    .select("viagem_id, ordem, cidade, uf, noites")
    .in("viagem_id", ids)
    .order("ordem");
  for (const p of (pRows ?? []) as Array<Record<string, unknown>>) {
    const vid = p.viagem_id as string;
    if (paradas.has(vid)) continue;
    paradas.set(vid, {
      cidade: texto(p.cidade),
      uf: texto(p.uf),
      noites: num(p.noites) ?? 0,
    });
  }

  const { data: tipoRows } = await supabase
    .from("orcamento_viagem_tipos")
    .select("id, nome")
    .eq("company_id", companyId)
    .eq("year", year);
  const nomeDoTipo = new Map(
    ((tipoRows ?? []) as Array<Record<string, unknown>>).map(
      (t) => [t.id as string, texto(t.nome)] as const,
    ),
  );

  const cabecalho = [
    "ID (não apague)",
    "Origem",
    "Destino",
    "UF",
    "Mês",
    "Dias",
    "Pessoas",
    "Pessoas por quarto",
    "Quartos",
    "Modal",
    "Tipo",
    "Para que serve",
    ...GRUPOS_COTACAO.map((g) => GRUPO_LABEL[g]),
    "Data-base da cotação",
    "Fonte / observação",
  ];

  const linhas: unknown[][] = [cabecalho];
  for (const r of fechadas) {
    const p = paradas.get(r.id as string);
    const pessoas = num(r.pessoas) ?? 1;
    const porQuarto = num(r.pessoas_por_quarto) ?? 2;
    const mes = num(r.mes_ida);
    linhas.push([
      r.id as string,
      texto(r.origem),
      p?.cidade ?? texto(r.titulo),
      p?.uf ?? "",
      mes != null && mes >= 1 && mes <= 12 ? MESES[mes - 1] : "",
      p?.noites ?? 0,
      pessoas,
      porQuarto,
      Math.ceil(pessoas / Math.max(1, porQuarto)),
      texto(r.volta_modal),
      nomeDoTipo.get(texto(r.tipo_id)) ?? "",
      texto(r.finalidade),
      // Os valores já lançados voltam preenchidos: refazer uma cotação parcial não
      // deve obrigar a redigitar o que já estava certo.
      ...GRUPOS_COTACAO.map((g) => num(r[`cot_${g}`]) ?? ""),
      texto(r.cotacao_data_base),
      texto(r.cotacao_observacao),
    ]);
  }

  const ajuda: unknown[][] = [
    [`Cotação de viagens — orçamento de ${year}`],
    [],
    ["Preencha as colunas de valor (uma por grupo de despesa) e suba o arquivo de volta."],
    [],
    ["Coluna", "O que preencher"],
    [
      "ID (não apague)",
      "A chave que liga a linha à viagem no sistema. Apagar ou alterar faz a linha ser recusada na volta.",
    ],
    ["Mês / Dias / Pessoas / Quartos", "São os dados que o gestor informou. Não precisa mexer."],
    ...GRUPOS_COTACAO.map((g) => [
      GRUPO_LABEL[g],
      "Valor TOTAL deste grupo para a viagem inteira (todas as pessoas, todos os dias). Em branco = não cotado.",
    ]),
    [
      "Data-base da cotação",
      "O dia para o qual você cotou (AAAA-MM-DD). O gestor informa só o mês; esta data é o que permite reconstruir o número depois.",
    ],
    ["Fonte / observação", "De onde veio o preço: agência, site, telefone."],
    [],
    ["Em branco é diferente de zero: zero significa que não há esse custo na viagem."],
    ["Linha com valor negativo é recusada."],
    ["Só as viagens FECHADAS para cotação saem neste arquivo."],
  ];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(linhas);
  ws["!cols"] = [
    { wch: 38 },
    { wch: 16 },
    { wch: 20 },
    { wch: 5 },
    { wch: 11 },
    { wch: 6 },
    { wch: 8 },
    { wch: 17 },
    { wch: 8 },
    { wch: 9 },
    { wch: 18 },
    { wch: 30 },
    ...GRUPOS_COTACAO.map(() => ({ wch: 15 })),
    { wch: 20 },
    { wch: 26 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, "Cotação");
  const wsAjuda = XLSX.utils.aoa_to_sheet(ajuda);
  wsAjuda["!cols"] = [{ wch: 28 }, { wch: 96 }];
  XLSX.utils.book_append_sheet(wb, wsAjuda, "Como preencher");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="cotacao-viagens-${year}.xlsx"`,
    },
  });
}
