"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Upload, AlertCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/toaster";

interface BudgetUploadProps {
  defaultYear: number;
}

interface UploadError {
  message: string;
  unknownSectors?: string[];
  unknownTypes?: string[];
}

export function BudgetUpload({ defaultYear }: BudgetUploadProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const [year, setYear] = useState(String(defaultYear));
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<UploadError | null>(null);
  const [createdTypes, setCreatedTypes] = useState<string[]>([]);
  const [removedTypes, setRemovedTypes] = useState<string[]>([]);
  const [keptTypesWithRequests, setKeptTypesWithRequests] = useState<string[]>([]);

  const years = [defaultYear - 1, defaultYear, defaultYear + 1].map(String);

  async function handleSubmit() {
    if (!file) {
      showToast({ title: "Selecione um arquivo .xlsx.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    setError(null);
    setCreatedTypes([]);
    setRemovedTypes([]);
    setKeptTypesWithRequests([]);

    const fd = new FormData();
    fd.append("file", file);
    fd.append("year", year);

    try {
      const res = await fetch("/api/ctrl/budget", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setError({
          message: data.error ?? "Falha no upload.",
          unknownSectors: data.unknownSectors,
          unknownTypes: data.unknownTypes,
        });
        showToast({ title: data.error ?? "Falha no upload.", variant: "destructive" });
        return;
      }
      const fmt = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
      const extras: string[] = [];
      if (data.createdTypes?.length) extras.push(`${data.createdTypes.length} tipo(s) criado(s)`);
      if (data.removedTypes?.length) extras.push(`${data.removedTypes.length} tipo(s) removido(s)`);
      if (data.skippedBlankType) extras.push(`${data.skippedBlankType} linha(s) sem tipo ignorada(s)`);
      const realizadoMsg = data.totalRealized ? ` — realizado ${fmt.format(data.totalRealized)}` : "";
      showToast({
        title: `Orçamento ${data.year} importado`,
        description:
          `${data.entriesInserted} lançamentos — orçado ${fmt.format(data.totalAmount)}${realizadoMsg}.` +
          (extras.length ? ` (${extras.join("; ")})` : ""),
      });
      if (data.createdTypes?.length) setCreatedTypes(data.createdTypes);
      if (data.removedTypes?.length) setRemovedTypes(data.removedTypes);
      if (data.keptTypesWithRequests?.length) setKeptTypesWithRequests(data.keptTypesWithRequests);
      setFile(null);
      router.refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro inesperado.";
      setError({ message: msg });
      showToast({ title: msg, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-lg border p-4">
      <h2 className="mb-4 text-base font-semibold">Subir orçamento base</h2>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Planilha .xlsx com colunas <strong>Setor</strong>, <strong>Tipo de Despesa</strong>,{" "}
          <strong>Data</strong> (mês) e <strong>Valor orçado</strong> — uma linha por mês. Também aceita
          o modelo gerado pelo sistema (Setor, Tipo de Despesa, Jan…Dez). Tipos de despesa que não
          existirem no cadastro são <strong>criados automaticamente</strong>. O upload{" "}
          <strong>substitui todo o orçamento do ano selecionado</strong>.
        </p>

        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Ano</label>
            <Select value={year} onValueChange={setYear}>
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {years.map((y) => (
                  <SelectItem key={y} value={y}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            variant="secondary"
            onClick={() => { window.location.href = `/api/ctrl/budget/template?year=${year}`; }}
          >
            <Download className="mr-2 h-4 w-4" />
            Baixar modelo
          </Button>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Arquivo</label>
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-muted/80"
            />
          </div>

          <Button onClick={handleSubmit} disabled={submitting || !file}>
            <Upload className="mr-2 h-4 w-4" />
            {submitting ? "Enviando..." : "Subir orçamento"}
          </Button>
        </div>

        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <p className="flex items-center gap-2 font-medium text-destructive">
              <AlertCircle className="h-4 w-4" />
              {error.message}
            </p>
            {error.unknownSectors && error.unknownSectors.length > 0 && (
              <p className="mt-2 text-muted-foreground">
                <strong>Setores não encontrados:</strong> {error.unknownSectors.join(", ")}
              </p>
            )}
            {error.unknownTypes && error.unknownTypes.length > 0 && (
              <p className="mt-1 text-muted-foreground">
                <strong>Tipos de despesa não encontrados:</strong> {error.unknownTypes.join(", ")}
              </p>
            )}
          </div>
        )}

        {createdTypes.length > 0 && (
          <div className="rounded-md border border-sky-500/40 bg-sky-500/5 p-3 text-sm">
            <p className="font-medium text-sky-700">
              {createdTypes.length} tipo(s) de despesa criado(s) automaticamente
            </p>
            <p className="mt-1 text-muted-foreground">
              {createdTypes.join(", ")}. Revise em Admin → Tipos de Despesa se algum for duplicado de
              um nome já existente.
            </p>
          </div>
        )}

        {removedTypes.length > 0 && (
          <div className="rounded-md border border-muted-foreground/30 bg-muted/30 p-3 text-sm">
            <p className="font-medium">
              {removedTypes.length} tipo(s) de despesa removido(s) (não constavam no orçamento)
            </p>
            <p className="mt-1 text-muted-foreground">{removedTypes.join(", ")}.</p>
          </div>
        )}

        {keptTypesWithRequests.length > 0 && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
            <p className="font-medium text-amber-700">
              {keptTypesWithRequests.length} tipo(s) mantido(s) por terem requisições vinculadas
            </p>
            <p className="mt-1 text-muted-foreground">
              {keptTypesWithRequests.join(", ")}. Não estavam no orçamento, mas têm requisições e por
              isso não foram removidos.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
