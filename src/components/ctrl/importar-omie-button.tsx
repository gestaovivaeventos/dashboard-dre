"use client";

import { CloudDownload, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ImportResult {
  imported: number;
  skippedExisting: number;
  fornecedorCount: number;
  scanned: number;
  avisos?: string[];
}

/**
 * Importa os fornecedores da Omie da empresa ATIVA (só os marcados "Fornecedor")
 * como pendentes. Só admin/Contas a Pagar veem o botão. A operação pode levar
 * alguns minutos (lê a Omie página a página), por isso o estado de carregando é
 * explícito e o diálogo não fecha no meio.
 */
export function ImportarOmieButton({ orgName }: { orgName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setResult(null);
    setError(null);
  }

  async function run() {
    setLoading(true);
    reset();
    try {
      const res = await fetch("/api/ctrl/suppliers/import-omie", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Falha ao importar da Omie.");
        return;
      }
      setResult(data as ImportResult);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        <CloudDownload className="mr-2 h-4 w-4" />
        Importar da Omie
      </Button>

      <Dialog open={open} onOpenChange={(v) => !loading && setOpen(v)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Importar fornecedores da Omie</DialogTitle>
            <DialogDescription>
              Traz os cadastros marcados como <strong>Fornecedor</strong> na Omie de{" "}
              <strong>{orgName}</strong> como fornecedores <strong>pendentes</strong>, para o
              Contas a Pagar ou um admin homologar — o mesmo fluxo do cadastro manual. A chave
              PIX e os dados bancários vêm junto. Quem já está cadastrado não é duplicado. Pode
              levar alguns minutos.
            </DialogDescription>
          </DialogHeader>

          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          {result && (
            <div className="space-y-1 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-950/40 dark:text-green-400">
              <p>
                <strong>{result.imported}</strong> fornecedor(es) importado(s) como pendente(s).
              </p>
              <p className="text-xs">
                {result.skippedExisting} já estava(m) cadastrado(s) · {result.fornecedorCount}{" "}
                marcado(s) como Fornecedor na Omie.
              </p>
              {result.avisos?.length ? (
                <p className="text-xs text-amber-700 dark:text-amber-500">
                  Avisos: {result.avisos.join("; ")}
                </p>
              ) : null}
            </div>
          )}

          <DialogFooter>
            {result ? (
              <Button onClick={() => setOpen(false)}>Fechar</Button>
            ) : (
              <>
                <Button variant="ghost" onClick={() => setOpen(false)} disabled={loading}>
                  Cancelar
                </Button>
                <Button onClick={run} disabled={loading}>
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Importando…
                    </>
                  ) : (
                    "Importar"
                  )}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
