import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getVbUser } from "@/lib/vb/auth";
import { parseVbWorkbook, type ParsedWorkbook } from "@/lib/vb/import/parse-vb-workbook";
import { toEntryRows } from "@/lib/vb/import/to-rows";
import type { VbImportSummary } from "@/lib/vb/types";

const MAX_BYTES = 5 * 1024 * 1024;
const INSERT_CHUNK = 500;

/** Todas as abas da planilha já tinham credor aprovado — nada a importar. */
class AlreadyImportedError extends Error {
  constructor() {
    super("ja_importado");
  }
}

/**
 * POST multipart { file } → cria um lote PENDENTE com os lançamentos da
 * planilha. Nada vira oficial aqui: a aprovação é o server action
 * approveImportBatch, depois da revisão na tela.
 */
export async function POST(request: Request) {
  const user = await getVbUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (user.role !== "gestor") return NextResponse.json({ error: "Sem permissão." }, { status: 403 });

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Envie um arquivo .xlsx." }, { status: 400 });
  }
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    return NextResponse.json({ error: "O arquivo precisa ser .xlsx." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Arquivo acima de 5 MB." }, { status: 400 });
  }

  let parsed: ParsedWorkbook;
  try {
    parsed = parseVbWorkbook(new Uint8Array(await file.arrayBuffer()));
  } catch {
    return NextResponse.json(
      { error: "Arquivo inválido: não foi possível ler a planilha." },
      { status: 400 },
    );
  }
  if (parsed.creditors.length === 0) {
    return NextResponse.json(
      {
        error:
          "Nenhuma aba de credor reconhecida (cabeçalho DATA | DATA | DIAS | DESCRIÇÃO | ENTRADA | SAÍDA | RENDIMENTO | SALDO na linha 4).",
      },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  const { data: pending, error: pendingError } = await admin
    .from("vb_import_batches")
    .select("id")
    .eq("status", "pendente")
    .maybeSingle();
  if (pendingError) {
    return NextResponse.json({ error: pendingError.message }, { status: 500 });
  }
  if (pending) {
    return NextResponse.json(
      { error: "Já existe um lote pendente de revisão. Aprove ou descarte-o antes de importar outro." },
      { status: 409 },
    );
  }

  const { data: existingRows, error: existingError } = await admin
    .from("vb_creditors")
    .select("id, source_sheet");
  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 });
  }
  const existingBySheet = new Map<string, { id: string }>();
  for (const row of existingRows ?? []) {
    if (row.source_sheet) existingBySheet.set(String(row.source_sheet).toLowerCase(), { id: row.id as string });
  }

  const { data: batch, error: batchError } = await admin
    .from("vb_import_batches")
    .insert({ file_name: file.name, status: "pendente", created_by: user.id, summary: {} })
    .select("id")
    .single();
  if (batchError || !batch) {
    // 23505 = índice único do "um pendente por vez" (corrida entre dois uploads).
    const conflict = batchError?.code === "23505";
    return NextResponse.json(
      { error: conflict ? "Já existe um lote pendente de revisão." : batchError?.message ?? "Falha ao criar o lote." },
      { status: conflict ? 409 : 500 },
    );
  }
  const batchId = batch.id as string;

  const summary: VbImportSummary = {
    creditors: [],
    skippedSheets: [],
    emptySheets: parsed.emptySheets,
    ignoredSheets: parsed.ignoredSheets,
    createdCreditorIds: [],
  };
  const createdCreditorIds: string[] = [];

  try {
    for (let index = 0; index < parsed.creditors.length; index++) {
      const creditor = parsed.creditors[index];
      const existing = existingBySheet.get(creditor.sheetName.toLowerCase());
      let creditorId: string;
      if (existing) {
        // Credor já aprovado não é reimportado — duplicaria o histórico.
        const { count, error } = await admin
          .from("vb_entries")
          .select("id", { count: "exact", head: true })
          .eq("creditor_id", existing.id)
          .eq("status", "aprovado");
        if (error) throw new Error(error.message);
        if ((count ?? 0) > 0) {
          summary.skippedSheets.push({ sheetName: creditor.sheetName, reason: "ja_importado" });
          continue;
        }
        creditorId = existing.id;
      } else {
        const { data: created, error } = await admin
          .from("vb_creditors")
          .insert({
            name: creditor.name,
            active: !creditor.hidden,
            source_sheet: creditor.sheetName,
            sort_order: index,
          })
          .select("id")
          .single();
        if (error || !created) throw new Error(error?.message ?? "Falha ao criar credor.");
        creditorId = created.id as string;
        createdCreditorIds.push(creditorId);
      }

      const rows = toEntryRows(creditor, { creditorId, batchId, userId: user.id });
      for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
        const { error } = await admin.from("vb_entries").insert(rows.slice(i, i + INSERT_CHUNK));
        if (error) throw new Error(error.message);
      }

      summary.creditors.push({
        creditorId,
        sheetName: creditor.sheetName,
        name: creditor.name,
        hidden: creditor.hidden,
        entries: creditor.entries.length,
        skippedRows: creditor.skippedRows.length,
        sheetFinalBalance: creditor.sheetFinalBalance,
        computedFinalBalance: creditor.computedFinalBalance,
        diff: creditor.diff,
        blockingCount: creditor.blockingCount,
        warningCount: creditor.warningCount,
      });
    }

    if (summary.creditors.length === 0) {
      throw new AlreadyImportedError();
    }

    summary.createdCreditorIds = createdCreditorIds;
    const { error: summaryError } = await admin
      .from("vb_import_batches")
      .update({ summary })
      .eq("id", batchId);
    if (summaryError) throw new Error(summaryError.message);
  } catch (err) {
    // Desfaz o que este lote criou (o lote só existe de verdade depois daqui).
    // Cada passo checa o erro: uma limpeza que falha em silêncio deixaria um
    // lote 'pendente' vazio bloqueando toda importação futura.
    const cleanupErrors: string[] = [];
    const { error: entriesError } = await admin
      .from("vb_entries")
      .delete()
      .eq("import_batch_id", batchId);
    if (entriesError) cleanupErrors.push(`lançamentos: ${entriesError.message}`);
    if (createdCreditorIds.length > 0) {
      const { error: creditorsError } = await admin
        .from("vb_creditors")
        .delete()
        .in("id", createdCreditorIds);
      if (creditorsError) cleanupErrors.push(`credores: ${creditorsError.message}`);
    }
    const { error: batchDeleteError } = await admin
      .from("vb_import_batches")
      .delete()
      .eq("id", batchId);
    if (batchDeleteError) cleanupErrors.push(`lote: ${batchDeleteError.message}`);
    if (cleanupErrors.length > 0) {
      console.error("[vb/import] limpeza incompleta do lote", batchId, cleanupErrors);
    }
    const suffix =
      cleanupErrors.length > 0
        ? ` Limpeza incompleta (${cleanupErrors.join("; ")}) — descarte o lote pendente na tela de importação antes de tentar de novo.`
        : "";
    if (err instanceof AlreadyImportedError) {
      return NextResponse.json(
        { error: `Todos os credores da planilha já foram importados e aprovados.${suffix}` },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: `${err instanceof Error ? err.message : "Falha ao importar."}${suffix}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ batchId, summary });
}
