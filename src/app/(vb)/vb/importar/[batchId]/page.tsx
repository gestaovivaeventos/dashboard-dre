import { notFound, redirect } from "next/navigation";

import { VbBatchReview, type ReviewGroup } from "@/components/vb/batch-review";
import { createClient } from "@/lib/supabase/server";
import { getVbUser } from "@/lib/vb/auth";
import { currentBalance, ledgerTotals, withSheetOrderBalance } from "@/lib/vb/ledger";
import { roundCents } from "@/lib/vb/money";
import { getBatch, listCreditors, listEntries } from "@/lib/vb/queries";
import { isBlockingFlag } from "@/lib/vb/types";

export const dynamic = "force-dynamic";

export default async function VbBatchPage({ params }: { params: { batchId: string } }) {
  const user = await getVbUser();
  if (!user) redirect("/");
  if (user.role !== "gestor") redirect("/vb");

  const db = await createClient();
  const batch = await getBatch(db, params.batchId);
  if (!batch) notFound();

  const creditorIds = new Set(batch.summary.creditors.map((c) => c.creditorId));
  const [creditors, entries] = await Promise.all([
    listCreditors(db),
    batch.status === "pendente" ? listEntries(db, { status: "pendente", batchId: batch.id }) : Promise.resolve([]),
  ]);

  const groups: ReviewGroup[] = creditors
    .filter((c) => creditorIds.has(c.id))
    .map((creditor) => {
      const list = entries.filter((e) => e.creditor_id === creditor.id);
      const rows = withSheetOrderBalance(list);
      const sheetFinalBalance =
        batch.summary.creditors.find((c) => c.creditorId === creditor.id)?.sheetFinalBalance ?? null;
      const computedFinalBalance = currentBalance(list);
      return {
        creditor,
        rows,
        totals: ledgerTotals(list),
        sheetFinalBalance,
        computedFinalBalance,
        diff: sheetFinalBalance === null ? null : roundCents(computedFinalBalance - sheetFinalBalance),
        blockingCount: rows.filter((r) => r.flags.some(isBlockingFlag)).length,
        warningCount: rows.filter((r) => r.flags.length > 0 && !r.flags.some(isBlockingFlag)).length,
      };
    });

  return <VbBatchReview batch={batch} groups={groups} />;
}
