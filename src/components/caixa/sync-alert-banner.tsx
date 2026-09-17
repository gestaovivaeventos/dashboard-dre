"use client";

// Aviso de saúde da atualização de saldos. O que cada tipo diz:
//   failed  → a última atualização terminou com empresa/conta falhando
//   crashed → começou e não terminou (estourou o tempo)
//   missing → o horário automático passou e o cron não rodou
//
// Texto em cima do número, não no lugar dele: o saldo continua na tela, o
// aviso diz de quando ele é e por quê.

import { AlertTriangle, Clock, XOctagon } from "lucide-react";

import type { CaixaSyncAlert } from "@/lib/caixa/health";

function whenBR(iso: string, today: string): string {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  const time = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
  if (day === today) return `hoje às ${time}`;
  const [y, m, dd] = day.split("-");
  return `${dd}/${m}/${y} às ${time}`;
}

function origem(trigger: "cron" | "manual"): string {
  return trigger === "cron" ? "automática" : "manual";
}

export function SyncAlertBanner({
  alert,
  today,
}: {
  alert: CaixaSyncAlert;
  today: string;
}) {
  let icon: React.ReactNode;
  let title: string;
  let body: React.ReactNode;
  let tone: "warning" | "critical";

  switch (alert.kind) {
    case "failed": {
      tone = "warning";
      icon = <AlertTriangle className="h-4 w-4" />;
      title = `A última atualização (${origem(alert.trigger)}, ${whenBR(alert.finishedAt, today)}) falhou em ${alert.companiesFailed} de ${alert.companiesTotal} empresas`;
      body = (
        <>
          {alert.companies.length > 0 && (
            <>
              Com problema: <strong className="font-medium">{alert.companies.join(", ")}</strong>.{" "}
            </>
          )}
          {alert.accountsFailed > 0 && `${alert.accountsFailed} conta(s) ficaram com o saldo anterior. `}
          Os saldos dessas empresas estão desatualizados — use{" "}
          <em>Só as desatualizadas</em> no seletor e clique em <em>Atualizar saldos</em>.
        </>
      );
      break;
    }
    case "crashed": {
      tone = "critical";
      icon = <XOctagon className="h-4 w-4" />;
      title = `A atualização ${origem(alert.trigger)} iniciada ${whenBR(alert.startedAt, today)} não terminou`;
      body = (
        <>
          Provavelmente estourou o tempo de execução. Parte das empresas pode ter ficado
          sem saldo novo — confira a coluna <em>Atualizado</em> e refaça as pendentes.
        </>
      );
      break;
    }
    case "missing": {
      tone = "warning";
      icon = <Clock className="h-4 w-4" />;
      title = `A atualização automática das ${alert.expectedLabel}${alert.expectedToday ? "" : " de ontem"} não rodou`;
      body = (
        <>
          {alert.lastCronAt
            ? `Última automática: ${whenBR(alert.lastCronAt, today)}. `
            : "Nenhuma execução automática registrada ainda. "}
          Os saldos podem estar defasados — clique em <em>Atualizar saldos</em> para
          buscar agora. Se repetir, o agendamento na Vercel precisa ser verificado.
        </>
      );
      break;
    }
  }

  const styles =
    tone === "critical"
      ? "border-status-critical/40 bg-status-critical/10"
      : "border-status-warning/40 bg-status-warning/10";
  const iconColor = tone === "critical" ? "text-status-critical" : "text-status-warning";

  return (
    <div role="alert" className={`flex items-start gap-2.5 rounded-viva-lg border p-3 text-sm ${styles}`}>
      <span className={`mt-0.5 shrink-0 ${iconColor}`}>{icon}</span>
      <div className="min-w-0">
        <div className="font-medium text-ink-primary">{title}</div>
        <div className="mt-0.5 text-ink-secondary">{body}</div>
      </div>
    </div>
  );
}
