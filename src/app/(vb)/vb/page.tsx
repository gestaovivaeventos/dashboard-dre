import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, Upload } from "lucide-react";

import { VbNewEntryDialog } from "@/components/vb/new-entry-dialog";
import { VbStatStrip } from "@/components/vb/stat-strip";
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
import { currentYearBR, formatDayBR } from "@/lib/ctrl/datetime";
import { formatBRL } from "@/lib/orcamento/format";
import { createClient } from "@/lib/supabase/server";
import { getVbUser } from "@/lib/vb/auth";
import { currentBalance, sortLedger, yieldBySemester, yieldOf } from "@/lib/vb/ledger";
import { fromCents, sumCents } from "@/lib/vb/money";
import { getPendingBatch, listCreditors, listEntries } from "@/lib/vb/queries";
import type { VbEntry } from "@/lib/vb/types";

export const dynamic = "force-dynamic";

export default async function VbOverviewPage() {
  const user = await getVbUser();
  if (!user) redirect("/");
  const isGestor = user.role === "gestor";
  const db = await createClient();

  const [creditors, entries, pendingBatch] = await Promise.all([
    listCreditors(db),
    listEntries(db, { status: "aprovado" }),
    isGestor ? getPendingBatch(db) : Promise.resolve(null),
  ]);

  const year = currentYearBR();
  const years = [year - 1, year];
  const byCreditor = new Map<string, VbEntry[]>();
  for (const entry of entries) {
    const list = byCreditor.get(entry.creditor_id) ?? [];
    list.push(entry);
    byCreditor.set(entry.creditor_id, list);
  }

  const rows = creditors.map((creditor) => {
    const list = byCreditor.get(creditor.id) ?? [];
    const sorted = sortLedger(list);
    return {
      creditor,
      balance: currentBalance(list),
      lastDate: sorted.length > 0 ? sorted[sorted.length - 1].entry_date : null,
      yieldYear: yieldOf(list, year),
      semesters: yieldBySemester(list, years),
      count: list.length,
    };
  });
  const active = rows.filter((r) => r.creditor.active);
  const closed = rows.filter((r) => !r.creditor.active);
  const totalBalance = fromCents(sumCents(active.map((r) => r.balance)));
  // Mesmo universo dos cards de rendimento e da tabela de juros por semestre: só credores ativos.
  const activeIds = new Set(active.map((r) => r.creditor.id));
  const activeEntries = entries.filter((e) => activeIds.has(e.creditor_id));
  // A importação é uma vez só: o convite some assim que existe histórico (ou
  // um lote esperando revisão).
  const showImportCta = isGestor && entries.length === 0 && !pendingBatch;

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink-primary">VB — Visão geral</h1>
          <p className="text-sm text-ink-muted">
            Créditos dos sócios e credores. Saldo positivo = o VB deve ao credor.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {showImportCta && (
            <Link
              href="/vb/importar"
              className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium text-ink-primary hover:bg-surface-2"
            >
              <Upload className="h-4 w-4" /> Importar histórico
            </Link>
          )}
          {isGestor && creditors.length > 0 && (
            <VbNewEntryDialog creditors={creditors.map(({ id, name, active }) => ({ id, name, active }))} />
          )}
        </div>
      </div>

      {pendingBatch && (
        <div className="flex items-center gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <span className="text-ink-primary">
            Há uma importação pendente de revisão ({pendingBatch.file_name}). Os lançamentos dela
            não entram nos saldos até serem aprovados.
          </span>
          <Link href={`/vb/importar/${pendingBatch.id}`} className="ml-auto font-medium underline">
            Revisar
          </Link>
        </div>
      )}

      <VbStatStrip
        stats={[
          {
            label: "Saldo total (ativos)",
            value: formatBRL(totalBalance),
            emphasis: true,
            tone: totalBalance < 0 ? "negative" : "default",
          },
          { label: "Credores ativos", value: String(active.length) },
          { label: `Rendimentos em ${year}`, value: formatBRL(yieldOf(activeEntries, year)), tone: "rendimento" },
          {
            label: `Rendimentos em ${year - 1}`,
            value: formatBRL(yieldOf(activeEntries, year - 1)),
            tone: "rendimento",
          },
        ]}
      />

      {creditors.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-ink-muted">
            Nenhum lançamento ainda.{" "}
            {isGestor ? (
              <>
                <Link href="/vb/importar" className="underline">
                  Importe o histórico
                </Link>{" "}
                uma única vez; depois, os lançamentos são feitos aqui.
              </>
            ) : (
              "Aguarde a importação do histórico."
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Credores</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table className="text-[13px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="h-8 py-1.5">Credor</TableHead>
                      <TableHead className="h-8 py-1.5 text-right">Saldo atual</TableHead>
                      <TableHead className="h-8 py-1.5 text-right">Rendimento em {year}</TableHead>
                      <TableHead className="h-8 py-1.5 text-right">Lançamentos</TableHead>
                      <TableHead className="h-8 py-1.5">Último lançamento</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...active, ...closed].map((row) => (
                      <TableRow key={row.creditor.id}>
                        <TableCell className="px-4 py-1.5">
                          <Link href={`/vb/credores/${row.creditor.id}`} className="font-medium underline-offset-2 hover:underline">
                            {row.creditor.name}
                          </Link>
                          {!row.creditor.active && (
                            <Badge variant="secondary" className="ml-2 text-[10px]">
                              encerrado
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell
                          className={`px-4 py-1.5 text-right font-medium tabular-nums ${row.balance < 0 ? "text-red-600" : "text-ink-primary"}`}
                        >
                          {formatBRL(row.balance)}
                        </TableCell>
                        <TableCell className="px-4 py-1.5 text-right tabular-nums text-sky-700">
                          {formatBRL(row.yieldYear)}
                        </TableCell>
                        <TableCell className="px-4 py-1.5 text-right tabular-nums">{row.count}</TableCell>
                        <TableCell className="px-4 py-1.5 whitespace-nowrap">{formatDayBR(row.lastDate)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Custo de juros por semestre</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table className="text-[13px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="h-8 py-1.5">Credor</TableHead>
                      {years.flatMap((y) => [
                        <TableHead key={`${y}-1`} className="h-8 py-1.5 text-right">1º sem {y}</TableHead>,
                        <TableHead key={`${y}-2`} className="h-8 py-1.5 text-right">2º sem {y}</TableHead>,
                      ])}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {active.map((row) => (
                      <TableRow key={row.creditor.id}>
                        <TableCell className="px-4 py-1.5 font-medium">{row.creditor.name}</TableCell>
                        {row.semesters.map((s) => (
                          <TableCell key={`${s.year}-${s.semester}`} className="px-4 py-1.5 text-right tabular-nums">
                            {formatBRL(s.total)}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                    <TableRow>
                      <TableCell className="px-4 py-1.5 font-semibold">Total</TableCell>
                      {yieldBySemester(activeEntries, years).map((s) => (
                        <TableCell key={`t-${s.year}-${s.semester}`} className="px-4 py-1.5 text-right font-semibold tabular-nums">
                          {formatBRL(s.total)}
                        </TableCell>
                      ))}
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
