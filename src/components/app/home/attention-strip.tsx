"use client";

import Link from "next/link";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

import type { HomeCtrlData } from "@/lib/home/ctrl-widgets";

interface AttentionItem {
  label: string;
  href: string;
}

function buildItems(data: HomeCtrlData): AttentionItem[] {
  const items: AttentionItem[] = [];
  if (data.approvals && data.approvals.total > 0) {
    items.push({
      label: `${data.approvals.total} aprovação(ões) aguardando você`,
      href: "/ctrl/aprovacoes",
    });
  }
  if (data.payments && data.payments.omieErrors > 0) {
    items.push({
      label: `${data.payments.omieErrors} falha(s) no envio ao Omie`,
      href: "/ctrl/contas-a-pagar",
    });
  }
  if (data.myRequests && data.myRequests.infoPendente > 0) {
    items.push({
      label: `${data.myRequests.infoPendente} requisição(ões) com info pedida`,
      href: "/ctrl/requisicoes",
    });
  }
  if (data.myRequests && data.myRequests.rejeitadas > 0) {
    items.push({
      label: `${data.myRequests.rejeitadas} requisição(ões) rejeitada(s)`,
      href: "/ctrl/requisicoes",
    });
  }
  return items;
}

export function AttentionStrip({ data }: { data: HomeCtrlData }) {
  const items = buildItems(data);

  if (items.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-5 py-3 text-sm text-muted-foreground">
        <CheckCircle2 className="h-4 w-4 text-green-600" />
        Tudo em dia. Nada precisa da sua atenção agora.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-5 py-3 dark:border-amber-900 dark:bg-amber-950/30">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-200">
        <AlertTriangle className="h-4 w-4 text-amber-600" />
        Precisa da sua atenção
      </div>
      <ul className="flex flex-wrap gap-2">
        {items.map((it) => (
          <li key={it.href + it.label}>
            <Link
              href={it.href}
              className="inline-flex rounded-full border border-amber-300 bg-white/70 px-3 py-1 text-xs font-medium text-amber-900 transition-colors hover:bg-white dark:border-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
            >
              {it.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
