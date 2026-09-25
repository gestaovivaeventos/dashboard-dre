import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { getOrcamentoAdmin } from "@/lib/orcamento/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { isValidBudgetYear } from "@/lib/orcamento/years";
import { getCategoriaMetodo } from "@/lib/orcamento/actions/categoria-metodo";
import { normalizarNomeGrupo } from "@/lib/orcamento/grupos";
import {
  normalizarChave,
  parseGruposXlsx,
  resolverGrupos,
  type GrupoResolvido,
} from "@/lib/orcamento/grupos-xlsx";

export const dynamic = "force-dynamic";

/**
 * Importa os grupos de despesa de uma planilha (Setor | Categoria | Grupo).
 *
 * Semântica: **ADITIVA e idempotente**. O que a planilha traz é cadastrado; o
 * que existe no banco e não está nela NÃO é apagado — remover é ato explícito,
 * feito na árvore. Reimportar o mesmo arquivo não duplica nada (a chave única
 * do escopo absorve) nem produz erro.
 *
 * Falha por LINHA, não pelo arquivo: setor escrito errado no meio de 200 linhas
 * não pode impedir as 199 corretas de entrar. As recusadas voltam descritas,
 * com o número da linha.
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

  // ── Leitura da planilha ───────────────────────────────────────────────────
  let data: unknown[][];
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) return NextResponse.json({ error: "Planilha vazia." }, { status: 400 });
    data = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: true, defval: "" });
  } catch {
    return NextResponse.json({ error: "Não consegui ler o arquivo. Ele é um .xlsx?" }, { status: 400 });
  }

  const lido = parseGruposXlsx(data);
  if ("erro" in lido) return NextResponse.json({ error: lido.erro }, { status: 400 });

  // ── Cadastro para casar ───────────────────────────────────────────────────
  const supabase = createAdminClientIfAvailable() ?? (await createClient());

  const cats = await getCategoriaMetodo(companyId, year);
  if (cats.error) return NextResponse.json({ error: cats.error }, { status: 400 });

  const { data: setoresRows } = await supabase
    .from("orcamento_setores")
    .select("id, name")
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("active", true);

  const resolucao = resolverGrupos(
    lido.parse.rows,
    (setoresRows ?? []).map((r) => ({ id: r.id as string, name: r.name as string })),
    cats.items ?? [],
  );
  const problemas = [...lido.parse.problemas, ...resolucao.problemas];

  if (resolucao.resolvidas.length === 0) {
    return NextResponse.json({
      criados: 0,
      escopos: 0,
      problemas,
      aviso: "Nenhuma linha da planilha pôde ser aproveitada.",
    });
  }

  // ── Catálogo: reaproveita o nome que já existe, cria o que falta ─────────
  // Reaproveitar é o que mantém o grupo ÚNICO quando ele vale em vários
  // setores — a Prévia agrupa por id, e dois ids homônimos virariam dois
  // subníveis em vez de compilar.
  const { data: catalogoRows } = await supabase
    .from("orcamento_grupos_despesa")
    .select("id, name")
    .eq("company_id", companyId);
  const porNome = new Map(
    (catalogoRows ?? []).map((r) => [normalizarChave(r.name as string), r.id as string]),
  );

  const nomesNovos = new Map<string, string>();
  resolucao.resolvidas.forEach((r) => {
    const nome = normalizarNomeGrupo(r.grupo);
    const chave = normalizarChave(nome);
    if (!porNome.has(chave) && !nomesNovos.has(chave)) nomesNovos.set(chave, nome);
  });

  let criados = 0;
  if (nomesNovos.size > 0) {
    const { data: inseridos, error } = await supabase
      .from("orcamento_grupos_despesa")
      .insert(
        Array.from(nomesNovos.values()).map((name) => ({
          company_id: companyId,
          name,
          updated_by: admin.userId,
        })),
      )
      .select("id, name");
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    (inseridos ?? []).forEach((r) => porNome.set(normalizarChave(r.name as string), r.id as string));
    criados = inseridos?.length ?? 0;
  }

  // ── Escopos ───────────────────────────────────────────────────────────────
  const linhas = resolucao.resolvidas
    .map((r: GrupoResolvido) => {
      const grupoId = porNome.get(normalizarChave(normalizarNomeGrupo(r.grupo)));
      if (!grupoId) return null;
      return {
        grupo_id: grupoId,
        company_id: companyId,
        year,
        setor_id: r.setorId,
        category_code: r.categoryCode,
        updated_by: admin.userId,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  // `ignoreDuplicates` é o que torna reimportar seguro: o escopo que já existe
  // é ignorado em vez de estourar 23505 e derrubar o lote inteiro.
  const { error: escErr } = await supabase
    .from("orcamento_grupo_escopo")
    .upsert(linhas, { ignoreDuplicates: true });
  if (escErr) return NextResponse.json({ error: escErr.message }, { status: 400 });

  return NextResponse.json({
    criados,
    escopos: linhas.length,
    problemas,
  });
}
