"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Ban,
  CheckCircle2,
  Eye,
  History,
  Loader2,
  MessageSquarePlus,
  RefreshCw,
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
import { formatDateTimeBR } from "@/lib/ctrl/datetime";
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
  /**
   * Mensagem quando o canal de envio (Resend) NÃO está configurado; null
   * quando está tudo certo. Avaliado no servidor — o browser não enxerga as
   * variáveis de ambiente. Bloqueia o botão "Enviar" em vez de deixar o erro
   * aparecer só depois do aceite.
   */
  envioIndisponivel?: string | null;
}

// NOTA: o valor gravado no banco continua 'em_revisao' (constraint CHECK em
// bi_report_validations). Só o RÓTULO mudou, para dizer o que o estado de fato
// faz: impedir o envio, inclusive o automático do dia 10.
const STATUS_LABEL: Record<ValidacaoStatus, string> = {
  pendente_validacao: "Pendente de validação",
  em_revisao: "Envio bloqueado",
  contexto_adicionado: "Contexto adicionado",
  aceito: "Aceito",
  enviado_manual: "Enviado manualmente",
  enviado_automatico: "Enviado automaticamente",
  erro_envio: "Erro no envio",
  erro_geracao: "Erro na geração",
};

const STATUS_CLASS: Record<ValidacaoStatus, string> = {
  pendente_validacao: "bg-amber-100 text-amber-800",
  em_revisao: "bg-orange-600 text-white",
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

type DialogMode = "preview" | "revisao" | "contexto" | "historico" | null;

/** Um contexto de negócio registrado — vem de bi_report_validation_contexts. */
interface ContextHistoryEntry {
  id: string;
  text: string;
  /**
   * Versão do relatório gerada COM este texto. `null` = o texto ficou gravado
   * mas a regeração falhou, então ele ainda não influenciou nenhuma análise.
   */
  appliedVersion: number | null;
  createdAt: string;
  authorLabel: string;
}

/**
 * Lista de contextos já registrados, do mais recente para o mais antigo.
 * Usada no dialog "Histórico de contexto" e, em versão compacta, dentro do
 * dialog "Adicionar contexto".
 */
function ContextHistoryList({
  entries,
  loading,
  error,
  emptyMessage,
  compact = false,
}: {
  entries: ContextHistoryEntry[];
  loading: boolean;
  error: string | null;
  emptyMessage: string;
  compact?: boolean;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando histórico...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <div className="font-semibold">Falha ao carregar o histórico</div>
          <div className="text-xs">{error}</div>
        </div>
      </div>
    );
  }

  if (entries.length === 0) {
    return <p className="py-4 text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <ol className={compact ? "space-y-2" : "space-y-3"}>
      {entries.map((entry) => (
        <li
          key={entry.id}
          className="rounded-md border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-900/40"
        >
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
            <span className="font-semibold text-ink-primary">{entry.authorLabel}</span>
            <span aria-hidden>·</span>
            <span>{formatDateTimeBR(entry.createdAt)}</span>
            <span aria-hidden>·</span>
            {entry.appliedVersion ? (
              <span className="rounded-full bg-sky-100 px-2 py-0.5 font-semibold text-sky-800">
                aplicado na versão {entry.appliedVersion}
              </span>
            ) : (
              // Texto gravado sem regeração bem-sucedida: registrado, porém
              // ainda não considerado por nenhuma análise.
              <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-800">
                não aplicado
              </span>
            )}
          </div>
          <p
            className={`mt-1.5 whitespace-pre-wrap text-ink-primary ${compact ? "text-xs" : "text-sm"}`}
          >
            {entry.text}
          </p>
        </li>
      ))}
    </ol>
  );
}

