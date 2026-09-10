import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AlertTriangle, ArrowLeft } from "lucide-react";

import { VbNewEntryDialog } from "@/components/vb/new-entry-dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDayBR } from "@/lib/ctrl/datetime";
import { formatBRL } from "@/lib/orcamento/format";
import { createClient } from "@/lib/supabase/server";
import { getVbUser } from "@/lib/vb/auth";
import { describeRendimento } from "@/lib/vb/format";
import { currentBalance, groupByYear, ledgerTotals } from "@/lib/vb/ledger";
import { countPendingEntries, getCreditor, getPendingBatch, listEntries } from "@/lib/vb/queries";

export const dynamic = "force-dynamic";

function Stat({ label, value, negative }: { label: string; value: number; negative?: boolean }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-ink-muted">{label}</CardTitle>
      </CardHeader>
      <CardContent className={`text-2xl font-semibold ${negative ? "text-red-600" : "text-ink-primary"}`}>
        {formatBRL(value)}
      </CardContent>
    </Card>
  );
}

export default async function VbCreditorPage({ params }: { params: { id: string } }) {
  const user = await getVbUser();
  if (!user) redirect("/");
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
  const years = groupByYear(entries);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/vb" className="inline-flex items-center gap-1 text-xs text-ink-muted hover:underline">
            <ArrowLeft className="h-3 w-3" /> Visão geral
          </Link>
          <h1 className="text-xl font-semibold text-ink-primary">
            {creditor.name}
            {!creditor.active && <Badge variant="secondary" className="ml-2 align-middle">encerrado</Badge>}
          </h1>
          <p className="text-sm text-ink-muted">
            {entries.length} lançamentos · saldo positivo = o VB deve ao credor
          </p>
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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Saldo atual" value={balance} negative={balance < 0} />
        <Stat label="Entradas" value={totals.entradas} />
        <Stat label="Saídas" value={totals.saidas} />
        <Stat label="Rendimentos" value={totals.rendimentos} />
      </div>

      {years.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-ink-muted">Nenhum lançamento aprovado.</CardContent>
        </Card>
      ) : (
        years.map((group) => (
          <Card key={group.year}>
            <CardHeader className="flex flex-row flex-wrap items-baseline justify-between gap-2">
              <CardTitle className="text-base">{group.year}</CardTitle>
              <p className="text-xs text-ink-muted">
                Entradas {formatBRL(group.totals.entradas)} · Saídas {formatBRL(group.totals.saidas)} · Rendimentos{" "}
                {formatBRL(group.totals.rendimentos)} · Saldo no fim do ano{" "}
                <strong className="text-ink-primary">{formatBRL(group.closingBalance)}</strong>
              </p>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Descrição</TableHead>
                      <TableHead className="text-right">Entrada</TableHead>
                      <TableHead className="text-right">Saída</TableHead>
                      <TableHead className="text-right">Rendimento</TableHead>
                      <TableHead className="text-right">Saldo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {group.entries.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="whitespace-nowrap">{formatDayBR(row.entry_date)}</TableCell>
                        <TableCell>
                          <div>{row.description ?? "—"}</div>
                          {row.kind === "rendimento" && (
                            <div className="text-xs text-ink-muted">{describeRendimento(row)}</div>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{row.kind === "entrada" ? formatBRL(row.amount) : ""}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.kind === "saida" ? formatBRL(Math.abs(row.amount)) : ""}</TableCell>
                        <TableCell className={`text-right tabular-nums ${row.kind === "rendimento" && row.amount < 0 ? "text-red-600" : ""}`}>
                          {row.kind === "rendimento" ? formatBRL(row.amount) : ""}
                        </TableCell>
                        <TableCell className={`text-right font-medium tabular-nums ${row.balance < 0 ? "text-red-600" : ""}`}>
                          {formatBRL(row.balance)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
