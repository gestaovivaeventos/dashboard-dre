"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Download,
  FileSpreadsheet,
  FileText,
  Loader2,
  Trash2,
  Upload,
} from "lucide-react";

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
import { Input } from "@/components/ui/input";
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
import { useToast } from "@/components/ui/toaster";

// ============================================================================
// DocumentosAnexosClient — filtro de empresa + listagem de documentos anexos.
//
// - O seletor de empresa ja vem filtrado pela permissao do usuario (resolvido
//   no server). Franqueado ve apenas suas empresas.
// - Ao escolher uma empresa, busca /api/financeiro/documentos?companyId=... e
//   lista SOMENTE os documentos daquela empresa (separacao garantida tambem no
//   backend).
// - Upload e exclusao aparecem apenas para admin (canManage). O backend revalida.
// ============================================================================

interface CompanyOption {
  id: string;
  name: string;
}

interface DocumentItem {
  id: string;
  company_id: string;
  file_name: string;
  file_type: string | null;
  size_bytes: number | null;
  uploaded_by_name: string | null;
  reference_date: string | null;
  created_at: string;
}

interface DocumentosAnexosClientProps {
  companies: CompanyOption[];
  canManage: boolean;
}

const ACCEPT = ".pdf,.xls,.xlsx,.csv";

