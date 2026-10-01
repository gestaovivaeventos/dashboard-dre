"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";

import { useToast } from "@/components/ui/toaster";
import { sincronizarSolides } from "@/lib/dp/actions";
import { formatDateTimeBR } from "@/lib/ctrl/datetime";
import type { DpSyncRun } from "@/lib/dp/queries";

/** Última sincronização com a Sólides + botão "Sincronizar agora". */
export function DpSyncPanel({ lastRun }: { lastRun: DpSyncRun | null }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const { showToast } = useToast();

  const onSync = () =>
    startTransition(async () => {
      const res = await sincronizarSolides();
      if (!res.ok) {
        showToast({ title: "Sincronização não concluída", description: res.error, variant: "destructive" });
      } else {
        const d = res.data;
        showToast({
          title: "Cadastro atualizado",
          description:
            `${d.lista} colaboradores ativos na Sólides · ${d.novos} novo(s) · ${d.desligados} desligado(s)` +
            (d.eventos ? ` · ${d.eventos} movimentação(ões) no histórico` : "") +
            (d.fichasErro ? ` · ${d.fichasErro} ficha(s) com erro` : ""),
          variant: "success",
        });
      }
      router.refresh();
    });

  const failed = lastRun?.status === "erro";
  const partial = lastRun?.status === "ok" && lastRun.erro;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-1 px-4 py-3 text-sm">
      <div className="flex items-start gap-2">
        {failed || partial ? (
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        ) : (
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" />
        )}
        <div>
          {!lastRun ? (
            <p className="text-ink-primary">O cadastro ainda não foi trazido da Sólides.</p>
          ) : lastRun.status === "running" ? (
            <p className="text-ink-primary">Sincronização em andamento desde {formatDateTimeBR(lastRun.startedAt)}.</p>
          ) : (
            <p className="text-ink-primary">
              {failed ? "A última sincronização falhou" : "Última sincronização"} em{" "}
              {formatDateTimeBR(lastRun.finishedAt ?? lastRun.startedAt)}
              {lastRun.trigger === "cron" ? " (automática)" : " (manual)"}.
            </p>
          )}
          {lastRun?.erro && <p className="text-ink-muted">{lastRun.erro}</p>}
          <p className="text-ink-muted">A Sólides é a fonte do cadastro; o espelho é atualizado todo dia às 05:00.</p>
        </div>
      </div>
      <button
        type="button"
        onClick={onSync}
        disabled={pending}
        className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-ink-primary hover:bg-surface-2 disabled:opacity-60"
      >
        <RefreshCw className={`h-4 w-4 ${pending ? "animate-spin" : ""}`} />
        {pending ? "Sincronizando…" : "Sincronizar agora"}
      </button>
    </div>
  );
}
