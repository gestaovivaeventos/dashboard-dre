"use client";

import { CheckSquare } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { CtrlRole } from "@/lib/supabase/types";

interface Indicator {
  name: string;
  value: string;
  change: string;
  changeType: "up" | "down" | "neutral";
  color: string;
  label: string;
}

interface Stats {
  activeCompanies: number;
  activeUsers: number;
  segments: number;
  totalEntries: number;
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
  ctrlRoles?: CtrlRole[];
  pendingApprovalsCount?: number;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}

function formatCurrentDate(): string {
  return new Date().toLocaleDateString("pt-BR", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
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

export function HomeView({ userName, ctrlRoles = [], pendingApprovalsCount = 0 }: HomeViewProps) {
  const canSeeApprovals = ctrlRoles.some((r) =>
    (["gerente", "diretor", "csc", "admin", "contas_a_pagar", "aprovacao_fornecedor"] as CtrlRole[]).includes(r),
  );
  const [indicators, setIndicators] = useState<Indicator[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loadingIndicators, setLoadingIndicators] = useState(true);
  const [loadingStats, setLoadingStats] = useState(true);
  const [loadingNews, setLoadingNews] = useState(true);

  useEffect(() => {
    void fetch("/api/home/indicators")
      .then((r) => r.json())
      .then((data: { indicators: Indicator[] }) => {
        setIndicators(data.indicators ?? []);
      })
      .finally(() => setLoadingIndicators(false));

    void fetch("/api/home/stats")
      .then((r) => r.json())
      .then((data: { stats: Stats; alerts: Alert[] }) => {
        setStats(data.stats ?? null);
        setAlerts(data.alerts ?? []);
      })
      .finally(() => setLoadingStats(false));

    void fetch("/api/home/news")
      .then((r) => r.json())
      .then((data: { news: NewsItem[] }) => {
        setNews(data.news ?? []);
      })
      .finally(() => setLoadingNews(false));
  }, []);

  const greeting = getGreeting();
  const currentDate = formatCurrentDate();
  // Capitalize first letter of the weekday returned by toLocaleDateString
  const formattedDate =
    currentDate.charAt(0).toUpperCase() + currentDate.slice(1);

  return (
    <div className="space-y-8 p-6">
      {/* ── 1. Greeting ───────────────────────────────────────────── */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {greeting}, {userName}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{formattedDate}</p>
      </div>

      {/* ── 1b. Ctrl Approvals Banner ─────────────────────────────── */}
      {canSeeApprovals && (
        <Link
          href="/ctrl/aprovacoes"
          className="block rounded-lg border border-violet-200 bg-violet-50 px-5 py-4 transition-colors hover:bg-violet-100 dark:border-violet-900 dark:bg-violet-950/30 dark:hover:bg-violet-950/50"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CheckSquare className="h-5 w-5 text-violet-600" />
              <div>
                <p className="text-sm font-semibold text-violet-900 dark:text-violet-200">
                  Aprovações Pendentes — Controladoria
                </p>
                <p className="text-xs text-violet-600 dark:text-violet-400">
                  {pendingApprovalsCount > 0
                    ? `${pendingApprovalsCount} requisição(ões) aguardando sua aprovação`
                    : "Nenhuma requisição pendente"}
                </p>
              </div>
            </div>
            {pendingApprovalsCount > 0 && (
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-violet-600 text-xs font-bold text-white">
                {pendingApprovalsCount}
              </span>
            )}
          </div>
        </Link>
      )}

      {/* ── 2. Indicadores Econômicos ─────────────────────────────── */}
      <section>
        <h2 className="mb-4 text-base font-semibold">Indicadores Econômicos</h2>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {loadingIndicators
            ? Array.from({ length: 4 }).map((_, i) => (
                <Card key={i} className="rounded-lg border bg-background">
                  <CardContent className="p-4 space-y-2">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-7 w-20" />
                    <Skeleton className="h-4 w-16" />
                  </CardContent>
                </Card>
              ))
            : indicators.map((ind) => (
                <Card
                  key={ind.name}
                  className="rounded-lg border bg-background"
                >
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: ind.color }}
                      />
                      <span className="text-xs text-muted-foreground truncate">
                        {ind.label}
                      </span>
                    </div>
                    <p className="text-2xl font-bold tracking-tight">
                      {ind.value}
                    </p>
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

      {/* ── 3. Controll Hub em Números ───────────────────────────── */}
      <section>
        <div className="rounded-xl bg-gradient-to-r from-blue-700 to-blue-500 p-6 text-white">
          <h2 className="mb-6 text-base font-semibold opacity-90">
            Controll Hub em Números
          </h2>
          {loadingStats ? (
            <div className="grid grid-cols-2 gap-6 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-8 w-16 bg-white/30" />
                  <Skeleton className="h-4 w-28 bg-white/20" />
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-6 lg:grid-cols-4">
              <div>
                <p className="text-3xl font-bold">
                  {stats?.activeCompanies ?? 0}
                </p>
                <p className="mt-1 text-sm opacity-80">Empresas Ativas</p>
              </div>
              <div>
                <p className="text-3xl font-bold">
                  {(stats?.totalEntries ?? 0).toLocaleString("pt-BR")}
                </p>
                <p className="mt-1 text-sm opacity-80">
                  Lançamentos Conciliados
                </p>
              </div>
              <div>
                <p className="text-3xl font-bold">{stats?.segments ?? 0}</p>
                <p className="mt-1 text-sm opacity-80">Segmentos</p>
              </div>
              <div>
                <p className="text-3xl font-bold">{stats?.activeUsers ?? 0}</p>
                <p className="mt-1 text-sm opacity-80">Usuários Ativos</p>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── 4. Two-column section ────────────────────────────────── */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Left — Alertas do Sistema */}
        <Card className="rounded-lg border bg-background">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">
              Alertas do Sistema
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {loadingStats ? (
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-start gap-3">
                  <Skeleton className="mt-1 h-2.5 w-2.5 rounded-full flex-shrink-0" />
                  <div className="space-y-1 flex-1">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3 w-56" />
                  </div>
                </div>
              ))
            ) : alerts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhum alerta no momento.
              </p>
            ) : (
              alerts.map((alert, i) => (
                <div key={i} className="flex items-start gap-3">
                  <span
                    className={`mt-1.5 inline-block h-2.5 w-2.5 rounded-full flex-shrink-0 ${alertDotColor(alert.type)}`}
                  />
                  <div>
                    <p className="text-sm font-medium leading-tight">
                      {alert.title}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {alert.detail}
                    </p>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Right — Notícias Econômicas */}
        <Card className="rounded-lg border bg-background">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">
              Notícias Econômicas
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {loadingNews ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="px-3 py-2.5 space-y-1">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-3 w-32" />
                </div>
              ))
            ) : news.length === 0 ? (
              <p className="text-sm text-muted-foreground px-3 py-2">
                Nenhuma noticia disponivel no momento.
              </p>
            ) : (
              news.map((item, i) => (
                <a
                  key={i}
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between rounded-md px-3 py-2.5 transition-colors hover:bg-muted/60 group"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium group-hover:text-primary transition-colors line-clamp-2">
                      {item.title}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {item.source}{item.publishedAt ? ` · ${item.publishedAt}` : ""}
                    </p>
                  </div>
                  <svg
                    className="h-4 w-4 text-muted-foreground flex-shrink-0 ml-3 group-hover:text-primary transition-colors"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                    />
                  </svg>
                </a>
              ))
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
