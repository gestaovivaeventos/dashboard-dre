"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Clock3, Loader2, XCircle } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toaster";

interface CompanyRow {
  id: string;
  name: string;
  active: boolean;
  segment_name: string;
  segment_id: string | null;
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_sync_records: number;
  last_sync_error: string | null;
}

interface SegmentItem {
  id: string;
  name: string;
  slug: string;
}

interface AdminPanelViewProps {
  companies: CompanyRow[];
  segments: SegmentItem[];
}

function SyncStatusIcon({ status }: { status: string | null }) {
  if (status === "success") return <CheckCircle2 className="h-4 w-4 text-green-600" />;
  if (status === "error") return <XCircle className="h-4 w-4 text-red-600" />;
  if (status === "running") return <Clock3 className="h-4 w-4 text-blue-600 animate-pulse" />;
  return <AlertTriangle className="h-4 w-4 text-slate-400" />;
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return "Nunca";
  const d = new Date(dateStr);
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AdminPanelView({ companies: initialCompanies, segments }: AdminPanelViewProps) {
  const { showToast } = useToast();
  const [companies, setCompanies] = useState(initialCompanies);
  const [savingSegment, setSavingSegment] = useState<string | null>(null);

  const totalCompanies = companies.length;
  const activeCompanies = companies.filter((c) => c.active).length;
  const lastErrors = companies.filter((c) => c.last_sync_status === "error");
  const neverSynced = companies.filter((c) => !c.last_sync_at);

  const updateSegment = async (companyId: string, segmentId: string | null) => {
    setSavingSegment(companyId);
    const response = await fetch(`/api/companies/${companyId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ segmentId }),
    });

    if (!response.ok) {
      showToast({
        title: "Falha ao atualizar segmento",
        description: "Nao foi possivel salvar a alteracao.",
        variant: "destructive",
      });
    } else {
      const segName = segmentId
        ? segments.find((s) => s.id === segmentId)?.name ?? "—"
        : "Sem segmento";
      setCompanies((prev) =>
        prev.map((c) =>
          c.id === companyId
            ? { ...c, segment_id: segmentId, segment_name: segName }
            : c,
        ),
      );
      showToast({
        title: "Segmento atualizado",
        description: `Empresa vinculada a "${segName}".`,
        variant: "success",
      });
    }
    setSavingSegment(null);
  };

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold">Painel Administrador</h2>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Total empresas</p>
            <p className="text-2xl font-bold">{totalCompanies}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Ativas</p>
            <p className="text-2xl font-bold text-green-700">{activeCompanies}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Segmentos</p>
            <p className="text-2xl font-bold">{segments.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Erros na sync</p>
            <p className="text-2xl font-bold text-red-700">{lastErrors.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Alerts */}
      {neverSynced.length > 0 ? (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="pt-4">
            <p className="text-sm font-medium text-amber-800">
              {neverSynced.length} empresa(s) nunca sincronizada(s):{" "}
              {neverSynced.map((c) => c.name).join(", ")}
            </p>
          </CardContent>
        </Card>
      ) : null}

      {lastErrors.length > 0 ? (
        <Card className="border-red-300 bg-red-50">
          <CardContent className="pt-4">
            <p className="text-sm font-medium text-red-800">
              {lastErrors.length} empresa(s) com erro na ultima sync:{" "}
              {lastErrors.map((c) => c.name).join(", ")}
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* Companies table */}
      <Card>
        <CardHeader>
          <CardTitle>Todas as Empresas</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-[1.5fr_1.2fr_100px_80px_1fr_120px] gap-2 rounded-md border bg-slate-50 px-3 py-2 text-xs font-semibold uppercase text-slate-600">
            <span>Empresa</span>
            <span>Segmento</span>
            <span>Status</span>
            <span>Sync</span>
            <span>Ultima Sync</span>
            <span>Registros</span>
          </div>
          {companies.map((company) => (
            <div
              key={company.id}
              className="grid grid-cols-[1.5fr_1.2fr_100px_80px_1fr_120px] items-center gap-2 rounded-md border px-3 py-2 text-sm"
            >
              <span className="font-medium">{company.name}</span>
              <div className="flex items-center gap-1">
                <select
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                  value={company.segment_id ?? ""}
                  disabled={savingSegment === company.id}
                  onChange={(e) => {
                    const val = e.target.value || null;
                    void updateSegment(company.id, val);
                  }}
                >
                  <option value="">Sem segmento</option>
                  {segments.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                {savingSegment === company.id && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                )}
              </div>
              <span className={company.active ? "text-green-700" : "text-red-700"}>
                {company.active ? "Ativa" : "Inativa"}
              </span>
              <span className="flex items-center gap-1">
                <SyncStatusIcon status={company.last_sync_status} />
              </span>
              <span className="text-muted-foreground text-xs">
                {formatDate(company.last_sync_at)}
              </span>
              <span className="text-muted-foreground">
                {company.last_sync_records > 0 ? company.last_sync_records.toLocaleString("pt-BR") : "—"}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
