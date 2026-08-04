"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  Loader2,
  MessageSquarePlus,
  RefreshCw,
  RotateCcw,
  Send,
  Sparkles,
} from "lucide-react";

import { OnePageReportPreview } from "@/components/financeiro/relatorios/OnePageReportPreview";
import type { OnePageReportPreviewData } from "@/components/financeiro/relatorios/OnePageReportPreview";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import {
  mapOnePageApiResponseToPreviewData,
  type OnePageApiResponse,
} from "@/lib/financeiro/relatorios/one-page-report-mapper";

// ============================================================================
// Tela "Validação Relatório" — o CSC valida os relatórios BI mensais antes do
// envio aos gestores.
//
// A prévia usa o MESMO componente da tela de Business Intelligence
// (<OnePageReportPreview />) alimentado pelo MESMO mapper: o que o CSC vê aqui
// é exatamente o que a tela de BI mostra e o que o e-mail envia.
//
// Ações por relatório: Aceitar · Revisão · Adicionar contexto · Gerar
// novamente · Enviar ao gestor (liberado só após o aceite).
// ============================================================================

export type ValidacaoStatus =
  | "pendente_validacao"
  | "em_revisao"
  | "contexto_adicionado"
  | "aceito"
  | "enviado_manual"
  | "enviado_automatico"
  | "erro_envio"
  | "erro_geracao";

export interface ValidacaoRelatorioItem {
  id: string;
  companyId: string;
  companyName: string;
  periodFrom: string;
  periodTo: string;
  periodLabel: string;
  status: ValidacaoStatus;
  version: number;
  generatedAt: string | null;
  generationError: string | null;
  hasContext: boolean;
  acceptedAt: string | null;
  acceptedBy: string | null;
  reviewAt: string | null;
  reviewBy: string | null;
  reviewNote: string | null;
  sentAt: string | null;
  sentBy: string | null;
  sentMode: "manual" | "automatico" | null;
  sentRecipients: string[];
  sendError: string | null;
  /** Destinatários ativos cadastrados em Plataforma > Relatório BI. */
  recipients: string[];
}

interface Props {
  items: ValidacaoRelatorioItem[];
  defaultPeriod: string;
  loadError: string | null;
}

const STATUS_LABEL: Record<ValidacaoStatus, string> = {
  pendente_validacao: "Pendente de validação",
  em_revisao: "Em revisão",
  contexto_adicionado: "Contexto adicionado",
  aceito: "Aceito",
  enviado_manual: "Enviado manualmente",
  enviado_automatico: "Enviado automaticamente",
  erro_envio: "Erro no envio",
  erro_geracao: "Erro na geração",
};

