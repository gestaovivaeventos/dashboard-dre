import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { getOrcamentoAdmin } from "@/lib/orcamento/auth";
import { isValidBudgetYear } from "@/lib/orcamento/years";
import { parseCotacaoXlsx } from "@/lib/viagens/cotacao-xlsx";
import { lancarValoresViagens } from "@/lib/orcamento/actions/viagens-grade";

export const dynamic = "force-dynamic";

/**
 * Sobe a planilha de cotação: lança os valores de todas as viagens de uma vez.
 *
 * ── A regra é a MESMA da digitação na tela ───────────────────────────────
 * Esta rota só lê o arquivo e chama `lancarValoresViagens`, a mesma action do botão
 * da linha. Duplicar a validação aqui faria a planilha aceitar o que a tela recusa —
 * e seria a planilha, usada em lote, a que passaria o erro adiante.
 *
 * ── Falha por LINHA ──────────────────────────────────────────────────────
 * Linha sem ID, com ID repetido, com valor ilegível ou negativo volta descrita, com
 * o número da linha, e as outras entram. Uma célula escrita "a combinar" não pode
 * custar as 49 cotações que estão certas.
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

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Envie a planilha (.xlsx)." }, { status: 400 });
  }
  if (!companyId) {
    return NextResponse.json({ error: "Selecione uma empresa." }, { status: 400 });
  }
  if (!isValidBudgetYear(year)) {
    return NextResponse.json({ error: "Ano do orçamento inválido." }, { status: 400 });
  }

  let data: unknown[][];
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    // A primeira aba é a de cotação; a segunda é a ajuda, que não se lê.
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) return NextResponse.json({ error: "Planilha vazia." }, { status: 400 });
    data = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: true, defval: "" });
  } catch {
    return NextResponse.json({ error: "Não consegui ler o arquivo como .xlsx." }, { status: 400 });
  }

  const lido = parseCotacaoXlsx(data);
  if ("erro" in lido) return NextResponse.json({ error: lido.erro }, { status: 400 });
  const { rows, problemas } = lido.parse;

  if (rows.length === 0) {
    return NextResponse.json(
      { error: "Nenhuma linha aproveitável na planilha.", problemas },
      { status: 400 },
    );
  }

  const res = await lancarValoresViagens(
    companyId,
    year,
    rows.map((r) => ({
      id: r.id,
      valores: r.valores,
      dataBase: r.dataBase,
      observacao: r.observacao,
    })),
  );
  if (res.error) {
    return NextResponse.json({ error: res.error, problemas }, { status: 400 });
  }

  // O problema da LEITURA e a recusa da GRAVAÇÃO vão juntos: para quem subiu o
  // arquivo são a mesma pergunta ("o que não entrou, e por quê").
  const porLinha = new Map(rows.map((r) => [r.id, r.linha] as const));
  const recusas = res.recusadas.map((r) => {
    const linha = porLinha.get(r.id);
    return linha ? `Linha ${linha}: ${r.motivo}` : r.motivo;
  });

  return NextResponse.json({
    ok: true,
    lidas: rows.length,
    gravadas: res.gravadas,
    problemas: [...problemas, ...recusas],
  });
}
