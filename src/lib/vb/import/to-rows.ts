// Converte o resultado do parser nas linhas de vb_entries. Separado do route
// handler para ser testável sem banco.

import type { ParsedCreditor } from "@/lib/vb/import/parse-vb-workbook";
import type { VbEntry } from "@/lib/vb/types";

export type VbEntryInsert = Omit<VbEntry, "id" | "created_at" | "updated_at">;

export function toEntryRows(
  creditor: ParsedCreditor,
  ctx: { creditorId: string; batchId: string; userId: string },
): VbEntryInsert[] {
  return creditor.entries.map((e) => ({
    creditor_id: ctx.creditorId,
    entry_date: e.entryDate,
    kind: e.kind,
    amount: e.amount,
    description: e.description,
    period_start: e.periodStart,
    period_end: e.periodEnd,
    days: e.days,
    rate: e.rate,
    rate_basis: e.rateBasis,
    status: "pendente",
    import_batch_id: ctx.batchId,
    source_row: e.sourceRow,
    sheet_balance: e.sheetBalance,
    sort_order: e.sortOrder,
    flags: e.flags,
    created_by: ctx.userId,
  }));
}
