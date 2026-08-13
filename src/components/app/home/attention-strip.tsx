"use client";

import Link from "next/link";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

import type { HomeCtrlCaps, HomeCtrlData } from "@/lib/home/ctrl-widgets";

interface AttentionItem {
  label: string;
  href: string;
}

/**
 * Cada item é um par "existe pendência" + "esta pendência é responsabilidade
 * deste perfil" (caps.alerts, montado em deriveCtrlCaps). Os dois gates são
 * necessários: um widget pode estar carregado para acompanhamento sem que o
 * alerta correspondente pertença ao usuário — é o caso do Contas a Pagar, que
 * vê o quadro de aprovações mas não é avisado delas porque não aprova.
 */
function buildItems(data: HomeCtrlData, caps: HomeCtrlCaps): AttentionItem[] {
  const items: AttentionItem[] = [];
  const alerts = caps.alerts;

  if (alerts.approvals && data.approvals && data.approvals.total > 0) {
    items.push({
      label: `${data.approvals.total} aprovação(ões) aguardando você`,
      href: "/ctrl/aprovacoes",
    });
  }
  if (alerts.omieErrors && data.payments && data.payments.omieErrors > 0) {
    items.push({
      label: `${data.payments.omieErrors} falha(s) no envio ao Omie`,
      href: "/ctrl/contas-a-pagar",
    });
  }
  // Só `aguardando_complementacao`: é a pendência que está de fato com o
  // solicitante (o aprovador perguntou algo antes de decidir).
  if (
    alerts.ownComplement &&
    data.myRequests &&
    data.myRequests.aguardandoComplementacao > 0
  ) {
    items.push({
      label: `${data.myRequests.aguardandoComplementacao} requisição(ões) aguardando complementação`,
      href: "/ctrl/requisicoes",
    });
  }
  if (alerts.ownRejected && data.myRequests && data.myRequests.rejeitadas > 0) {
    items.push({
      label: `${data.myRequests.rejeitadas} requisição(ões) rejeitada(s)`,
      href: "/ctrl/requisicoes",
    });
  }
  // Homologação de fornecedor. `suppliers` só é carregado para o perfil Contas
  // a Pagar (caps.canHomologate), então é null para todo o resto.
  if (alerts.suppliers && data.suppliers && data.suppliers.bloqueadasTotal > 0) {
    items.push({
      label: `${data.suppliers.bloqueadasTotal} requisição(ões) com fornecedor não homologado`,
      href: "/ctrl/contas-a-pagar",
    });
  }
  if (alerts.suppliers && data.suppliers && data.suppliers.novosTotal > 0) {
    items.push({
      label: `${data.suppliers.novosTotal} fornecedor(es) aguardando homologação`,
      href: "/ctrl/admin/fornecedores",
    });
  }
  return items;
}

export function AttentionStrip({
  data,
  caps,
}: {
  data: HomeCtrlData;
  caps: HomeCtrlCaps;
}) {
  const items = buildItems(data, caps);

  // Perfil sem nenhum tipo de pendência sob sua responsabilidade (Visão
  // Financeira, CSC, Validação de Contratos): a faixa não se aplica e some por
  // inteiro — "Tudo em dia" prometeria um acompanhamento que essa tela não faz
  // para eles.
  const hasAnyAlertKind = Object.values(caps.alerts).some(Boolean);
  if (!hasAnyAlertKind) return null;

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
