"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Loader2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toaster";

interface Props {
  /** Id do lote pendente, se houver — bloqueia novo upload. */
  pendingBatchId: string | null;
}

export function VbImportUpload({ pendingBatchId }: Props) {
  const router = useRouter();
  const { showToast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!file) return;
    setBusy(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/vb/import", { method: "POST", body: formData });
      const json = (await res.json().catch(() => ({}))) as { batchId?: string; error?: string };
      if (!res.ok || !json.batchId) {
        showToast({ title: "Importação não iniciada", description: json.error ?? "Falha ao enviar o arquivo.", variant: "destructive" });
        return;
      }
      showToast({ title: "Planilha lida", description: "Revise os lançamentos antes de aprovar.", variant: "success" });
      router.push(`/vb/importar/${json.batchId}`);
    } finally {
      setBusy(false);
    }
  }

  if (pendingBatchId) {
    return (
      <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-ink-primary">
        Há um lote pendente de revisão. Aprove ou descarte-o antes de importar outra planilha.{" "}
        <Link href={`/vb/importar/${pendingBatchId}`} className="font-medium underline">
          Abrir revisão
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface-1 p-4">
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx"
        className="text-sm"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        disabled={busy}
      />
      <Button type="button" onClick={submit} disabled={!file || busy}>
        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
        Importar planilha
      </Button>
      <p className="basis-full text-xs text-ink-muted">
        Só abas com o cabeçalho DATA | DATA | DIAS | DESCRIÇÃO | ENTRADA | SAÍDA | RENDIMENTO | SALDO na linha 4
        são lidas. Credores já aprovados são pulados. Nada vira oficial antes de você aprovar o lote.
      </p>
    </div>
  );
}
