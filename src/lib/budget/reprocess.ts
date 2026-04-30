import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Re-applies the company's label -> DRE account mapping to the raw budget
 * uploads, refreshing budget_entries for the years touched.
 *
 * Strategy: for each (year, month, dre_account_id) that has at least one
 * mapped raw row, sum the amounts of all raw rows with mappings and upsert
 * into budget_entries. Years without raw uploads are left untouched.
 *
 * Returns counters for telemetry / UI feedback.
 */
export async function reprocessBudgetEntriesForCompany(
  db: SupabaseClient,
  companyId: string,
  options: { years?: number[] } = {},
): Promise<{
  imported: number;
  unmappedLabels: string[];
}> {
  // Load mappings for this company (only labels with a non-null dre_account_id)
  const { data: mappingRows, error: mappingErr } = await db
    .from("budget_account_mappings")
    .select("label,dre_account_id")
    .eq("company_id", companyId);
  if (mappingErr) throw new Error(`Falha ao carregar mapeamentos: ${mappingErr.message}`);

  const labelToAccount = new Map<string, string>();
  (mappingRows ?? []).forEach((row) => {
    const accountId = row.dre_account_id as string | null;
    if (accountId) {
      labelToAccount.set(row.label as string, accountId);
    }
  });

  // Sign handling moved to the DRE engine (buildDashboardRows): we preserve
  // whatever sign the spreadsheet had, and the formula evaluator + summary
  // aggregator use the magnitude of leaf accounts so the formula's "-" never
  // doubles up with a "-" already in the value.

  // Load raw uploads (optionally restricted to specific years)
  let rawQuery = db
    .from("budget_uploads_raw")
    .select("year,month,label,amount")
    .eq("company_id", companyId);
  if (options.years && options.years.length > 0) {
    rawQuery = rawQuery.in("year", options.years);
  }
  const { data: rawRows, error: rawErr } = await rawQuery;
  if (rawErr) throw new Error(`Falha ao carregar uploads brutos: ${rawErr.message}`);

  const yearsTouched = new Set<number>();
  const aggregated = new Map<string, {
    company_id: string;
    dre_account_id: string;
    year: number;
    month: number;
    amount: number;
  }>();
  const unmappedLabels = new Set<string>();

  (rawRows ?? []).forEach((row) => {
    const label = row.label as string;
    const year = Number(row.year);
    const month = Number(row.month);
    const amount = Number(row.amount ?? 0);
    yearsTouched.add(year);

    const accountId = labelToAccount.get(label);
    if (!accountId) {
      unmappedLabels.add(label);
      return;
    }

    const key = `${accountId}:${year}:${month}`;
    const existing = aggregated.get(key);
    if (existing) {
      existing.amount += amount;
    } else {
      aggregated.set(key, {
        company_id: companyId,
        dre_account_id: accountId,
        year,
        month,
        amount,
      });
    }
  });

  // Wipe existing budget_entries for the years touched (to drop accounts that
  // are no longer mapped) before re-inserting.
  if (yearsTouched.size > 0) {
    const { error: deleteErr } = await db
      .from("budget_entries")
      .delete()
      .eq("company_id", companyId)
      .in("year", Array.from(yearsTouched));
    if (deleteErr) throw new Error(`Falha ao limpar budget_entries: ${deleteErr.message}`);
  }

  const toInsert = Array.from(aggregated.values()).filter((row) => row.amount !== 0);
  let imported = 0;
  const batchSize = 200;
  for (let i = 0; i < toInsert.length; i += batchSize) {
    const batch = toInsert.slice(i, i + batchSize);
    const { error: insertErr } = await db
      .from("budget_entries")
      .upsert(batch, { onConflict: "company_id,dre_account_id,year,month" });
    if (insertErr) throw new Error(`Falha ao gravar budget_entries: ${insertErr.message}`);
    imported += batch.length;
  }

  return {
    imported,
    unmappedLabels: Array.from(unmappedLabels),
  };
}
