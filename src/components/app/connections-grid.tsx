"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock3, Loader2, RefreshCcw, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toaster";

interface ConnectionCompany {
  id: string;
  name: string;
  last_sync_at: string | null;
  last_sync_status: "success" | "error" | "running" | null;
  last_sync_error: string | null;
  entries_count: number;
  sync_history: Array<{
    started_at: string;
    finished_at: string | null;
    status: "success" | "error" | "running";
    records_imported: number;
    error_message: string | null;
    duration_seconds: number | null;
  }>;
}

function getSyncVisual(item: ConnectionCompany) {
  if (item.last_sync_status === "error") {
    return {
      label: "Erro na ultima sync",
      icon: XCircle,
      className: "text-red-600",
    };
  }

  if (!item.last_sync_at) {
    return {
      label: "Sem sincronizacao",
      icon: AlertTriangle,
      className: "text-red-600",
    };
  }

  const diffHours = (Date.now() - new Date(item.last_sync_at).getTime()) / (1000 * 60 * 60);
  if (diffHours <= 24) {
    return {
      label: "Atualizado (< 24h)",
      icon: CheckCircle2,
      className: "text-green-600",
    };
  }

  return {
    label: "Desatualizado (> 24h)",
    icon: Clock3,
    className: "text-amber-600",
  };
}

function formatDateTime(value: string | null) {
  if (!value) return "Nunca";
  return new Date(value).toLocaleString("pt-BR");
}

interface ConnectionsGridProps {
  segmentSlug?: string;
}

