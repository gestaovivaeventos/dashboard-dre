"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Check, Loader2, X } from "lucide-react";

import { VbEntryEditDialog } from "@/components/vb/entry-edit-dialog";
import { VbStatementTable } from "@/components/vb/statement-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/toaster";
import { formatDateTimeBR } from "@/lib/ctrl/datetime";
import { formatBRL } from "@/lib/orcamento/format";
import { updateCreditor } from "@/lib/vb/actions/creditors";
import {
  approveImportBatch,
  deletePendingEntry,
  discardImportBatch,
} from "@/lib/vb/actions/import";
import type { LedgerTotals, WithBalance } from "@/lib/vb/ledger";
import {
  VB_FLAG_LABELS,
  isBlockingFlag,
  type VbCreditor,
  type VbEntry,
  type VbEntryFlag,
  type VbImportBatch,
} from "@/lib/vb/types";

export interface ReviewGroup {
  creditor: VbCreditor;
  /** Em ordem de PLANILHA, com o saldo acumulado nessa ordem. */
  rows: WithBalance<VbEntry>[];
  totals: LedgerTotals;
  sheetFinalBalance: number | null;
  computedFinalBalance: number;
  diff: number | null;
  blockingCount: number;
  warningCount: number;
}

interface Props {
  batch: VbImportBatch;
  groups: ReviewGroup[];
}

type RowFilter = "todos" | "alerta";

const ROW_FILTERS: Array<{ value: RowFilter; label: string }> = [
  { value: "todos", label: "Todos" },
  { value: "alerta", label: "Só com alerta" },
];

/** Semáforo do credor: bloqueio manda, depois aviso, senão tudo certo. */
function dotFor(group: ReviewGroup): string {
  if (group.blockingCount > 0) return "bg-red-500";
  if (group.warningCount > 0) return "bg-amber-500";
  return "bg-emerald-500";
}