const STATUS_CLASS: Record<ValidacaoStatus, string> = {
  pendente_validacao: "bg-amber-100 text-amber-800",
  em_revisao: "bg-orange-100 text-orange-800",
  contexto_adicionado: "bg-sky-100 text-sky-800",
  aceito: "bg-emerald-100 text-emerald-800",
  enviado_manual: "bg-blue-100 text-blue-800",
  enviado_automatico: "bg-indigo-100 text-indigo-800",
  erro_envio: "bg-rose-100 text-rose-800",
  erro_geracao: "bg-rose-100 text-rose-800",
};

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()} ${hh}:${mi}`;
}

type DialogMode = "preview" | "revisao" | "contexto" | null;

export function ValidacaoRelatorioClient({ items, defaultPeriod, loadError }: Props) {
  const { showToast } = useToast();
  const router = useRouter();

  const periods = useMemo(() => {
    const seen: string[] = [];
    for (const item of items) {
      if (!seen.includes(item.periodLabel)) seen.push(item.periodLabel);
    }
    return seen;
  }, [items]);

  const [period, setPeriod] = useState<string>(defaultPeriod);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [active, setActive] = useState<ValidacaoRelatorioItem | null>(null);
  const [previewData, setPreviewData] = useState<OnePageReportPreviewData | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [note, setNote] = useState("");
  const [context, setContext] = useState("");

  const visible = useMemo(
    () => items.filter((i) => i.periodLabel === period),
    [items, period],
  );

  const pendentes = visible.filter((i) => !i.sentAt).length;

  const closeDialog = () => {
    setDialogMode(null);
    setActive(null);
    setPreviewData(null);
    setNote("");
    setContext("");
  };

  const runAction = async (
    item: ValidacaoRelatorioItem,
    body: Record<string, unknown>,
    successTitle: string,
  ) => {
    setBusyId(item.id);
    try {
      const r = await fetch(`/api/bi-validation/${item.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await r.json().catch(() => null)) as
        | { error?: string; recipients?: string[] }
        | null;
      if (!r.ok) {
        throw new Error(payload?.error ?? `Falha na operação (HTTP ${r.status}).`);
      }
      showToast({
        title: successTitle,
        description: payload?.recipients
          ? `Enviado para: ${payload.recipients.join(", ")}`
          : `${item.companyName} • ${item.periodLabel}`,
        variant: "success",
      });
      closeDialog();
      router.refresh();
    } catch (err) {
      showToast({
        title: "Não foi possível concluir",
        description: err instanceof Error ? err.message : "Erro inesperado.",
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  };

  const openPreview = async (item: ValidacaoRelatorioItem) => {
    setActive(item);
    setDialogMode("preview");
    setPreviewData(null);
    setPreviewLoading(true);
    try {
      const r = await fetch(`/api/bi-validation/${item.id}`, { cache: "no-store" });
      const payload = (await r.json().catch(() => null)) as
        | { report?: OnePageApiResponse; error?: string }
        | null;
      if (!r.ok || !payload?.report) {
        throw new Error(payload?.error ?? "Relatório indisponível.");
      }
      // Mesmo mapper da tela de Business Intelligence.
      setPreviewData(mapOnePageApiResponseToPreviewData(payload.report));
    } catch (err) {
      showToast({
        title: "Falha ao abrir o relatório",
        description: err instanceof Error ? err.message : "Erro inesperado.",
        variant: "destructive",
      });
      closeDialog();
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleGenerateMonth = async () => {
    setGenerating(true);
    try {
      const r = await fetch("/api/bi-validation/generate", { method: "POST" });
      const payload = (await r.json().catch(() => null)) as
        | {
            error?: string;
            generated?: number;
            skipped?: number;
            failed?: number;
            period?: string;
          }
        | null;
      if (!r.ok) throw new Error(payload?.error ?? `Falha (HTTP ${r.status}).`);
      const partes = [
        `${payload?.generated ?? 0} gerado(s)`,
        payload?.skipped ? `${payload.skipped} já pronto(s)` : null,
        payload?.failed ? `${payload.failed} com falha` : null,
      ].filter(Boolean);
      showToast({
        title: `Relatórios de ${payload?.period ?? "período"}`,
        description: `${partes.join(" • ")}.`,
        variant: payload?.failed ? "destructive" : "success",
      });
      router.refresh();
    } catch (err) {
      showToast({
        title: "Falha ao gerar relatórios",
        description: err instanceof Error ? err.message : "Erro inesperado.",
        variant: "destructive",
      });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="border-slate-200 shadow-sm">
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold text-ink-primary">Validação Relatório</h1>
              <p className="text-xs text-muted-foreground">
                Valide os relatórios BI do mês antes do envio aos gestores das unidades. Sem
                aceite até o dia 10, o Control Hub envia automaticamente a versão mais recente.
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <label
                  htmlFor="periodo-validacao"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Período
                </label>
                <select
                  id="periodo-validacao"
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                >
                  {periods.length === 0 ? <option value={period}>{period}</option> : null}
                  {periods.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={handleGenerateMonth}
                disabled={generating}
                title="Executa a mesma geração da rotina do dia 4 para o mês anterior. Relatórios já enviados não são regerados."
              >
                {generating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Gerando...
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2 h-4 w-4" />
                    Gerar relatórios do mês
                  </>
                )}
              </Button>
            </div>
          </div>

          {loadError ? (
            <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <div className="font-semibold">Falha ao carregar os relatórios</div>
                <div className="text-xs">{loadError}</div>
              </div>
            </div>
          ) : null}

          <p className="text-xs text-muted-foreground">
            {visible.length} relatório(s) no período · {pendentes} aguardando envio.
          </p>
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Empresa</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Destinatários</TableHead>
                <TableHead>Validação</TableHead>
                <TableHead>Envio</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                    Nenhum relatório gerado para {period}.
                  </TableCell>
                </TableRow>
              ) : (
                visible.map((item) => {
                  const busy = busyId === item.id;
                  const sent = Boolean(item.sentAt);
                  const accepted = Boolean(item.acceptedAt);
                  const hasReport = item.status !== "erro_geracao";
                  return (
                    <TableRow key={item.id}>
                      <TableCell>
                        <div className="font-medium text-ink-primary">{item.companyName}</div>
                        <div className="text-xs text-muted-foreground">
                          {item.periodLabel} · versão {item.version}
                          {item.hasContext ? " · com contexto" : ""}
                        </div>
                        {item.generationError ? (
                          <div className="mt-1 text-xs text-rose-700">{item.generationError}</div>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_CLASS[item.status]}`}
                        >
                          {STATUS_LABEL[item.status]}
                        </span>
                        {item.reviewNote ? (
                          <div className="mt-1 max-w-[220px] text-xs text-muted-foreground">
                            “{item.reviewNote}”
                          </div>
                        ) : null}
                        {/* A consequência de "Em revisão" é invisível sem isto:
                            é o único estado que impede o envio automático do
                            dia 10 — e, por isso, o único que exige ação do CSC
                            antes dessa data para o gestor receber algo. */}
                        {item.status === "em_revisao" ? (
                          <div className="mt-1 max-w-[220px] text-xs text-orange-700">
                            Não será enviado no dia 10. Corrija e clique em gerar
                            novamente, ou aceite para liberar o envio.
                          </div>
                        ) : null}
                        {item.sendError ? (
                          <div className="mt-1 max-w-[220px] text-xs text-rose-700">
                            {item.sendError}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        {item.recipients.length === 0 ? (
                          <span className="text-xs text-rose-700">
                            Nenhum destinatário cadastrado
                          </span>
                        ) : (
                          <div className="max-w-[240px] text-xs text-muted-foreground">
                            {item.recipients.join(", ")}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {accepted ? (
                          <>
                            Aceito por {item.acceptedBy ?? "—"}
                            <br />
                            {formatDateTime(item.acceptedAt)}
                          </>
                        ) : item.reviewAt ? (
                          <>
                            Revisão por {item.reviewBy ?? "—"}
                            <br />
                            {formatDateTime(item.reviewAt)}
                          </>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {sent ? (
                          <>
                            {item.sentMode === "automatico" ? "Automático" : "Manual"}
                            {item.sentBy ? ` · ${item.sentBy}` : ""}
                            <br />
                            {formatDateTime(item.sentAt)}
                            <br />
                            <span className="text-[11px]">
                              {item.sentRecipients.join(", ")}
                            </span>
                          </>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-wrap justify-end gap-1">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => void openPreview(item)}
                            disabled={!hasReport}
                            title="Abrir o relatório gerado (mesma visualização do Business Intelligence)."
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          {!sent ? (
                            <>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  void runAction(item, { action: "aceitar" }, "Relatório aceito")
                                }
                                disabled={busy || !hasReport || accepted}
                                title="Marcar como validado e liberar o envio ao gestor."
                              >
                                {busy ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                                )}
                                Aceitar
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setActive(item);
                                  setNote(item.reviewNote ?? "");
                                  setDialogMode("revisao");
                                }}
                                disabled={busy}
                                title="Segura o relatório: além de bloquear o envio manual, impede o envio automático do dia 10. Use quando o relatório tem um problema conhecido que ainda não foi corrigido."
                              >
                                <RotateCcw className="mr-1 h-3.5 w-3.5" />
                                Revisão
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setActive(item);
                                  setContext("");
                                  setDialogMode("contexto");
                                }}
                                disabled={busy || !hasReport}
                                title="Adicionar contexto de negócio para a IA reprocessar a análise textual."
                              >
                                <MessageSquarePlus className="mr-1 h-3.5 w-3.5" />
                                Contexto
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  void runAction(item, { action: "regerar" }, "Relatório regerado")
                                }
                                disabled={busy}
                                title="Gerar novamente com os dados atuais (após os ajustes na Omie)."
                              >
                                <RefreshCw className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                onClick={() =>
                                  void runAction(item, { action: "enviar" }, "Relatório enviado")
                                }
                                disabled={busy || !accepted || item.recipients.length === 0}
                                title={
                                  accepted
                                    ? "Enviar por e-mail aos destinatários desta empresa."
                                    : "Aceite o relatório para liberar o envio."
                                }
                              >
                                <Send className="mr-1 h-3.5 w-3.5" />
                                Enviar
                              </Button>
                            </>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Prévia do relatório — mesmo componente do Business Intelligence. */}
      <Dialog
        open={dialogMode === "preview"}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-[min(1000px,95vw)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {active?.companyName} — {active?.periodLabel}
            </DialogTitle>
            <DialogDescription>
              Mesma geração exibida no Business Intelligence e enviada por e-mail.
            </DialogDescription>
          </DialogHeader>
          {previewLoading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando relatório...
            </div>
          ) : previewData ? (
            <OnePageReportPreview data={previewData} />
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Revisão */}
      <Dialog
        open={dialogMode === "revisao"}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Marcar como em revisão</DialogTitle>
            <DialogDescription>
              {active?.companyName} — {active?.periodLabel}. Segura o relatório: ele não é
              enviado nem manualmente nem pela rotina automática do dia 10, até que seja
              gerado novamente e aceito. Um relatório apenas <em>não aceito</em> continua
              saindo no dia 10 — é este botão que impede isso.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <label htmlFor="revisao-motivo" className="text-xs font-medium text-muted-foreground">
              O que precisa ser revisado? (opcional)
            </label>
            <textarea
              id="revisao-motivo"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={4}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              placeholder="Ex.: faltou lançar a nota do fornecedor X; conferir a linha de despesas."
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeDialog}>
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={() =>
                active
                  ? void runAction(
                      active,
                      { action: "revisao", note },
                      "Marcado como em revisão",
                    )
                  : undefined
              }
              disabled={busyId !== null}
            >
              {busyId ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Confirmar revisão
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Adicionar contexto */}
      <Dialog
        open={dialogMode === "contexto"}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adicionar contexto</DialogTitle>
            <DialogDescription>
              {active?.companyName} — {active?.periodLabel}. O texto é enviado à IA junto com os
              dados desta empresa; a análise textual é reescrita considerando o contexto. Nenhum
              valor financeiro é alterado.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <label htmlFor="contexto-texto" className="text-xs font-medium text-muted-foreground">
              Contexto de negócio
            </label>
            <textarea
              id="contexto-texto"
              value={context}
              onChange={(e) => setContext(e.target.value)}
              rows={6}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              placeholder="Ex.: a queda de receita no mês é sazonal — dois eventos foram remarcados para o mês seguinte."
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeDialog}>
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={() =>
                active
                  ? void runAction(
                      active,
                      { action: "contexto", context },
                      "Relatório reprocessado com o contexto",
                    )
                  : undefined
              }
              disabled={busyId !== null || context.trim().length === 0}
            >
              {busyId ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Reprocessar com contexto
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