export function ConnectionsGrid({ segmentSlug }: ConnectionsGridProps = {}) {
  const { showToast } = useToast();
  const [companies, setCompanies] = useState<ConnectionCompany[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncingByCompany, setSyncingByCompany] = useState<Record<string, boolean>>({});
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [expandedCompanyId, setExpandedCompanyId] = useState<string | null>(null);
  const [historyStatusFilter, setHistoryStatusFilter] = useState<"all" | "success" | "error">("all");

  const loadCompanies = useCallback(async () => {
    setLoading(true);
    setStatusMessage(null);
    const queryParams = new URLSearchParams();
    if (historyStatusFilter !== "all") queryParams.set("status", historyStatusFilter);
    if (segmentSlug) queryParams.set("segment", segmentSlug);
    const query = queryParams.toString() ? `?${queryParams.toString()}` : "";
    const response = await fetch(`/api/connections${query}`, { cache: "no-store" });
    const payload = (await response.json()) as {
      companies?: ConnectionCompany[];
      error?: string;
    };

    if (!response.ok || !payload.companies) {
      setStatusMessage(payload.error ?? "Nao foi possivel carregar conexoes.");
      showToast({
        title: "Falha ao carregar conexoes",
        description: payload.error ?? "Nao foi possivel atualizar os dados.",
        variant: "destructive",
      });
      setLoading(false);
      return;
    }

    setCompanies(payload.companies);
    setLoading(false);
  }, [historyStatusFilter, segmentSlug, showToast]);

  useEffect(() => {
    void loadCompanies();
  }, [loadCompanies]);

  const totalEntries = useMemo(
    () => companies.reduce((accumulator, item) => accumulator + item.entries_count, 0),
    [companies],
  );

  const handleSync = async (companyId: string) => {
    setSyncingByCompany((previous) => ({ ...previous, [companyId]: true }));
    setStatusMessage(null);

    const response = await fetch(`/api/sync/${companyId}`, {
      method: "POST",
    });
    const payload = (await response.json()) as { error?: string; recordsImported?: number };
    if (!response.ok) {
      setStatusMessage(payload.error ?? "Falha ao sincronizar empresa.");
      showToast({
        title: "Falha na sincronizacao",
        description: payload.error ?? "A empresa nao foi sincronizada.",
        variant: "destructive",
      });
    } else {
      setStatusMessage(`Sincronizacao concluida. ${payload.recordsImported ?? 0} registros.`);
      showToast({
        title: "Sincronizacao concluida",
        description: `${payload.recordsImported ?? 0} registros importados.`,
        variant: "success",
      });
      await loadCompanies();
    }

    setSyncingByCompany((previous) => ({ ...previous, [companyId]: false }));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">Conexoes</h2>
          <p className="text-sm text-muted-foreground">
            Status de sincronizacao por empresa e lancamentos importados.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => void loadCompanies()} disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Atualizar
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">
            Empresas monitoradas: <span className="font-medium text-foreground">{companies.length}</span> |
            Total de lancamentos: <span className="font-medium text-foreground">{totalEntries}</span>
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {companies.map((company) => {
          const visual = getSyncVisual(company);
          const StatusIcon = visual.icon;
          const syncing = syncingByCompany[company.id] ?? false;
          return (
            <Card key={company.id}>
              <CardHeader className="space-y-2">
                <CardTitle className="text-lg">{company.name}</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Ultima sync: {formatDateTime(company.last_sync_at)}
                </p>
                <div className={`flex items-center gap-2 text-sm ${visual.className}`}>
                  <StatusIcon className="h-4 w-4" />
                  <span>{visual.label}</span>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Lancamentos importados: <span className="font-medium text-foreground">{company.entries_count}</span>
                </p>
                {company.last_sync_error ? (
                  <p className="rounded-md bg-red-50 p-2 text-xs text-red-700">{company.last_sync_error}</p>
                ) : null}
                <Button
                  type="button"
                  className="w-full"
                  onClick={() => void handleSync(company.id)}
                  disabled={syncing}
                >
                  {syncing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCcw className="mr-2 h-4 w-4" />
                  )}
                  Sincronizar Agora
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() =>
                    setExpandedCompanyId((current) => (current === company.id ? null : company.id))
                  }
                >
                  {expandedCompanyId === company.id ? "Ocultar Historico" : "Ver Historico"}
                </Button>
              </CardContent>
              {expandedCompanyId === company.id ? (
                <CardContent className="pt-0">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase text-muted-foreground">
                      Ultimas 30 sincronizacoes
                    </p>
                    <select
                      className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                      value={historyStatusFilter}
                      onChange={(event) =>
                        setHistoryStatusFilter(
                          event.target.value as "all" | "success" | "error",
                        )
                      }
                    >
                      <option value="all">Todos</option>
                      <option value="success">Sucesso</option>
                      <option value="error">Erro</option>
                    </select>
                  </div>
                  <div className="max-h-64 overflow-y-auto rounded-md border">
                    <div className="grid grid-cols-[150px_90px_90px_120px_1fr] gap-2 border-b bg-slate-50 px-2 py-2 text-[11px] font-semibold uppercase text-slate-600">
                      <span>Data/Hora</span>
                      <span>Duracao</span>
                      <span>Status</span>
                      <span>Registros</span>
                      <span>Mensagem</span>
                    </div>
                    {company.sync_history.length === 0 ? (
                      <p className="px-2 py-4 text-xs text-muted-foreground">
                        Nenhum log para o filtro selecionado.
                      </p>
                    ) : (
                      company.sync_history.map((log, index) => (
                        <div
                          key={`${company.id}-${index}-${log.started_at}`}
                          className="grid grid-cols-[150px_90px_90px_120px_1fr] gap-2 border-b px-2 py-2 text-xs"
                        >
                          <span>{new Date(log.started_at).toLocaleString("pt-BR")}</span>
                          <span>{log.duration_seconds !== null ? `${log.duration_seconds}s` : "-"}</span>
                          <span
                            className={
                              log.status === "success"
                                ? "text-green-700"
                                : log.status === "error"
                                  ? "text-red-700"
                                  : "text-amber-700"
                            }
                          >
                            {log.status}
                          </span>
                          <span>{log.records_imported}</span>
                          <span className="truncate">{log.error_message || "-"}</span>
                        </div>
                      ))
                    )}
                  </div>
                </CardContent>
              ) : null}
            </Card>
          );
        })}
      </div>

      {statusMessage ? (
        <p className="rounded-md border bg-background px-3 py-2 text-sm">{statusMessage}</p>
      ) : null}
    </div>
  );
}
