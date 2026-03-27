"use client";

import { useMemo, useState } from "react";
import { ArrowDownUp, FileSpreadsheet, Inbox, Loader2 } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import * as XLSX from "xlsx";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toaster";
import type { DashboardFilterState } from "@/lib/dashboard/dre";
import type { KpiDefinition } from "@/lib/kpi/calc";
import type { UserRole } from "@/lib/supabase/types";

interface CompanyKpiRow {
  companyId: string;
  companyName: string;
  value: number;
  sparkline: number[];
  isCurrentUserCompany: boolean;
}

interface KpiRankingViewProps {
  filter: DashboardFilterState;
  kpis: KpiDefinition[];
  selectedKpiId: string;
  rows: CompanyKpiRow[];
  average: number;
  median: number;
  role: UserRole;
}

function formatNumber(value: number, formulaType: KpiDefinition["formula_type"]) {
  if (formulaType === "value") {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(value);
  }
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function Sparkline({ points }: { points: number[] }) {
  if (!points.length) return <span className="text-xs text-muted-foreground">-</span>;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const diff = max - min || 1;
  const normalized = points.map((value, index) => ({
    x: (index / (points.length - 1 || 1)) * 100,
    y: 30 - ((value - min) / diff) * 26,
  }));
  const polyline = normalized.map((point) => `${point.x},${point.y}`).join(" ");

  return (
    <svg viewBox="0 0 100 30" className="h-8 w-28">
      <polyline
        fill="none"
        stroke="#0f766e"
        strokeWidth="2"
        points={polyline}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function KpiRankingView({
  filter,
  kpis,
  selectedKpiId,
  rows,
  average,
  median,
  role,
}: KpiRankingViewProps) {
  const { showToast } = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const [periodType, setPeriodType] = useState(filter.periodType);
  const [year, setYear] = useState(String(filter.year));
  const [month, setMonth] = useState(String(filter.month));
  const [quarter, setQuarter] = useState(String(filter.quarter));
  const [semester, setSemester] = useState(String(filter.semester));
  const [startDate, setStartDate] = useState(filter.startDate);
  const [endDate, setEndDate] = useState(filter.endDate);
  const [kpiId, setKpiId] = useState(selectedKpiId);
  const [sortDirection, setSortDirection] = useState<"desc" | "asc">("desc");
  const [exporting, setExporting] = useState(false);

  const selectedKpi = kpis.find((kpi) => kpi.id === kpiId) ?? kpis[0];

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) =>
      sortDirection === "desc" ? b.value - a.value : a.value - b.value,
    );
  }, [rows, sortDirection]);

  const handleApply = () => {
    const params = new URLSearchParams();
    params.set("periodType", periodType);
    params.set("year", year);
    params.set("kpiId", kpiId);
    if (periodType === "mensal") params.set("month", month);
    if (periodType === "trimestral") params.set("quarter", quarter);
    if (periodType === "semestral") params.set("semester", semester);
    if (periodType === "acumulado") {
      params.set("startDate", startDate);
      params.set("endDate", endDate);
    }
    router.push(`${pathname}?${params.toString()}`);
  };

  const exportKpiExcel = () => {
    try {
      setExporting(true);
      const worksheetRows = sortedRows.map((row, index) => ({
        Ranking: index + 1,
        Unidade: row.companyName,
        [selectedKpi?.name ?? "KPI"]: row.value,
        "Sparkline (6m)": row.sparkline.join(" | "),
      }));
      const ws = XLSX.utils.json_to_sheet(worksheetRows);
      const dataRange = XLSX.utils.decode_range(ws["!ref"] ?? "A1:A1");
      for (let r = 1; r <= dataRange.e.r; r += 1) {
        const valueCell = ws[XLSX.utils.encode_cell({ r, c: 2 })];
        if (!valueCell) continue;
        valueCell.z = selectedKpi?.formula_type === "value" ? "R$ #,##0.00" : "0.00";
      }
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "KPIs");
      XLSX.writeFile(
        wb,
        `KPIs_ControllHub_${(selectedKpi?.name ?? "KPI").replace(/\s+/g, "_")}_${periodType}_${year}.xlsx`,
      );
      showToast({
        title: "Exportacao concluida",
        description: "Excel dos KPIs gerado.",
        variant: "success",
      });
    } catch (error) {
      showToast({
        title: "Falha ao exportar KPIs",
        description: error instanceof Error ? error.message : "Erro desconhecido.",
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-background p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-2xl font-semibold">KPIs</h2>
          <Button type="button" variant="outline" onClick={exportKpiExcel} disabled={exporting}>
            {exporting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <FileSpreadsheet className="mr-2 h-4 w-4" />
            )}
            Exportar Excel
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Ranking por unidade com base no KPI selecionado.
        </p>
      </div>

      <div className="space-y-4 rounded-xl border bg-background p-4">
        <div className="flex flex-wrap gap-2">
          {(["mensal", "trimestral", "semestral", "anual", "acumulado"] as const).map((mode) => (
            <Button key={mode} type="button" variant={periodType === mode ? "default" : "outline"} onClick={() => setPeriodType(mode)}>
              {mode === "mensal" && "Mensal"}
              {mode === "trimestral" && "Trimestral"}
              {mode === "semestral" && "Semestral"}
              {mode === "anual" && "Anual"}
              {mode === "acumulado" && "Acumulado"}
            </Button>
          ))}
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Ano</label>
            <Input value={year} onChange={(event) => setYear(event.target.value)} />
          </div>

          {periodType === "mensal" ? (
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Mes</label>
              <select value={month} onChange={(event) => setMonth(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                {Array.from({ length: 12 }).map((_, index) => (
                  <option key={index + 1} value={String(index + 1)}>
                    {String(index + 1).padStart(2, "0")}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {periodType === "trimestral" ? (
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Trimestre</label>
              <select value={quarter} onChange={(event) => setQuarter(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                <option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option>
              </select>
            </div>
          ) : null}

          {periodType === "semestral" ? (
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Semestre</label>
              <select value={semester} onChange={(event) => setSemester(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                <option value="1">1 semestre</option><option value="2">2 semestre</option>
              </select>
            </div>
          ) : null}

          {periodType === "acumulado" ? (
            <>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">De</label>
                <Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Ate</label>
                <Input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
              </div>
            </>
          ) : null}
        </div>

        <div className="grid gap-3 md:grid-cols-[2fr_auto] md:items-end">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">KPI</label>
            <select value={kpiId} onChange={(event) => setKpiId(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
              {kpis.map((kpi) => (
                <option key={kpi.id} value={kpi.id}>
                  {kpi.name}
                </option>
              ))}
            </select>
          </div>
          <Button type="button" onClick={handleApply}>Aplicar Filtros</Button>
        </div>
      </div>

      <div className="hidden overflow-hidden rounded-xl border bg-background md:block">
        <div className="grid grid-cols-[100px_2fr_1.2fr_180px] gap-3 border-b bg-slate-50 px-4 py-3 text-xs font-semibold uppercase text-slate-600">
          <span># Ranking</span>
          <span>Unidade</span>
          <button type="button" className="flex items-center justify-end gap-2 text-right" onClick={() => setSortDirection((prev) => (prev === "desc" ? "asc" : "desc"))}>
            <ArrowDownUp className="h-3 w-3" />
            {selectedKpi?.name ?? "Valor KPI"}
          </button>
          <span>Ultimos 6 meses</span>
        </div>

        {sortedRows.length === 0 ? (
          <div className="flex min-h-44 flex-col items-center justify-center gap-2 text-muted-foreground">
            <Inbox className="h-6 w-6" />
            <p className="text-sm">Nenhum KPI encontrado para o periodo.</p>
          </div>
        ) : (
          sortedRows.map((row, index) => {
            const rank = index + 1;
            const isTop3 = rank <= 3;
            const isBottom3 = rank > sortedRows.length - 3;
            const rankClass = isTop3 ? "bg-emerald-50" : isBottom3 ? "bg-red-50" : "bg-white";
            const currentCompanyClass =
              role === "gestor_unidade" && row.isCurrentUserCompany ? "ring-2 ring-blue-400" : "";
            return (
              <div
                key={row.companyId}
                className={`grid grid-cols-[100px_2fr_1.2fr_180px] items-center gap-3 border-b px-4 py-2 text-sm ${rankClass} ${currentCompanyClass}`}
              >
                <span className="font-semibold">#{rank}</span>
                <span>{row.companyName}</span>
                <span className="text-right font-semibold">
                  {formatNumber(row.value, selectedKpi?.formula_type ?? "value")}
                </span>
                <Sparkline points={row.sparkline} />
              </div>
            );
          })
        )}
      </div>

      <div className="space-y-3 md:hidden">
        {sortedRows.length === 0 ? (
          <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-xl border bg-background text-muted-foreground">
            <Inbox className="h-6 w-6" />
            <p className="text-sm">Nenhum KPI encontrado para o periodo.</p>
          </div>
        ) : (
          sortedRows.map((row, index) => (
            <div key={row.companyId} className="rounded-xl border bg-background p-4">
              <p className="text-xs font-semibold uppercase text-muted-foreground">#{index + 1}</p>
              <p className="font-semibold">{row.companyName}</p>
              <p className="text-lg font-bold">{formatNumber(row.value, selectedKpi?.formula_type ?? "value")}</p>
              <Sparkline points={row.sparkline} />
            </div>
          ))
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border bg-background p-4">
          <p className="text-sm text-muted-foreground">Media geral</p>
          <p className="text-2xl font-semibold">{formatNumber(average, selectedKpi?.formula_type ?? "value")}</p>
        </div>
        <div className="rounded-xl border bg-background p-4">
          <p className="text-sm text-muted-foreground">Mediana</p>
          <p className="text-2xl font-semibold">{formatNumber(median, selectedKpi?.formula_type ?? "value")}</p>
        </div>
      </div>
    </div>
  );
}
