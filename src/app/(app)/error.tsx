"use client";

import Link from "next/link";
import { useEffect } from "react";

import { Button, buttonVariants } from "@/components/ui/button";

// Error boundary do grupo (app). Substitui a tela "server-side exception" pelada
// por uma tela amigável com "Tentar novamente" e "Voltar ao início", e registra
// o erro no console (logs do servidor/cliente). NÃO corrige a causa raiz — só
// melhora a UX e a observabilidade. Em produção, o Next redige a mensagem; o
// `digest` aqui é a chave para achar o stack real nos logs do servidor.
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app error boundary]", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-xl font-semibold">Algo deu errado ao carregar esta tela.</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Tente novamente. Se o problema persistir, recarregue a página ou volte ao início.
      </p>
      {error.digest ? (
        <p className="text-xs text-muted-foreground">Código do erro: {error.digest}</p>
      ) : null}
      <div className="flex gap-3 pt-2">
        <Button onClick={() => reset()}>Tentar novamente</Button>
        <Link href="/home" className={buttonVariants({ variant: "outline" })}>
          Voltar ao início
        </Link>
      </div>
    </div>
  );
}