function formatBytes(bytes: number | null): string {
  if (!bytes && bytes !== 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatRefDate(value: string | null): string {
  if (!value) return "—";
  // value vem como "YYYY-MM-DD" (1o dia do mes) — exibe como mes/ano.
  const [y, m] = value.split("-");
  if (!y || !m) return value;
  return `${m}/${y}`;
}

// Aplica mascara "mm/aaaa" ao texto digitado (so digitos, barra automatica).
function maskMonthYear(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 6); // MMAAAA
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

// "mm/aaaa" digitado -> "AAAA-MM" para a API. null se incompleto/invalido.
function monthYearToApi(value: string): string | null {
  const m = value.trim().match(/^(0[1-9]|1[0-2])\/(\d{4})$/);
  if (!m) return null;
  return `${m[2]}-${m[1]}`;
}

function isSpreadsheet(doc: DocumentItem): boolean {
  const t = (doc.file_type ?? "").toLowerCase();
  const n = doc.file_name.toLowerCase();
  return (
    t.includes("spreadsheet") ||
    t.includes("excel") ||
    t.includes("csv") ||
    n.endsWith(".xls") ||
    n.endsWith(".xlsx") ||
    n.endsWith(".csv")
  );
}

export function DocumentosAnexosClient({
  companies,
  canManage,
}: DocumentosAnexosClientProps) {
  const { showToast } = useToast();
  const [companyId, setCompanyId] = useState<string>("");
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Filtro opcional por mes/ano de referencia ("YYYY-MM"). Disponivel a todos.
  const [refMonth, setRefMonth] = useState<string>("");

  // Modal de upload (admin). Coleta arquivo + mes/ano antes de enviar.
  const [uploadOpen, setUploadOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  // Mes/ano de referencia do documento — OBRIGATORIO no upload. E a unica
  // fonte da referencia consultada no filtro.
  const [uploadRefMonth, setUploadRefMonth] = useState<string>("");

  const selectedCompany = companies.find((c) => c.id === companyId) ?? null;

  function resetUploadForm() {
    setPendingFile(null);
    setUploadRefMonth("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const loadDocuments = useCallback(
    async (id: string, ref: string) => {
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams({ companyId: id });
        if (ref) qs.set("ref", ref);
        const res = await fetch(`/api/financeiro/documentos?${qs.toString()}`, {
          cache: "no-store",
        });
        const json = await res.json();
        if (!res.ok) {
          throw new Error(json.error ?? "Falha ao carregar documentos.");
        }
        setDocuments(json.documents ?? []);
      } catch (err) {
        setDocuments([]);
        setError(err instanceof Error ? err.message : "Falha ao carregar documentos.");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // So aplica o filtro quando o texto digitado e um mes/ano valido; vazio ou
  // incompleto = sem restricao (carrega todos). Memoizado para nao refazer a
  // busca a cada tecla enquanto o usuario ainda esta digitando.
  const refApi = monthYearToApi(refMonth) ?? "";

  useEffect(() => {
    if (companyId) {
      void loadDocuments(companyId, refApi);
    } else {
      setDocuments([]);
    }
  }, [companyId, refApi, loadDocuments]);

  async function handleUpload() {
    if (!companyId) {
      showToast({ title: "Selecione uma empresa antes de enviar.", variant: "destructive" });
      return;
    }
    if (!pendingFile) {
      showToast({ title: "Escolha um arquivo para enviar.", variant: "destructive" });
      return;
    }
    const apiMonth = monthYearToApi(uploadRefMonth);
    if (!apiMonth) {
      showToast({
        title: "Informe a data de referência no formato mm/aaaa.",
        variant: "destructive",
      });
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("companyId", companyId);
      form.append("file", pendingFile);
      form.append("referenceDate", apiMonth);
      const res = await fetch("/api/financeiro/documentos", {
        method: "POST",
        body: form,
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error ?? "Falha no upload.");
      }
      showToast({ title: "Documento enviado com sucesso." });
      setUploadOpen(false);
      resetUploadForm();
      await loadDocuments(companyId, refMonth);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Falha no upload.";
      showToast({ title: "Não foi possível enviar.", description: msg, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(doc: DocumentItem) {
    if (!window.confirm(`Excluir o documento "${doc.file_name}"?`)) return;
    try {
      const res = await fetch(
        `/api/financeiro/documentos?id=${encodeURIComponent(doc.id)}`,
        { method: "DELETE" },
      );
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error ?? "Falha ao excluir.");
      }
      showToast({ title: "Documento excluído." });
      setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Falha ao excluir.";
      showToast({ title: "Não foi possível excluir.", description: msg, variant: "destructive" });
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Documentos anexos</h1>
        <p className="text-sm text-muted-foreground">
          Selecione uma empresa para visualizar os documentos vinculados a ela.
          {canManage
            ? " Como administrador, você pode anexar novos documentos (PDF ou Excel)."
            : " A visualização respeita as empresas às quais você tem acesso."}
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-4 p-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:flex-wrap">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Empresa / unidade</label>
              <Select value={companyId} onValueChange={setCompanyId}>
                <SelectTrigger className="w-64">
                  <SelectValue placeholder="Selecione uma empresa" />
                </SelectTrigger>
                <SelectContent>
                  {companies.length === 0 ? (
                    <div className="px-2 py-1.5 text-sm text-muted-foreground">
                      Nenhuma empresa disponível.
                    </div>
                  ) : (
                    companies.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* Filtro opcional por mes/ano de referencia — disponivel a todos. */}
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Data de referência</label>
              <div className="flex items-center gap-2">
                <Input
                  type="text"
                  inputMode="numeric"
                  placeholder="mm/aaaa"
                  maxLength={7}
                  value={refMonth}
                  onChange={(e) => setRefMonth(maskMonthYear(e.target.value))}
                  className="w-32"
                  aria-label="Filtrar por mês/ano de referência (mm/aaaa)"
                />
                {refMonth && (
                  <Button variant="ghost" size="sm" onClick={() => setRefMonth("")}>
                    Limpar
                  </Button>
                )}
              </div>
            </div>
          </div>

          {canManage ? (
            <Button
              onClick={() => setUploadOpen(true)}
              disabled={!companyId}
              title={!companyId ? "Selecione uma empresa primeiro" : undefined}
            >
              <Upload className="mr-2 h-4 w-4" />
              Enviar documento
            </Button>
          ) : null}
        </CardContent>
      </Card>

      {error ? (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      <Card>
        <CardContent className="p-0">
          {!companyId ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Selecione uma empresa para listar seus documentos.
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando documentos…
            </div>
          ) : documents.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Nenhum documento anexado para {selectedCompany?.name ?? "esta empresa"}.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Arquivo</TableHead>
                  <TableHead>Tamanho</TableHead>
                  <TableHead>Enviado por</TableHead>
                  <TableHead>Data de upload</TableHead>
                  <TableHead>Data de referência</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.map((doc) => (
                  <TableRow key={doc.id}>
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-2">
                        {isSpreadsheet(doc) ? (
                          <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
                        ) : (
                          <FileText className="h-4 w-4 text-red-600" />
                        )}
                        {doc.file_name}
                      </span>
                    </TableCell>
                    <TableCell>{formatBytes(doc.size_bytes)}</TableCell>
                    <TableCell>{doc.uploaded_by_name ?? "—"}</TableCell>
                    <TableCell>{formatDate(doc.created_at)}</TableCell>
                    <TableCell>{formatRefDate(doc.reference_date)}</TableCell>
                    <TableCell className="text-right">
                      <span className="inline-flex items-center justify-end gap-1">
                        <a
                          href={`/api/financeiro/documentos/${doc.id}/download`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <Button variant="ghost" size="sm">
                            <Download className="mr-1 h-4 w-4" />
                            Baixar
                          </Button>
                        </a>
                        {canManage ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void handleDelete(doc)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        ) : null}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Modal de upload — coleta arquivo + mês/ano antes de enviar. */}
      <Dialog
        open={uploadOpen}
        onOpenChange={(open) => {
          if (uploading) return;
          setUploadOpen(open);
          if (!open) resetUploadForm();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enviar documento</DialogTitle>
            <DialogDescription>
              {selectedCompany
                ? `O documento será vinculado a ${selectedCompany.name}.`
                : "Selecione uma empresa antes de enviar."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Data de referência (mês/ano)</label>
              <Input
                type="text"
                inputMode="numeric"
                placeholder="mm/aaaa"
                maxLength={7}
                value={uploadRefMonth}
                onChange={(e) => setUploadRefMonth(maskMonthYear(e.target.value))}
                className="w-32"
                aria-label="Data de referência (mm/aaaa) do documento"
              />
              <p className="text-xs text-muted-foreground">Obrigatório. Formato mm/aaaa.</p>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Arquivo</label>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPT}
                className="hidden"
                onChange={(e) => setPendingFile(e.target.files?.[0] ?? null)}
              />
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                  Escolher arquivo
                </Button>
                <span className="truncate text-sm text-muted-foreground">
                  {pendingFile ? pendingFile.name : "Nenhum arquivo selecionado"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">PDF ou Excel (.pdf, .xls, .xlsx, .csv).</p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setUploadOpen(false);
                resetUploadForm();
              }}
              disabled={uploading}
            >
              Cancelar
            </Button>
            <Button
              onClick={() => void handleUpload()}
              disabled={!companyId || !pendingFile || !monthYearToApi(uploadRefMonth) || uploading}
            >
              {uploading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-2 h-4 w-4" />
              )}
              Enviar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
