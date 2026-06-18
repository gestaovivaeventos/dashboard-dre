"use client";

import { useEffect, useState } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AttentionStrip } from "@/components/app/home/attention-strip";
import { WidgetAprovacoes } from "@/components/app/home/widget-aprovacoes";
import { WidgetFilaPagamento } from "@/components/app/home/widget-fila-pagamento";
import { WidgetMinhasRequisicoes } from "@/components/app/home/widget-minhas-requisicoes";
import { WidgetOrcamento } from "@/components/app/home/widget-orcamento";
import type { HomeCtrlCaps, HomeCtrlData } from "@/lib/home/ctrl-widgets";

interface Indicator {
  name: string;
  value: string;
  change: string;
  changeType: "up" | "down" | "neutral";
  color: string;
  label: string;
}
interface Alert {
  type: "error" | "warning" | "info";
  title: string;
  detail: string;
}
interface NewsItem {
  title: string;
  source: string;
  url: string;
  publishedAt: string;
}

interface HomeViewProps {
  userName: string;
  caps: HomeCtrlCaps;
  ctrlData: HomeCtrlData;
  canFinanceiro: boolean;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}
function changeColor(type: "up" | "down" | "neutral"): string {
  if (type === "up") return "#16a34a";
  if (type === "down") return "#dc2626";
  return "#64748b";
}
function alertDotColor(type: string): string {
  if (type === "error") return "bg-red-500";
  if (type === "warning") return "bg-amber-400";
  return "bg-blue-400";
}

export function HomeView({ userName, caps, ctrlData, canFinanceiro }: HomeViewProps) {
  const [indicators, setIndicators] = useState<Indicator[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loadingIndicators, setLoadingIndicators] = useState(true);
  const [loadingAlerts, setLoadingAlerts] = useState(true);
  const [loadingNews, setLoadingNews] = useState(true);

  useEffect(() => {
    if (!canFinanceiro) return;
    void fetch("/api/home/indicators")
      .then((r) => r.json())
      .then((d: { indicators: Indicator[] }) => setIndicators(d.indicators ?? []))
      .finally(() => setLoadingIndicators(false));
    void fetch("/api/home/stats")
      .then((r) => r.json())
      .then((d: { alerts: Alert[] }) => setAlerts(d.alerts ?? []))
      .finally(() => setLoadingAlerts(false));
    void fetch("/api/home/news")
      .then((r) => r.json())
      .then((d: { news: NewsItem[] }) => setNews(d.news ?? []))
      .finally(() => setLoadingNews(false));
  }, [canFinanceiro]);

  const greeting = getGreeting();
  const currentDate = new Date().toLocaleDateString("pt-BR", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const formattedDate = currentDate.charAt(0).toUpperCase() + currentDate.slice(1);

  const hasAnyWidget =
    (caps.canApprove && ctrlData.approvals) ||
    (caps.canPay && ctrlData.payments) ||
    (caps.canRequest && ctrlData.myRequests) ||
    (caps.canBudget && ctrlData.budget);

  return (
    <div className="space-y-6 p-6">
      {/* Saudação */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {greeting}, {userName}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{formattedDate}</p>
      </div>

      {/* Faixa de atenção */}
      <AttentionStrip data={ctrlData} />

      {/* Grade de widgets */}
      {hasAnyWidget && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {caps.canApprove && ctrlData.approvals && (
            <WidgetAprovacoes data={ctrlData.approvals} />
          )}
          {caps.canPay && ctrlData.payments && (
            <WidgetFilaPagamento data={ctrlData.payments} />
          )}
          {caps.canRequest && ctrlData.myRequests && (
            <WidgetMinhasRequisicoes data={ctrlData.myRequests} />
          )}
          {caps.canBudget && ctrlData.budget && (
            <WidgetOrcamento data={ctrlData.budget} />
          )}
        </div>
      )}

      {/* Rodapé financeiro (gestão/financeiro) — Plano 2 expande com KPIs e Caixa */}
      {canFinanceiro && (
        <>
          <section>
            <h2 className="mb-3 text-base font-semibold">Indicadores Econômicos</h2>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {loadingIndicators
                ? Array.from({ length: 4 }).map((_, i) => (
                    <Card key={i} className="rounded-lg border bg-background">
                      <CardContent className="space-y-2 p-4">
                        <Skeleton className="h-4 w-24" />
                        <Skeleton className="h-7 w-20" />
                        <Skeleton className="h-4 w-16" />
                      </CardContent>
                    </Card>
                  ))
                : indicators.map((ind) => (
                    <Card key={ind.name} className="rounded-lg border bg-background">
                      <CardContent className="p-4">
                        <div className="mb-1 flex items-center gap-2">
                          <span
                            className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full"
                            style={{ backgroundColor: ind.color }}
                          />
                          <span className="truncate text-xs text-muted-foreground">
                            {ind.label}
                          </span>
                        </div>
                        <p className="text-2xl font-bold tracking-tight">{ind.value}</p>
                        <p
                          className="mt-1 text-xs font-medium"
                          style={{ color: changeColor(ind.changeType) }}
                        >
                          {ind.change}
                        </p>
                      </CardContent>
                    </Card>
                  ))}
            </div>
          </section>

          <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card className="rounded-lg border bg-background">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold">Alertas do Sistema</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {loadingAlerts ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <Skeleton className="mt-1 h-2.5 w-2.5 flex-shrink-0 rounded-full" />
                      <div className="flex-1 space-y-1">
                        <Skeleton className="h-4 w-40" />
                        <Skeleton className="h-3 w-56" />
                      </div>
                    </div>
                  ))
                ) : alerts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum alerta no momento.</p>
                ) : (
                  alerts.map((alert, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <span
                        className={`mt-1.5 inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full ${alertDotColor(alert.type)}`}
                      />
                      <div>
                        <p className="text-sm font-medium leading-tight">{alert.title}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{alert.detail}</p>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card className="rounded-lg border bg-background">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold">Notícias Econômicas</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {loadingNews ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="space-y-1 px-3 py-2.5">
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-3 w-32" />
                    </div>
                  ))
                ) : news.length === 0 ? (
                  <p className="px-3 py-2 text-sm text-muted-foreground">
                    Nenhuma notícia disponível no momento.
                  </p>
                ) : (
                  news.map((item, i) => (
                    <a
                      key={i}
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex items-center justify-between rounded-md px-3 py-2.5 transition-colors hover:bg-muted/60"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 text-sm font-medium transition-colors group-hover:text-primary">
                          {item.title}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {item.source}
                          {item.publishedAt ? ` · ${item.publishedAt}` : ""}
                        </p>
                      </div>
                    </a>
                  ))
                )}
              </CardContent>
            </Card>
          </section>
        </>
      )}
    </div>
  );
}
