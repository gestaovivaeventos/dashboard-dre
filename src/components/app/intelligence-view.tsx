"use client";

import { useEffect, useState } from "react";
import { Loader2, RefreshCw, Send } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { ContactsManager } from "@/components/app/contacts-manager";
import { ReportPreview } from "@/components/app/report-preview";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Company {
  id: string;
  name: string;
}

interface Segment {
  id: string;
  name: string;
}

interface IntelligenceViewProps {
  companies: Company[];
  segments: Segment[];
}

type TabId = "relatorio" | "comparativo" | "projecoes" | "historico";

interface HistoryReport {
  id: string;
  type: string;
  companies: string[];
  period: string;
  sent_at: string | null;
  status: "sent" | "draft" | "error";
  html?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CURRENT_YEAR = new Date().getFullYear();
const CURRENT_MONTH = new Date().getMonth() + 1;

const MONTHS = [
  { value: "1", label: "Janeiro" },
  { value: "2", label: "Fevereiro" },
  { value: "3", label: "Marco" },
  { value: "4", label: "Abril" },
  { value: "5", label: "Maio" },
  { value: "6", label: "Junho" },
  { value: "7", label: "Julho" },
  { value: "8", label: "Agosto" },
  { value: "9", label: "Setembro" },
  { value: "10", label: "Outubro" },
  { value: "11", label: "Novembro" },
  { value: "12", label: "Dezembro" },
];

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function statusBadge(status: HistoryReport["status"]) {
  if (status === "sent") return <Badge variant="default">Enviado</Badge>;
  if (status === "error") return <Badge variant="destructive">Erro</Badge>;
  return <Badge variant="secondary">Rascunho</Badge>;
}

function typeBadge(type: string) {
  const labels: Record<string, string> = {
    relatorio: "Relatorio",
    comparativo: "Comparativo",
    projecao: "Projecao",
  };
  return <Badge variant="outline">{labels[type] ?? type}</Badge>;
}

// ---------------------------------------------------------------------------
// Tab button
// ---------------------------------------------------------------------------

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
        active
          ? "border-primary text-primary"
          : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground"
      }`}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function IntelligenceView({ companies, segments }: IntelligenceViewProps) {
  const [activeTab, setActiveTab] = useState<TabId>("relatorio");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Inteligencia</h2>
        <p className="text-sm text-muted-foreground">
          Gere relatorios inteligentes, analises comparativas e projecoes financeiras.
        </p>
      </div>

      {/* Tab bar */}
      <div className="border-b flex gap-0">
        <TabButton active={activeTab === "relatorio"} onClick={() => setActiveTab("relatorio")}>
          Relatorio
        </TabButton>
        <TabButton active={activeTab === "comparativo"} onClick={() => setActiveTab("comparativo")}>
          Comparativo
        </TabButton>
        <TabButton active={activeTab === "projecoes"} onClick={() => setActiveTab("projecoes")}>
          Projecoes
        </TabButton>
        <TabButton active={activeTab === "historico"} onClick={() => setActiveTab("historico")}>
          Historico
        </TabButton>
      </div>

      {/* Tab panels */}
      {activeTab === "relatorio" && (
        <RelatorioTab companies={companies} />
      )}
      {activeTab === "comparativo" && (
        <ComparativoTab segments={segments} />
      )}
      {activeTab === "projecoes" && (
        <ProjecoesTab companies={companies} />
      )}
      {activeTab === "historico" && (
        <HistoricoTab />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 1: Relatorio
// ---------------------------------------------------------------------------

function RelatorioTab({ companies }: { companies: Company[] }) {
  const [companyId, setCompanyId] = useState<string>("");
  const [month, setMonth] = useState<string>(String(CURRENT_MONTH));
  const [year, setYear] = useState<string>(String(CURRENT_YEAR));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportId, setReportId] = useState<string | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [emailInput, setEmailInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sendMessage, setSendMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  const selectedCompany = companies.find((c) => c.id === companyId) ?? null;

  const generateReport = async () => {
    if (!companyId) {
      setError("Selecione uma empresa.");
      return;
    }
    const yearNum = parseInt(year, 10);
    if (!yearNum || yearNum < 2000 || yearNum > 2100) {
      setError("Informe um ano valido.");
      return;
    }
    setLoading(true);
    setError(null);
    setReportId(null);
    setHtml(null);
    setSendMessage(null);
    try {
      const dateFrom = `${yearNum}-${String(parseInt(month, 10)).padStart(2, "0")}-01`;
      // Last day of month
      const lastDay = new Date(yearNum, parseInt(month, 10), 0).getDate();
      const dateTo = `${yearNum}-${String(parseInt(month, 10)).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
      const periodLabel = `${MONTHS.find((m) => m.value === month)?.label ?? month}/${yearNum}`;

      const response = await fetch("/api/intelligence/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "relatorio",
          companyIds: [companyId],
          dateFrom,
          dateTo,
          periodLabel,
        }),
      });
      const payload = (await response.json()) as { reportId?: string; html?: string; error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Falha ao gerar relatorio.");
        return;
      }
      setReportId(payload.reportId ?? null);
      setHtml(payload.html ?? null);
    } catch {
      setError("Erro de conexao ao gerar relatorio.");
    } finally {
      setLoading(false);
    }
  };

  const sendReport = async () => {
    if (!reportId) return;
    const emails = emailInput
      .split(/[\s,;]+/)
      .map((e) => e.trim())
      .filter(Boolean);
    if (emails.length === 0) {
      setSendMessage({ text: "Informe ao menos um e-mail.", type: "error" });
      return;
    }
    setSending(true);
    setSendMessage(null);
    try {
      const response = await fetch("/api/intelligence/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportId, emails }),
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok) {
        setSendMessage({ text: payload.error ?? "Falha ao enviar relatorio.", type: "error" });
        return;
      }
      setSendMessage({ text: "Relatorio enviado com sucesso!", type: "success" });
      setEmailInput("");
    } catch {
      setSendMessage({ text: "Erro de conexao ao enviar relatorio.", type: "error" });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Form */}
      <div className="rounded-lg border bg-background p-4 space-y-4">
        <h3 className="font-medium">Gerar Relatorio Mensal</h3>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label>Empresa</Label>
            <Select value={companyId} onValueChange={setCompanyId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione..." />
              </SelectTrigger>
              <SelectContent>
                {companies.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Mes</Label>
            <Select value={month} onValueChange={setMonth}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONTHS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="relatorio-ano">Ano</Label>
            <Input
              id="relatorio-ano"
              type="number"
              min={2000}
              max={2100}
              value={year}
              onChange={(e) => setYear(e.target.value)}
            />
          </div>
        </div>

        {error ? (
          <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
            {error}
          </div>
        ) : null}

        <Button type="button" onClick={() => void generateReport()} disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Gerar Relatorio
        </Button>

        {/* Contacts manager — shows once a company is selected */}
        {companyId && selectedCompany ? (
          <div className="pt-2 border-t">
            <ContactsManager companyId={companyId} companyName={selectedCompany.name} />
          </div>
        ) : null}
      </div>

      {/* Report preview + send */}
      {html ? (
        <div className="space-y-4">
          <ReportPreview html={html} />

          <div className="rounded-lg border bg-background p-4 space-y-4">
            <h3 className="font-medium">Enviar por E-mail</h3>
            <div className="space-y-2">
              <Label htmlFor="relatorio-emails">
                Destinatarios (separe por virgula ou espaco)
              </Label>
              <Input
                id="relatorio-emails"
                type="text"
                placeholder="email1@empresa.com, email2@empresa.com"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
              />
            </div>

            {sendMessage ? (
              <div
                className={`rounded border px-3 py-2 text-sm ${
                  sendMessage.type === "error"
                    ? "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
                    : "border-green-200 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950/30 dark:text-green-300"
                }`}
              >
                {sendMessage.text}
              </div>
            ) : null}

            <Button type="button" onClick={() => void sendReport()} disabled={sending}>
              {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              Enviar por Email
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 2: Comparativo
// ---------------------------------------------------------------------------

function ComparativoTab({ segments }: { segments: Segment[] }) {
  const [segmentId, setSegmentId] = useState<string>("todos");
  const [month, setMonth] = useState<string>(String(CURRENT_MONTH));
  const [year, setYear] = useState<string>(String(CURRENT_YEAR));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [html, setHtml] = useState<string | null>(null);

  const generateComparativo = async () => {
    const yearNum = parseInt(year, 10);
    if (!yearNum || yearNum < 2000 || yearNum > 2100) {
      setError("Informe um ano valido.");
      return;
    }
    setLoading(true);
    setError(null);
    setHtml(null);

    try {
      const dateFrom = `${yearNum}-${String(parseInt(month, 10)).padStart(2, "0")}-01`;
      const lastDay = new Date(yearNum, parseInt(month, 10), 0).getDate();
      const dateTo = `${yearNum}-${String(parseInt(month, 10)).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
      const periodLabel = `${MONTHS.find((m) => m.value === month)?.label ?? month}/${yearNum}`;

      const body: Record<string, unknown> = {
        type: "comparativo",
        companyIds: [],
        dateFrom,
        dateTo,
        periodLabel,
      };

      if (segmentId !== "todos") {
        body.segmentName = segments.find((s) => s.id === segmentId)?.name ?? segmentId;
      }

      const response = await fetch("/api/intelligence/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as { reportId?: string; html?: string; error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Falha ao gerar comparativo.");
        return;
      }
      setHtml(payload.html ?? null);
    } catch {
      setError("Erro de conexao ao gerar comparativo.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg border bg-background p-4 space-y-4">
        <h3 className="font-medium">Gerar Relatorio Comparativo</h3>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label>Segmento</Label>
            <Select value={segmentId} onValueChange={setSegmentId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os segmentos</SelectItem>
                {segments.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Mes</Label>
            <Select value={month} onValueChange={setMonth}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONTHS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="comparativo-ano">Ano</Label>
            <Input
              id="comparativo-ano"
              type="number"
              min={2000}
              max={2100}
              value={year}
              onChange={(e) => setYear(e.target.value)}
            />
          </div>
        </div>

        {error ? (
          <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
            {error}
          </div>
        ) : null}

        <Button type="button" onClick={() => void generateComparativo()} disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Gerar Comparativo
        </Button>
      </div>

      {html ? <ReportPreview html={html} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 3: Projecoes
// ---------------------------------------------------------------------------

function ProjecoesTab({ companies }: { companies: Company[] }) {
  const [companyId, setCompanyId] = useState<string>("");
  const [horizon, setHorizon] = useState<string>("6");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [html, setHtml] = useState<string | null>(null);

  const generateProjecao = async () => {
    if (!companyId) {
      setError("Selecione uma empresa.");
      return;
    }
    setLoading(true);
    setError(null);
    setHtml(null);

    try {
      const response = await fetch("/api/intelligence/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "projecao",
          companyIds: [companyId],
          horizonMonths: parseInt(horizon, 10),
        }),
      });
      const payload = (await response.json()) as { reportId?: string; html?: string; error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Falha ao gerar projecao.");
        return;
      }
      setHtml(payload.html ?? null);
    } catch {
      setError("Erro de conexao ao gerar projecao.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg border bg-background p-4 space-y-4">
        <h3 className="font-medium">Gerar Projecao Financeira</h3>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Empresa</Label>
            <Select value={companyId} onValueChange={setCompanyId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione..." />
              </SelectTrigger>
              <SelectContent>
                {companies.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Horizonte</Label>
            <Select value={horizon} onValueChange={setHorizon}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="3">3 meses</SelectItem>
                <SelectItem value="6">6 meses</SelectItem>
                <SelectItem value="12">12 meses</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {error ? (
          <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
            {error}
          </div>
        ) : null}

        <Button type="button" onClick={() => void generateProjecao()} disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Gerar Projecao
        </Button>
      </div>

      {html ? <ReportPreview html={html} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 4: Historico
// ---------------------------------------------------------------------------

function HistoricoTab() {
  const [reports, setReports] = useState<HistoryReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [resending, setResending] = useState<string | null>(null);
  const [resendMessage, setResendMessage] = useState<{ id: string; text: string; type: "success" | "error" } | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    void loadHistory(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const loadHistory = async (pageNum: number) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/intelligence/history?page=${pageNum}`);
      const payload = (await response.json()) as {
        reports?: HistoryReport[];
        page?: number;
        totalPages?: number;
        error?: string;
      };
      if (!response.ok) {
        setError(payload.error ?? "Falha ao carregar historico.");
        return;
      }
      setReports(payload.reports ?? []);
      setPage(payload.page ?? pageNum);
      setTotalPages(payload.totalPages ?? 1);
    } catch {
      setError("Erro de conexao ao carregar historico.");
    } finally {
      setLoading(false);
    }
  };

  const resendReport = async (report: HistoryReport) => {
    setResending(report.id);
    setResendMessage(null);
    try {
      const response = await fetch("/api/intelligence/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportId: report.id }),
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok) {
        setResendMessage({ id: report.id, text: payload.error ?? "Falha ao reenviar.", type: "error" });
        return;
      }
      setResendMessage({ id: report.id, text: "Reenviado com sucesso.", type: "success" });
    } catch {
      setResendMessage({ id: report.id, text: "Erro de conexao.", type: "error" });
    } finally {
      setResending(null);
    }
  };

  const openPreview = (html: string) => {
    setPreviewHtml(html);
    setPreviewOpen(true);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="font-medium">Historico de Relatorios</h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void loadHistory(page)}
          disabled={loading}
        >
          <RefreshCw className={`mr-2 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      {error ? (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground justify-center">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando historico...
        </div>
      ) : (
        <>
          <div className="rounded-lg border bg-background">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="hidden md:table-cell">Empresas</TableHead>
                  <TableHead className="hidden sm:table-cell">Periodo</TableHead>
                  <TableHead className="hidden lg:table-cell">Enviado em</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Acoes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reports.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                      Nenhum relatorio encontrado.
                    </TableCell>
                  </TableRow>
                ) : (
                  reports.map((report) => (
                    <TableRow key={report.id}>
                      <TableCell>{typeBadge(report.type)}</TableCell>
                      <TableCell className="hidden md:table-cell">
                        <span className="text-sm text-muted-foreground">
                          {report.companies?.join(", ") || "—"}
                        </span>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <span className="text-sm">{report.period || "—"}</span>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <span className="text-sm text-muted-foreground">
                          {formatDate(report.sent_at)}
                        </span>
                      </TableCell>
                      <TableCell>{statusBadge(report.status)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {/* Resend button — only for sent reports */}
                          {report.status === "sent" ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => void resendReport(report)}
                              disabled={resending === report.id}
                              title="Reenviar"
                            >
                              {resending === report.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Send className="h-3.5 w-3.5" />
                              )}
                            </Button>
                          ) : null}

                          {/* Preview button */}
                          {report.html ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => openPreview(report.html!)}
                            >
                              Visualizar
                            </Button>
                          ) : null}
                        </div>

                        {/* Inline resend feedback */}
                        {resendMessage?.id === report.id ? (
                          <p
                            className={`mt-1 text-xs ${
                              resendMessage.type === "error" ? "text-red-600" : "text-green-600"
                            }`}
                          >
                            {resendMessage.text}
                          </p>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {totalPages > 1 ? (
            <div className="flex items-center justify-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
                Anterior
              </Button>
              <span className="text-sm text-muted-foreground">
                Pagina {page} de {totalPages}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
              >
                Proxima
              </Button>
            </div>
          ) : null}
        </>
      )}

      {/* Preview dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Visualizar Relatorio</DialogTitle>
          </DialogHeader>
          {previewHtml ? <ReportPreview html={previewHtml} /> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
