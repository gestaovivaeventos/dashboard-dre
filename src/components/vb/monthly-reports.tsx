"use client";

// Tela "Relatórios mensais" do VB: uma linha por credor ativo no mês
// escolhido, status derivado e ações. Nada sai sozinho — todo envio é um
// clique aqui. A prévia é o mesmo HTML que vai por e-mail (iframe isolado).

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Eye, Loader2, Mail, Send } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { previewVbMonthlyReport, sendReadyVbMonthlyReports, sendVbMonthlyReport } from "@/lib/vb/actions/reports";
import { VB_REPORT_STATUS_LABELS, type VbReportStatus } from "@/lib/vb/report/status";
import type { VbReportSendKind } from "@/lib/vb/types";

export interface MonthlyReportRowView {
  creditorId: string;
  name: string;
  email: string | null;
  status: VbReportStatus;
  openingBalance: number;
  closingBalance: number;
  rendimento: number;
  lines: number;
  lastYieldEnd: string | null;
  closingDate: string;
  lastOfficial: { sentAt: string; sentTo: string } | null;
  lastTest: { sentAt: string } | null;
}

interface Props {
  month: string;
  months: Array<{ key: string; label: string }>;
  rows: MonthlyReportRowView[];
}

const STATUS_CLASS: Record<VbReportStatus, string> = {
  sem_email: "border-amber-500/40 bg-amber-500/10 text-amber-700",
  rendimento_pendente: "border-sky-500/40 bg-sky-500/10 text-sky-700",
  pronto: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700",
  enviado: "border-border bg-surface-2 text-ink-secondary",
};

