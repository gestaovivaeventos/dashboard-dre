"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Check, Loader2, Pencil, Trash2, X } from "lucide-react";

import { VbEntryEditDialog } from "@/components/vb/entry-edit-dialog";
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
import { formatDateTimeBR, formatDayBR } from "@/lib/ctrl/datetime";
import { formatBRL } from "@/lib/orcamento/format";
import { updateCreditor } from "@/lib/vb/actions/creditors";
import {
  approveImportBatch,
  deletePendingEntry,
  discardImportBatch,
} from "@/lib/vb/actions/import";
import { describeRendimento } from "@/lib/vb/format";
import type { LedgerTotals, WithBalance } from "@/lib/vb/ledger";
import {
  VB_BALANCE_TOLERANCE,
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

function DiffBadge({ diff }: { diff: number | null }) {
  if (diff === null) return <Badge variant="outline">sem saldo na planilha</Badge>;
  const ok = Math.abs(diff) <= VB_BALANCE_TOLERANCE;
  return (
    <Badge variant={ok ? "secondary" : "destructive"}>
      {ok ? "fecha" : "divergência"} ({diff >= 0 ? "+" : ""}{formatBRL(diff)})
    </Badge>
  );
}

function FlagBadges({ flags }: { flags: VbEntryFlag[] }) {
  if (flags.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {flags.map((f) => (
        <Badge key={f} variant={isBlockingFlag(f) ? "destructive" : "outline"} className="whitespace-nowrap">
          {VB_FLAG_LABELS[f]}
        </Badge>
      ))}
    </div>
  );
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
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-[220px]">
        <label className="mb-1 block text-xs font-medium text-ink-secondary" htmlFor={`name-${group.creditor.id}`}>
          Nome do credor (aba &ldquo;{group.creditor.source_sheet ?? "—"}&rdquo;)
        </label>
        <Input id={`name-${group.creditor.id}`} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
      </div>
      <button
        type="button"
        onClick={() => setActive((v) => !v)}
        className={`inline-flex h-10 items-center gap-2 rounded-md border px-3 text-sm ${active ? "border-teal-600 text-teal-700" : "border-border text-ink-muted"}`}
      >
        {active ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
        {active ? "Ativo" : "Encerrado"}
      </button>
      <Button type="button" size="sm" onClick={save} disabled={!dirty || pending}>
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

  const isPending = batch.status === "pendente";
  const totalBlocking = useMemo(() => groups.reduce((acc, g) => acc + g.blockingCount, 0), [groups]);
  const totalEntries = useMemo(() => groups.reduce((acc, g) => acc + g.rows.length, 0), [groups]);
  const active = groups.find((g) => g.creditor.id === activeId) ?? groups[0] ?? null;

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
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink-primary">Revisão da importação</h1>
          <p className="text-sm text-ink-muted">
            {batch.file_name} · enviado em {formatDateTimeBR(batch.created_at)} ·{" "}
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
        <CardHeader>
          <CardTitle className="text-base">Resumo</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Credor</TableHead>
                <TableHead>Aba</TableHead>
                <TableHead className="text-right">Lançamentos</TableHead>
                <TableHead className="text-right">Saldo planilha</TableHead>
                <TableHead className="text-right">Saldo sistema</TableHead>
                <TableHead>Conferência</TableHead>
                <TableHead className="text-right">Bloqueios</TableHead>
                <TableHead className="text-right">Avisos</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batch.summary.creditors.map((c) => {
                const live = groups.find((g) => g.creditor.id === c.creditorId);
                const sheet = c.sheetFinalBalance;
                const computed = live ? live.computedFinalBalance : c.computedFinalBalance;
                const diff = live ? live.diff : c.diff;
                return (
                  <TableRow key={c.creditorId} className={live && activeId === c.creditorId ? "bg-surface-2" : undefined}>
                    <TableCell>
                      {live ? (
                        <button type="button" className="font-medium underline-offset-2 hover:underline" onClick={() => setActiveId(c.creditorId)}>
                          {live.creditor.name}
                        </button>
                      ) : (
                        c.name
                      )}
                      {c.hidden && <Badge variant="outline" className="ml-2">aba oculta</Badge>}
                    </TableCell>
                    <TableCell className="text-ink-muted">{c.sheetName}</TableCell>
                    <TableCell className="text-right tabular-nums">{live ? live.rows.length : c.entries}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatBRL(sheet)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatBRL(computed)}</TableCell>
                    <TableCell><DiffBadge diff={diff} /></TableCell>
                    <TableCell className="text-right tabular-nums">{live ? live.blockingCount : c.blockingCount}</TableCell>
                    <TableCell className="text-right tabular-nums">{live ? live.warningCount : c.warningCount}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {(batch.summary.skippedSheets.length > 0 || batch.summary.emptySheets.length > 0 || batch.summary.ignoredSheets.length > 0) && (
            <p className="mt-3 text-xs text-ink-muted">
              {batch.summary.skippedSheets.length > 0 && (
                <>Já importados (pulados): {batch.summary.skippedSheets.map((s) => s.sheetName).join(", ")}. </>
              )}
              {batch.summary.emptySheets.length > 0 && <>Abas vazias: {batch.summary.emptySheets.join(", ")}. </>}
              {batch.summary.ignoredSheets.length > 0 && <>Abas fora do VB: {batch.summary.ignoredSheets.join(", ")}.</>}
            </p>
          )}
          {isPending && totalEntries > 0 && (
            <p className="mt-2 text-xs text-ink-muted">
              Diferença até {formatBRL(VB_BALANCE_TOLERANCE)} por credor é arredondamento para centavos. Divergência maior não impede aprovar, mas vale corrigir a linha antes.
            </p>
          )}
        </CardContent>
      </Card>

      {isPending && active && (
        <Card>
          <CardHeader className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {groups.map((g) => (
                <button
                  key={g.creditor.id}
                  type="button"
                  onClick={() => setActiveId(g.creditor.id)}
                  className={`rounded-full border px-3 py-1 text-sm ${g.creditor.id === active.creditor.id ? "border-teal-600 bg-teal-600/10 font-medium text-teal-700" : "border-border text-ink-secondary hover:bg-surface-2"}`}
                >
                  {g.creditor.name}
                  {g.blockingCount > 0 && <span className="ml-1 text-red-600">•{g.blockingCount}</span>}
                </button>
              ))}
            </div>
            <CreditorHeader key={active.creditor.id} group={active} />
            <div className="flex flex-wrap gap-4 text-sm text-ink-secondary">
              <span>Entradas: <strong className="text-ink-primary">{formatBRL(active.totals.entradas)}</strong></span>
              <span>Saídas: <strong className="text-ink-primary">{formatBRL(active.totals.saidas)}</strong></span>
              <span>Rendimentos: <strong className="text-ink-primary">{formatBRL(active.totals.rendimentos)}</strong></span>
              <span>Saldo sistema: <strong className="text-ink-primary">{formatBRL(active.computedFinalBalance)}</strong></span>
              <span>Saldo planilha: <strong className="text-ink-primary">{formatBRL(active.sheetFinalBalance)}</strong></span>
              <DiffBadge diff={active.diff} />
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">Linha</TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead className="text-right">Entrada</TableHead>
                    <TableHead className="text-right">Saída</TableHead>
                    <TableHead className="text-right">Rendimento</TableHead>
                    <TableHead className="text-right">Saldo planilha</TableHead>
                    <TableHead className="text-right">Saldo sistema</TableHead>
                    <TableHead>Alertas</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {active.rows.map((row) => {
                    const sheetDiff = row.sheet_balance == null ? null : row.balance - row.sheet_balance;
                    const sheetOff = sheetDiff !== null && Math.abs(sheetDiff) > VB_BALANCE_TOLERANCE;
                    return (
                      <TableRow key={row.id} className={row.flags.some(isBlockingFlag) ? "bg-red-500/5" : undefined}>
                        <TableCell className="text-right tabular-nums text-ink-muted">{row.source_row ?? "—"}</TableCell>
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
                        <TableCell className="text-right tabular-nums text-ink-muted">{formatBRL(row.sheet_balance)}</TableCell>
                        <TableCell className={`text-right tabular-nums ${sheetOff ? "font-semibold text-red-600" : ""}`}>{formatBRL(row.balance)}</TableCell>
                        <TableCell><FlagBadges flags={row.flags} /></TableCell>
                        <TableCell className="whitespace-nowrap">
                          <Button type="button" variant="ghost" size="icon" onClick={() => setEditing(row)} aria-label="Editar">
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button type="button" variant="ghost" size="icon" onClick={() => setDeleting(row)} aria-label="Excluir">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
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
              Linha {deleting?.source_row ?? "—"}: {deleting?.description ?? "—"} ({formatBRL(deleting?.amount ?? null)}). A linha some deste lote; a planilha não muda.
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
                ? `${totalEntries} lançamentos de ${groups.length} credor(es) passam a ser o histórico oficial do VB. Depois de aprovado, o histórico não é editado.`
                : "Todos os lançamentos pendentes deste lote são apagados. Você pode importar a planilha de novo depois."}
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