function CreditorHeader({ group }: { group: ReviewGroup }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(group.creditor.name);
  const [active, setActive] = useState(group.creditor.active);
  const dirty = name.trim() !== group.creditor.name || active !== group.creditor.active;

  function save() {
    startTransition(async () => {
      const result = await updateCreditor(group.creditor.id, { name, active });
      if ("error" in result) {
        showToast({ title: "Não salvo", description: result.error, variant: "destructive" });
        return;
      }
      showToast({ title: "Credor atualizado", variant: "success" });
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="text-[11px] uppercase tracking-wide text-ink-muted" htmlFor={`name-${group.creditor.id}`}>
        Nome do credor
      </label>
      <Input
        id={`name-${group.creditor.id}`}
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={120}
        className="h-8 w-[220px] text-[13px]"
      />
      <button
        type="button"
        onClick={() => setActive((v) => !v)}
        className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[13px] ${active ? "border-teal-600 text-teal-700" : "border-border text-ink-muted"}`}
      >
        {active ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
        {active ? "Ativo" : "Encerrado"}
      </button>
      <Button type="button" size="sm" className="h-8" onClick={save} disabled={!dirty || pending}>
        {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Salvar credor
      </Button>
    </div>
  );
}

export function VbBatchReview({ batch, groups }: Props) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [activeId, setActiveId] = useState<string | null>(groups[0]?.creditor.id ?? null);
  const [editing, setEditing] = useState<VbEntry | null>(null);
  const [confirm, setConfirm] = useState<"approve" | "discard" | null>(null);
  const [deleting, setDeleting] = useState<VbEntry | null>(null);
  const [rowFilter, setRowFilter] = useState<RowFilter>("todos");

  const isPending = batch.status === "pendente";
  const totalBlocking = useMemo(() => groups.reduce((acc, g) => acc + g.blockingCount, 0), [groups]);
  const totalEntries = useMemo(() => groups.reduce((acc, g) => acc + g.rows.length, 0), [groups]);
  const active = groups.find((g) => g.creditor.id === activeId) ?? groups[0] ?? null;

  // Contagem de flags do credor ativo, bloqueantes primeiro (spec §8.3).
  const flagCounts = useMemo(() => {
    const map = new Map<VbEntryFlag, number>();
    if (!active) return map;
    for (const row of active.rows) {
      for (const flag of row.flags) {
        map.set(flag, (map.get(flag) ?? 0) + 1);
      }
    }
    return map;
  }, [active]);

  // Recorte da conferência. A ordem de exibição é da tabela (mais recente em cima).
  const visibleRows = useMemo(() => {
    if (!active) return [];
    if (rowFilter === "alerta") return active.rows.filter((row) => row.flags.length > 0);
    return active.rows;
  }, [active, rowFilter]);

  function runApprove() {
    startTransition(async () => {
      const result = await approveImportBatch(batch.id);
      if ("error" in result) {
        showToast({ title: "Lote não aprovado", description: result.error, variant: "destructive" });
        return;
      }
      showToast({ title: "Histórico aprovado", description: `${result.approved} lançamentos agora são oficiais.`, variant: "success" });
      setConfirm(null);
      router.push("/vb");
      router.refresh();
    });
  }

  function runDiscard() {
    startTransition(async () => {
      const result = await discardImportBatch(batch.id);
      if ("error" in result) {
        showToast({ title: "Lote não descartado", description: result.error, variant: "destructive" });
        return;
      }
      showToast({ title: "Lote descartado", variant: "default" });
      setConfirm(null);
      router.push("/vb/importar");
      router.refresh();
    });
  }

  function runDelete(entry: VbEntry) {
    startTransition(async () => {
      const result = await deletePendingEntry(entry.id);
      if ("error" in result) {
        showToast({ title: "Não excluído", description: result.error, variant: "destructive" });
        return;
      }
      setDeleting(null);
      router.refresh();
    });
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink-primary">Revisão do histórico</h1>
          <p className="text-sm text-ink-muted">
            Enviado em {formatDateTimeBR(batch.created_at)} ·{" "}
            <Badge variant={isPending ? "default" : batch.status === "aprovado" ? "secondary" : "outline"}>
              {isPending ? "pendente" : batch.status}
            </Badge>
          </p>
        </div>
        {isPending && (
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={() => setConfirm("discard")} disabled={pending}>
              Descartar
            </Button>
            <Button type="button" onClick={() => setConfirm("approve")} disabled={pending || totalBlocking > 0}>
              Aprovar importação
              {totalBlocking > 0 && ` (${totalBlocking} bloqueio${totalBlocking > 1 ? "s" : ""})`}
            </Button>
          </div>
        )}
      </div>

      {!isPending && (
        <Card>
          <CardContent className="py-4 text-sm text-ink-muted">
            {batch.status === "aprovado"
              ? `Lote aprovado em ${formatDateTimeBR(batch.approved_at)}. Os lançamentos estão no extrato de cada credor.`
              : `Lote descartado em ${formatDateTimeBR(batch.discarded_at)}.`}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Credores</CardTitle>
        </CardHeader>
        <CardContent>
          <Table className="text-[13px]">
            <TableHeader>
              <TableRow>
                <TableHead className="h-8 py-1.5">Credor</TableHead>
                <TableHead className="h-8 py-1.5 text-right">Lançamentos</TableHead>
                <TableHead className="h-8 py-1.5 text-right">Saldo</TableHead>
                <TableHead className="h-8 py-1.5 text-right">Bloqueios</TableHead>
                <TableHead className="h-8 py-1.5 text-right">Avisos</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batch.summary.creditors.map((c) => {
                const live = groups.find((g) => g.creditor.id === c.creditorId);
                const computed = live ? live.computedFinalBalance : c.computedFinalBalance;
                const blocking = live ? live.blockingCount : c.blockingCount;
                const warnings = live ? live.warningCount : c.warningCount;
                return (
                  <TableRow key={c.creditorId} className={live && activeId === c.creditorId ? "bg-surface-2" : undefined}>
                    <TableCell className="px-4 py-1.5">
                      {live ? (
                        <button type="button" className="font-medium underline-offset-2 hover:underline" onClick={() => setActiveId(c.creditorId)}>
                          {live.creditor.name}
                        </button>
                      ) : (
                        c.name
                      )}
                      {live?.creditor.active === false && (
                        <Badge variant="outline" className="ml-2 text-[10px]">encerrado</Badge>
                      )}
                    </TableCell>
                    <TableCell className="px-4 py-1.5 text-right tabular-nums">{live ? live.rows.length : c.entries}</TableCell>
                    <TableCell className={`px-4 py-1.5 text-right tabular-nums ${computed < 0 ? "text-red-600" : ""}`}>
                      {formatBRL(computed)}
                    </TableCell>
                    <TableCell className={`px-4 py-1.5 text-right tabular-nums ${blocking > 0 ? "font-semibold text-red-600" : ""}`}>{blocking}</TableCell>
                    <TableCell className={`px-4 py-1.5 text-right tabular-nums ${warnings > 0 ? "text-amber-700" : ""}`}>{warnings}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {isPending && active && (
        <Card>
          <CardHeader className="space-y-2 pb-3">
            <div className="flex flex-wrap gap-1.5">
              {groups.map((g) => (
                <button
                  key={g.creditor.id}
                  type="button"
                  onClick={() => setActiveId(g.creditor.id)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] ${g.creditor.id === active.creditor.id ? "border-teal-600 bg-teal-600/10 font-medium text-teal-700" : "border-border text-ink-secondary hover:bg-surface-2"}`}
                >
                  <span className={`h-2 w-2 shrink-0 rounded-full ${dotFor(g)}`} />
                  {g.creditor.name}
                  {g.blockingCount > 0 && <span className="text-red-600">{g.blockingCount}</span>}
                </button>
              ))}
            </div>
            <CreditorHeader key={active.creditor.id} group={active} />
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
              <span className="text-ink-secondary">
                Saldo{" "}
                <strong className={`tabular-nums ${active.computedFinalBalance < 0 ? "text-red-600" : "text-ink-primary"}`}>
                  {formatBRL(active.computedFinalBalance)}
                </strong>
              </span>
              <span className="text-ink-muted">
                Entradas {formatBRL(active.totals.entradas)} · Saídas {formatBRL(active.totals.saidas)} · Rendimentos{" "}
                {formatBRL(active.totals.rendimentos)}
              </span>
              <div className="ml-auto flex flex-wrap items-center gap-1">
                {ROW_FILTERS.map((filter) => (
                  <button
                    key={filter.value}
                    type="button"
                    aria-pressed={rowFilter === filter.value}
                    onClick={() => setRowFilter(filter.value)}
                    className={`rounded-full border px-2.5 py-0.5 text-[12px] ${
                      rowFilter === filter.value
                        ? "border-teal-600 bg-teal-600/10 font-medium text-teal-700"
                        : "border-border text-ink-muted hover:bg-surface-2"
                    }`}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
            </div>
            {flagCounts.size > 0 && (
              <div className="flex flex-wrap gap-1">
                {Array.from(flagCounts.entries())
                  .sort(([a], [b]) => Number(isBlockingFlag(b)) - Number(isBlockingFlag(a)))
                  .map(([flag, count]) => (
                    <Badge
                      key={flag}
                      variant={isBlockingFlag(flag) ? "destructive" : "outline"}
                      className="whitespace-nowrap px-1.5 py-0 text-[10px]"
                    >
                      {VB_FLAG_LABELS[flag]} ×{count}
                    </Badge>
                  ))}
              </div>
            )}
          </CardHeader>
          <CardContent>
            <VbStatementTable
              rows={visibleRows}
              showFlags
              onEdit={setEditing}
              onDelete={setDeleting}
              emptyText={
                rowFilter === "todos" ? "Nenhum lançamento neste credor." : "Nenhum lançamento neste recorte."
              }
            />
          </CardContent>
        </Card>
      )}

      {!isPending && (
        <p className="text-sm">
          <Link href="/vb/importar" className="underline">Voltar para a importação</Link>
        </p>
      )}

      <VbEntryEditDialog entry={editing} onClose={() => setEditing(null)} />

      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir lançamento?</DialogTitle>
            <DialogDescription>
              {deleting?.description ?? "—"} ({formatBRL(deleting?.amount ?? null)}) sai do histórico pendente.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleting(null)} disabled={pending}>Cancelar</Button>
            <Button type="button" variant="destructive" onClick={() => deleting && runDelete(deleting)} disabled={pending}>Excluir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirm === "approve" ? "Aprovar a importação?" : "Descartar o lote?"}</DialogTitle>
            <DialogDescription>
              {confirm === "approve"
                ? `${totalEntries} lançamentos de ${groups.length} credor(es) passam a ser o histórico oficial do VB. A partir daí, os lançamentos são feitos aqui no sistema.`
                : "Todos os lançamentos pendentes deste lote são apagados. Você pode importar o histórico de novo depois."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirm(null)} disabled={pending}>Cancelar</Button>
            <Button
              type="button"
              variant={confirm === "approve" ? "default" : "destructive"}
              onClick={confirm === "approve" ? runApprove : runDiscard}
              disabled={pending}
            >
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {confirm === "approve" ? "Aprovar" : "Descartar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