export function VbMonthlyReports({ month, months, rows }: Props) {
  const router = useRouter();
  const { showToast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [preview, setPreview] = useState<{ name: string; subject: string; html: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const ready = rows.filter((r) => r.status === "pronto");
  const counts = rows.reduce<Record<VbReportStatus, number>>(
    (acc, r) => ({ ...acc, [r.status]: acc[r.status] + 1 }),
    { sem_email: 0, rendimento_pendente: 0, pronto: 0, enviado: 0 },
  );

  function openPreview(row: MonthlyReportRowView) {
    setPreviewLoading(true);
    setPreview({ name: row.name, subject: "", html: "" });
    startTransition(async () => {
      const result = await previewVbMonthlyReport(row.creditorId, month);
      setPreviewLoading(false);
      if ("error" in result) {
        showToast({ title: "Prévia indisponível", description: result.error, variant: "destructive" });
        setPreview(null);
        return;
      }
      setPreview({ name: row.name, subject: result.subject, html: result.html });
    });
  }

  function send(row: MonthlyReportRowView, kind: VbReportSendKind) {
    if (kind === "oficial" && !confirm(`Enviar o extrato de ${row.name} para ${row.email}?`)) return;
    if (kind === "reenvio" && !confirm(`${row.name} já recebeu este extrato em ${formatDateTimeBR(row.lastOfficial?.sentAt)}. Reenviar para ${row.email}?`)) return;
    setBusy(`${row.creditorId}:${kind}`);
    startTransition(async () => {
      const result = await sendVbMonthlyReport({ creditorId: row.creditorId, month, kind });
      setBusy(null);
      if ("error" in result) {
        showToast({ title: "Não enviado", description: result.error, variant: "destructive" });
        return;
      }
      showToast({
        title: kind === "teste" ? `Teste enviado para ${result.sentTo}` : `Enviado para ${result.sentTo}`,
        variant: "success",
      });
      router.refresh();
    });
  }

  function sendAll() {
    if (!confirm(`Enviar o extrato de ${month} para ${ready.length} credor(es): ${ready.map((r) => r.name).join(", ")}?`)) return;
    setBusy("all");
    startTransition(async () => {
      const result = await sendReadyVbMonthlyReports(month);
      setBusy(null);
      if ("error" in result) {
        showToast({ title: "Não enviado", description: result.error, variant: "destructive" });
        return;
      }
      showToast({
        title: `${result.sent.length} enviado(s)${result.failed.length ? `, ${result.failed.length} com falha` : ""}`,
        description: result.failed.map((f) => `${f.name}: ${f.error}`).join(" · ") || undefined,
        variant: result.failed.length ? "destructive" : "success",
      });
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-ink-secondary">
          Mês
          <select
            id="vb-report-month"
            className="h-9 rounded-md border border-border bg-surface-1 px-3 text-sm text-ink-primary"
            value={month}
            onChange={(e) => router.push(`/vb/relatorios?mes=${e.target.value}`)}
          >
            {months.map((m) => (
              <option key={m.key} value={m.key}>{m.label}</option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-muted">
          {(Object.keys(counts) as VbReportStatus[]).map((s) => (
            <span key={s} className={`rounded-full border px-2 py-0.5 ${STATUS_CLASS[s]}`}>
              {counts[s]} {VB_REPORT_STATUS_LABELS[s].toLowerCase()}
            </span>
          ))}
        </div>
        <div className="ml-auto">
          <Button type="button" onClick={sendAll} disabled={pending || ready.length === 0}>
            {busy === "all" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            Enviar todos os prontos{ready.length ? ` (${ready.length})` : ""}
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border border-border bg-surface-1">
        <Table className="text-[13px]">
          <TableHeader>
            <TableRow>
              <TableHead className="h-8 py-1.5">Credor</TableHead>
              <TableHead className="h-8 py-1.5">E-mail</TableHead>
              <TableHead className="h-8 py-1.5 text-right">Saldo final</TableHead>
              <TableHead className="h-8 py-1.5 text-right">Rendimento no mês</TableHead>
              <TableHead className="h-8 py-1.5">Status</TableHead>
              <TableHead className="h-8 py-1.5">Último envio</TableHead>
              <TableHead className="h-8 py-1.5 text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-ink-muted">Nenhum credor ativo.</TableCell>
              </TableRow>
            )}
            {rows.map((row) => {
              const isBusy = (k: string) => busy === `${row.creditorId}:${k}`;
              return (
                <TableRow key={row.creditorId}>
                  <TableCell className="px-4 py-1.5 font-medium">{row.name}</TableCell>
                  <TableCell className="px-4 py-1.5 text-ink-secondary">
                    {row.email ?? <span className="text-amber-700">não cadastrado</span>}
                  </TableCell>
                  <TableCell className={`px-4 py-1.5 text-right tabular-nums ${row.closingBalance < 0 ? "text-red-600" : ""}`}>
                    {formatBRL(row.closingBalance)}
                  </TableCell>
                  <TableCell className="px-4 py-1.5 text-right tabular-nums text-sky-700">{formatBRL(row.rendimento)}</TableCell>
                  <TableCell className="px-4 py-1.5">
                    <Badge variant="outline" className={`text-[11px] ${STATUS_CLASS[row.status]}`}>
                      {VB_REPORT_STATUS_LABELS[row.status]}
                    </Badge>
                    {row.status === "rendimento_pendente" && (
                      <div className="mt-0.5 text-[11px] text-ink-muted">
                        rendimento até {row.lastYieldEnd ? formatDayBR(row.lastYieldEnd) : "—"} · falta até {formatDayBR(row.closingDate)}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="px-4 py-1.5 text-ink-secondary">
                    {row.lastOfficial ? (
                      <span title={row.lastOfficial.sentTo}>{formatDateTimeBR(row.lastOfficial.sentAt)}</span>
                    ) : (
                      "—"
                    )}
                    {row.lastTest && (
                      <div className="text-[11px] text-ink-muted">teste {formatDateTimeBR(row.lastTest.sentAt)}</div>
                    )}
                  </TableCell>
                  <TableCell className="px-4 py-1.5">
                    <div className="flex items-center justify-end gap-1">
                      <Button type="button" size="sm" variant="ghost" onClick={() => openPreview(row)} disabled={pending}>
                        <Eye className="mr-1 h-3.5 w-3.5" /> Prévia
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => send(row, "teste")} disabled={pending}>
                        {isBusy("teste") ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Mail className="mr-1 h-3.5 w-3.5" />}
                        Testar
                      </Button>
                      {row.status === "enviado" ? (
                        <Button type="button" size="sm" variant="outline" onClick={() => send(row, "reenvio")} disabled={pending || !row.email}>
                          {isBusy("reenvio") && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                          Reenviar
                        </Button>
                      ) : (
                        <Button type="button" size="sm" onClick={() => send(row, "oficial")} disabled={pending || row.status !== "pronto"}>
                          {isBusy("oficial") ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1 h-3.5 w-3.5" />}
                          Enviar
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <p className="text-[12px] text-ink-muted">
        &ldquo;Rendimento pendente&rdquo;: o CDI do mês ainda não foi lançado até o último dia. Lance pelo botão
        &ldquo;Calcular rendimento&rdquo; (Visão geral ou tela do credor) e a linha vira &ldquo;Pronto&rdquo;.
        Testar manda o e-mail só para você, com tarja de teste.
      </p>

      <Dialog open={preview !== null} onOpenChange={(v) => !v && setPreview(null)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{preview?.name}</DialogTitle>
            <DialogDescription>{preview?.subject || "Montando a prévia…"}</DialogDescription>
          </DialogHeader>
          {previewLoading ? (
            <p className="py-8 text-center text-sm text-ink-muted">
              <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Calculando…
            </p>
          ) : (
            <iframe
              title="Prévia do extrato"
              sandbox=""
              srcDoc={`<!doctype html><meta charset="utf-8">${preview?.html ?? ""}`}
              className="h-[70vh] w-full rounded-md border border-border bg-white"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
