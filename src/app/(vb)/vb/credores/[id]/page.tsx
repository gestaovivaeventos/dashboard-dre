import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AlertTriangle, ArrowLeft } from "lucide-react";

import { VbNewEntryDialog } from "@/components/vb/new-entry-dialog";
import { VbStatStrip } from "@/components/vb/stat-strip";
import { VbStatementTable } from "@/components/vb/statement-table";
import { Badge } from "@/components/ui/badge";
import { formatBRL } from "@/lib/orcamento/format";
import { createClient } from "@/lib/supabase/server";
import { getVbUser } from "@/lib/vb/auth";
import { currentBalance, ledgerTotals, withRunningBalance } from "@/lib/vb/ledger";
import { countPendingEntries, getCreditor, getPendingBatch, listEntries } from "@/lib/vb/queries";
import { isUuid } from "@/lib/vb/types";

export const dynamic = "force-dynamic";

export default async function VbCreditorPage({ params }: { params: { id: string } }) {
  const user = await getVbUser();
  if (!user) redirect("/");
  if (!isUuid(params.id)) notFound();
  const isGestor = user.role === "gestor";
  const db = await createClient();

  const creditor = await getCreditor(db, params.id);
  if (!creditor) notFound();

  const [entries, pendingCount, pendingBatch] = await Promise.all([
    listEntries(db, { status: "aprovado", creditorId: creditor.id }),
    isGestor ? countPendingEntries(db, creditor.id) : Promise.resolve(0),
    isGestor ? getPendingBatch(db) : Promise.resolve(null),
  ]);

  const totals = ledgerTotals(entries);
  const balance = currentBalance(entries);
  // Cronológico, mais antigo em cima: a mesma ordem da planilha, que é como o
  // saldo é conferido linha a linha.
  const rows = withRunningBalance(entries);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <Link href="/vb" className="inline-flex items-center gap-1 text-xs text-ink-muted hover:underline">
            <ArrowLeft className="h-3 w-3" /> Visão geral
          </Link>
          <h1 className="text-xl font-semibold text-ink-primary">{creditor.name}</h1>
          {!creditor.active && (
            <Badge variant="secondary" className="text-[10px]">
              encerrado
            </Badge>
          )}
        </div>
        {isGestor && <VbNewEntryDialog creditorId={creditor.id} creditorName={creditor.name} />}
      </div>

      {isGestor && pendingCount > 0 && (
        <div className="flex items-center gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <span className="text-ink-primary">
            {pendingCount} lançamento(s) deste credor aguardam aprovação e não entram no saldo.
          </span>
          {pendingBatch && (
            <Link href={`/vb/importar/${pendingBatch.id}`} className="ml-auto font-medium underline">
              Revisar lote
            </Link>
          )}
        </div>
      )}

      <VbStatStrip
        stats={[
          {
            label: "Saldo atual",
            value: formatBRL(balance),
            emphasis: true,
            tone: balance < 0 ? "negative" : "default",
          },
          { label: "Entradas", value: formatBRL(totals.entradas), tone: "entrada" },
          { label: "Saídas", value: formatBRL(totals.saidas), tone: "saida" },
          { label: "Rendimentos", value: formatBRL(totals.rendimentos), tone: "rendimento" },
        ]}
      />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-muted">
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-emerald-500" /> entrada
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-red-500" /> saída
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-sky-500" /> rendimento
        </span>
        <span>{entries.length} lançamentos · saldo positivo = o VB deve ao credor</span>
      </div>

      <VbStatementTable rows={rows} yearSeparators emptyText="Nenhum lançamento aprovado." />
    </div>
  );
}
