"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface CtrlErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function CtrlError({ error, reset }: CtrlErrorProps) {
  useEffect(() => {
    console.error("[ctrl] Erro na rota:", error);
  }, [error]);

  const isAccessDenied = error.message?.toLowerCase().includes("acesso negado");
  const isUnauthenticated = error.message?.toLowerCase().includes("autenticado");

  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center justify-center gap-4 rounded-lg border border-destructive/30 bg-destructive/5 p-8 text-center">
      <AlertTriangle className="h-10 w-10 text-destructive" />
      <div>
        <h2 className="text-lg font-semibold">
          {isAccessDenied
            ? "Voce nao tem permissao para acessar esta pagina"
            : isUnauthenticated
              ? "Sessao expirada"
              : "Ocorreu um erro ao carregar esta pagina"}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {isAccessDenied
            ? "Se voce acredita que isso e um engano, fale com o administrador."
            : isUnauthenticated
              ? "Faca login novamente para continuar."
              : error.message || "Erro inesperado."}
        </p>
        {error.digest ? (
          <p className="mt-2 font-mono text-xs text-muted-foreground/70">
            ref: {error.digest}
          </p>
        ) : null}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors hover:bg-muted"
        >
          <RefreshCw className="h-4 w-4" />
          Tentar novamente
        </button>
        <a
          href="/ctrl"
          className="inline-flex items-center rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Voltar ao inicio
        </a>
      </div>
    </div>
  );
}
