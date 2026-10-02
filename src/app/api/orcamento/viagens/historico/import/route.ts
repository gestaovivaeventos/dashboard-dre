import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { getOrcamentoAdmin } from "@/lib/orcamento/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { isSchemaMissing } from "@/lib/orcamento/errors";
import { isValidBudgetYear } from "@/lib/orcamento/years";
import { parseHistoricoXlsx } from "@/lib/viagens/historico-xlsx";
import { referenciasPorDestino } from "@/lib/viagens/historico";

export const dynamic = "force-dynamic";

/**
 * Importa o histórico de viagens realizadas de um ano-base.
 *
 * ── SUBSTITUI o ano, não acrescenta ───────────────────────────────────────
 * Diferente das outras importações do módulo (grupos, cargos), que são aditivas.
 * O motivo é que aqui não existe chave para deduplicar: duas viagens a Recife em
 * maio com os mesmos números são dois FATOS distintos, e as duas devem contar na
 * mediana. Aditivo faria reimportar o mesmo arquivo dobrar o histórico em
 * silêncio — e dobrar observações não muda a mediana, mas mente na contagem que a
 * premissa mostra ("mediana de 8 viagens" quando foram 4).
 *
 * Substituir o ano é o que torna o reenvio idempotente, que é a propriedade que
 * importa: corrigir uma célula é corrigir a planilha e subir de novo.
 *
 * ── Falha POR LINHA, nunca pelo arquivo ──────────────────────────────────
 * Linha torta no meio de 200 não custa as 199 certas. As recusadas voltam com o
 * número da linha e o motivo.
 */
export async function POST(request: Request) {
  const admin = await getOrcamentoAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Acesso restrito a administradores." }, { status: 403 });
  }

  const form = await request.formData();
  const file = form.get("file");
  const companyId = String(form.get("companyId") ?? "");
  const year = Number(form.get("year"));
  const anoBase = Number(form.get("anoBase"));

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Envie a planilha (.xlsx)." }, { status: 400 });
  }
  if (!companyId) {
    return NextResponse.json({ error: "Selecione uma empresa." }, { status: 400 });
  }
  if (!isValidBudgetYear(year)) {
    return NextResponse.json({ error: "Ano do orçamento inválido." }, { status: 400 });
  }
  if (!Number.isInteger(anoBase) || anoBase < 2000 || anoBase > year) {
    return NextResponse.json(
      { error: "Informe o ano em que as viagens aconteceram (anterior ou igual ao do orçamento)." },
      { status: 400 },
    );
  }

  let data: unknown[][];
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) return NextResponse.json({ error: "Planilha vazia." }, { status: 400 });
    data = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: true, defval: "" });
  } catch {
    return NextResponse.json({ error: "Não consegui ler o arquivo como .xlsx." }, { status: 400 });
  }

  const lido = parseHistoricoXlsx(data);
  if ("erro" in lido) return NextResponse.json({ error: lido.erro }, { status: 400 });
  const { rows, problemas } = lido.parse;

  if (rows.length === 0) {
    return NextResponse.json(
      {
        error: "Nenhuma linha aproveitável na planilha.",
        problemas,
      },
      { status: 400 },
    );
  }

  const supabase = createAdminClientIfAvailable() ?? (await createClient());

  // Troca o ano inteiro. O delete vem antes do insert de propósito: se o insert
  // falhar, o ano fica vazio e a tela diz isso — melhor do que metade antiga e
  // metade nova, que ninguém consegue auditar depois.
  const { error: delErr } = await supabase
    .from("orcamento_viagem_historico")
    .delete()
    .eq("company_id", companyId)
    .eq("year", anoBase);
  if (delErr) {
    if (isSchemaMissing(delErr.message)) {
      return NextResponse.json(
        { error: "Falta aplicar a migration 20261002150000_orcamento_viagem_historico.sql." },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: delErr.message }, { status: 400 });
  }

  const { error: insErr } = await supabase.from("orcamento_viagem_historico").insert(
    rows.map((r) => ({
      company_id: companyId,
      year: anoBase,
      cidade: r.cidade,
      mes: r.mes,
      pessoas: r.pessoas,
      noites: r.noites,
      pessoas_por_quarto: r.pessoasPorQuarto,
      diarias: r.diarias,
      modal: r.modal,
      custo_passagem: r.custoPassagem,
      custo_hospedagem: r.custoHospedagem,
      custo_alimentacao: r.custoAlimentacao,
      custo_transporte_local: r.custoTransporteLocal,
      observacao: r.observacao,
      created_by: admin.userId,
    })),
  );
  if (insErr) {
    return NextResponse.json(
      { error: insErr.message, aviso: `O histórico de ${anoBase} ficou vazio — suba a planilha de novo.` },
      { status: 400 },
    );
  }

  // Quantos destinos de fato ganharam referência: é o número que diz se a
  // importação serviu. "200 linhas importadas" sem isso não responde nada.
  const refs = referenciasPorDestino(rows);
  const comPassagem = Array.from(refs.values()).filter((r) => r.passagemPorPessoa != null).length;
  const comDiaria = Array.from(refs.values()).filter((r) => r.diariaPorQuarto != null).length;

  return NextResponse.json({
    ok: true,
    anoBase,
    linhas: rows.length,
    destinos: refs.size,
    comPassagem,
    comDiaria,
    problemas,
  });
}
