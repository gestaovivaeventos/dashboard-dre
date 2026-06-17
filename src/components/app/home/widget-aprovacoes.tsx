"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckSquare, Loader2 } from "lucide-react";

import { approveRequest } from "@/lib/ctrl/actions/requests";
import { WidgetCard, WidgetEmpty } from "@/components/app/home/widget-card";
import { fmtBRL, type HomeApprovals } from "@/lib/home/ctrl-widgets";

export function WidgetAprovacoes({ data }: { data: HomeApprovals }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function aprovar(id: string) {
    setBusyId(id);
    setError(null);
    startTransition(async () => {
      const res = await approveRequest(id);
      setBusyId(null);
      if (res && "error" in res && res.error) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <WidgetCard title="Aprovações pendentes" icon={CheckSquare} href="/ctrl/aprovacoes">
      {error && (
        <p className="mb-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}
      {data.items.length === 0 ? (
        <WidgetEmpty>Nenhuma requisição aguardando você.</WidgetEmpty>
      ) : (
        <ul className="divide-y">
          {data.items.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{r.title}</p>
                <p className="text-xs text-muted-foreground">
                  #{r.requestNumber}
                  {r.supplierName ? ` · ${r.supplierName}` : ""} · {fmtBRL.format(r.amount)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => aprovar(r.id)}
                disabled={isPending && busyId === r.id}
                className="inline-flex shrink-0 items-center gap-1 rounded-md bg-green-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
              >
                {isPending && busyId === r.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : null}
                Aprovar
              </button>
            </li>
          ))}
        </ul>
      )}
      {data.total > data.items.length && (
        <p className="mt-2 text-xs text-muted-foreground">
          +{data.total - data.items.length} aguardando — veja todas em Aprovações.
        </p>
      )}
    </WidgetCard>
  );
}