export function ValidacaoRelatorioClient({
  items,
  defaultPeriod,
  loadError,
  envioIndisponivel,
}: Props) {
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

  // Histórico de contextos do relatório aberto (dialog "historico" e também o
  // resumo dentro do dialog "contexto").
  const [history, setHistory] = useState<ContextHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

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
    setHistory([]);
    setHistoryError(null);
  };

  /**
   * Carrega o histórico de contextos de UM relatório. Rota própria: o
   * histórico existe mesmo sem `report_json` (erro de geração) e continua
   * consultável depois do envio.
   */
  const loadHistory = async (item: ValidacaoRelatorioItem) => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const r = await fetch(`/api/bi-validation/${item.id}/contextos`, {
        cache: "no-store",
      });
      const payload = (await r.json().catch(() => null)) as
        | { contexts?: ContextHistoryEntry[]; error?: string }
        | null;
      if (!r.ok) {
        throw new Error(payload?.error ?? `Falha ao carregar (HTTP ${r.status}).`);
      }
      setHistory(payload?.contexts ?? []);
    } catch (err) {
      setHistory([]);
      setHistoryError(err instanceof Error ? err.message : "Erro inesperado.");
    } finally {
      setHistoryLoading(false);
    }
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

          {envioIndisponivel ? (
            <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <div className="font-semibold">Envio por e-mail indisponível</div>
                <div className="text-xs">{envioIndisponivel}</div>
                <div className="mt-1 text-xs">
                  Você ainda pode gerar, revisar, aceitar e bloquear relatórios — apenas o
                  envio está suspenso. Isso vale também para a rotina automática do dia 10.
                </div>
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
                          {/* Histórico de contexto — disponível SEMPRE, inclusive
                              depois do envio e quando a geração falhou: é
                              justamente aí que saber o que já foi informado à
                              IA importa. */}
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setActive(item);
                              setDialogMode("historico");
                              void loadHistory(item);
                            }}
                            title="Ver o histórico de contextos adicionados a este relatório."
                          >
                            <History className="h-3.5 w-3.5" />
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
                                  setContext("");
                                  setDialogMode("contexto");
                                  // O que já foi informado antes aparece no
                                  // próprio dialog: o contexto ACUMULA, então
                                  // repetir o que já vale só polui o prompt.
                                  void loadHistory(item);
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
                                disabled={
                                  busy ||
                                  !accepted ||
                                  item.recipients.length === 0 ||
                                  Boolean(envioIndisponivel)
                                }
                                title={
                                  envioIndisponivel
                                    ? "Canal de envio (Resend) não configurado — veja o aviso no topo da tela."
                                    : item.recipients.length === 0
                                      ? "Nenhum destinatário cadastrado para esta empresa em Plataforma > Relatório BI."
                                      : accepted
                                        ? "Enviar por e-mail aos destinatários desta empresa."
                                        : "Aceite o relatório para liberar o envio."
                                }
                              >
                                <Send className="mr-1 h-3.5 w-3.5" />
                                Enviar
                              </Button>

                              {/* Ação de EXCEÇÃO — separada do fluxo de rotina
                                  (aceitar / contexto / regerar / enviar) por um
                                  divisor e com tratamento de alerta. É o único
                                  freio do envio automático do dia 10, então
                                  precisa saltar aos olhos; mas justamente por
                                  parar o fluxo, não deve parecer um passo
                                  normal do dia a dia. */}
                              <span
                                aria-hidden
                                className="mx-1 h-6 w-px self-center bg-border"
                              />
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setActive(item);
                                  setNote(item.reviewNote ?? "");
                                  setDialogMode("revisao");
                                }}
                                disabled={busy || item.status === "em_revisao"}
                                className="border-orange-400 bg-orange-50 font-semibold text-orange-800 hover:bg-orange-100 hover:text-orange-900 dark:border-orange-900/50 dark:bg-orange-950/30 dark:text-orange-300"
                                title={
                                  item.status === "em_revisao"
                                    ? "O envio deste relatório já está bloqueado. Para liberar, gere novamente após o ajuste ou aceite."
                                    : "EXCEÇÃO: impede o envio deste relatório, inclusive o automático do dia 10. Use apenas quando houver um problema conhecido que ainda não foi corrigido."
                                }
                              >
                                <Ban className="mr-1 h-3.5 w-3.5" />
                                {item.status === "em_revisao"
                                  ? "Envio bloqueado"
                                  : "Bloquear envio"}
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
            <DialogTitle>Bloquear o envio deste relatório</DialogTitle>
            <DialogDescription>
              {active?.companyName} — {active?.periodLabel}. O relatório deixa de ser
              enviado: nem manualmente, nem pela rotina automática do dia 10. Um relatório
              apenas <em>não aceito</em> continua saindo no dia 10 — é este bloqueio que
              impede isso. Use só quando houver um problema conhecido que ainda não foi
              corrigido; para ajustes que você já vai fazer agora, basta corrigir e clicar
              em gerar novamente.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <label htmlFor="revisao-motivo" className="text-xs font-medium text-muted-foreground">
              Por que o envio está sendo bloqueado? (opcional)
            </label>
            <textarea
              id="revisao-motivo"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={4}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              placeholder="Ex.: aguardando o fechamento do evento X; nota do fornecedor Y ainda não lançada."
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
                      "Envio bloqueado",
                    )
                  : undefined
              }
              disabled={busyId !== null}
            >
              {busyId ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Bloquear envio
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

          {/* Contextos já registrados neste relatório. O novo texto SOMA aos
              anteriores (não os substitui) — ver addValidationContext. */}
          <div className="space-y-1.5 border-t border-slate-200 pt-3 dark:border-slate-800">
            <div className="text-xs font-medium text-muted-foreground">
              Contextos já registrados neste relatório
              {history.length > 0 ? ` (${history.length})` : ""}
            </div>
            <div className="max-h-48 overflow-y-auto pr-1">
              <ContextHistoryList
                entries={history}
                loading={historyLoading}
                error={historyError}
                emptyMessage="Nenhum contexto foi adicionado a este relatório até agora."
                compact
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              O texto novo é somado aos anteriores — todos continuam valendo na
              próxima análise.
            </p>
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

      {/* Histórico de contexto — consulta, sem ação. */}
      <Dialog
        open={dialogMode === "historico"}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
      >
        <DialogContent className="max-h-[85vh] max-w-[min(720px,95vw)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Histórico de contexto</DialogTitle>
            <DialogDescription>
              {active?.companyName} — {active?.periodLabel}. Tudo o que foi informado à IA
              sobre este relatório, do mais recente para o mais antigo. Os textos ficam
              guardados mesmo depois do envio.
            </DialogDescription>
          </DialogHeader>
          <ContextHistoryList
            entries={history}
            loading={historyLoading}
            error={historyError}
            emptyMessage="Nenhum contexto foi adicionado a este relatório até agora."
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeDialog}>
              Fechar
            </Button>
            {active && !active.sentAt ? (
              <Button
                type="button"
                onClick={() => {
                  setContext("");
                  setDialogMode("contexto");
                }}
                disabled={active.status === "erro_geracao"}
                title={
                  active.status === "erro_geracao"
                    ? "Gere o relatório antes de adicionar contexto."
                    : "Adicionar um novo contexto a este relatório."
                }
              >
                <MessageSquarePlus className="mr-1 h-3.5 w-3.5" />
                Adicionar contexto
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
