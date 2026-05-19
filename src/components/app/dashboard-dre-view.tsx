"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import {
  Search,
  Loader2,
  ChevronsLeft,
  ChevronsRight,
  ChevronDown,
  ChevronRight,
  FileSpreadsheet,
  FileText,
  Inbox,
  ArrowLeft,
  RefreshCw,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toaster";
import { SegmentCompanyPicker } from "@/components/app/segment-company-picker";
import type {
  DashboardFilterState,
  DashboardRange,
  DashboardPeriodBucket,
  PeriodMode,
} from "@/lib/dashboard/dre";
import type { Segment, UserRole } from "@/lib/supabase/types";

interface CompanyOption {
  id: string;
  name: string;
}

interface DashboardDisplayRow {
  id: string;
  code: string;
  name: string;
  parent_id: string | null;
  level: number;
  type: "receita" | "despesa" | "calculado" | "misto";
  is_summary: boolean;
  sort_order: number;
  hasChildren: boolean;
  percentageOverNetRevenue: number;
  valuesByBucket: Record<string, number>;
  accumulatedValue: number;
  valuesByCompany?: Record<string, number>;
}

interface DashboardDreViewProps {
  filter: DashboardFilterState;
  range: DashboardRange;
  rows: DashboardDisplayRow[];
  companies: CompanyOption[];
  role: UserRole;
  visibleBuckets: DashboardPeriodBucket[];
  accumulatedBucket: DashboardPeriodBucket;
  selectedCompanyIds: string[];
  lastSyncAt: string | null;
  segments: Segment[];
  activeSegmentSlug: string | null;
}

interface DrilldownState {
  open: boolean;
  accountId: string;
  accountName: string;
  bucket: DashboardPeriodBucket;
}

interface DrilldownRow {
  id: string;
  payment_date: string;
  description: string;
  supplier_customer: string;
  document_number: string;
  value: number;
  company_name: string;
}

interface EvolutionPoint {
  label: string;
  [companyId: string]: number | string;
}

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function formatCurrency(value: number) {
  return currencyFormatter.format(value);
}

function formatVar(a: number, b: number): string {
  if (a === 0 && b === 0) return "-";
  if (a === 0) return "-";
  const pct = ((b - a) / Math.abs(a)) * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

function varColor(a: number, b: number): string {
  if (a === 0 && b === 0) return "text-muted-foreground/60";
  if (a === 0) return "text-muted-foreground/60";
  const pct = ((b - a) / Math.abs(a)) * 100;
  return pct >= 0 ? "text-emerald-700" : "text-red-700";
}

const MONTHS = [
  { value: 1, label: "Janeiro" },
  { value: 2, label: "Fevereiro" },
  { value: 3, label: "Marco" },
  { value: 4, label: "Abril" },
  { value: 5, label: "Maio" },
  { value: 6, label: "Junho" },
  { value: 7, label: "Julho" },
  { value: 8, label: "Agosto" },
  { value: 9, label: "Setembro" },
  { value: 10, label: "Outubro" },
  { value: 11, label: "Novembro" },
  { value: 12, label: "Dezembro" },
];

function SyncFreshnessIndicator({
  lastSyncAt,
  refreshing,
  onRefresh,
}: {
  lastSyncAt: string | null;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  let label: string;
  let stale = false;
  if (!lastSyncAt) {
    label = "Sem sync registrado";
    stale = true;
  } else {
    const syncedAt = new Date(lastSyncAt).getTime();
    const diffMin = Math.floor((now - syncedAt) / 60_000);
    if (diffMin < 1) label = "Sincronizado agora";
    else if (diffMin < 60) label = `Sincronizado ha ${diffMin} min`;
    else if (diffMin < 60 * 24) {
      const h = Math.floor(diffMin / 60);
      label = `Sincronizado ha ${h}h`;
    } else {
      label = `Sincronizado em ${new Date(lastSyncAt).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })}`;
    }
    // Se o ultimo sync foi ha mais de 6 horas, sinaliza como possivelmente
    // desatualizado para o usuario considerar atualizar antes de tomar decisao.
    stale = diffMin > 60 * 6;
  }

  return (
    <div className="flex items-center gap-2 rounded-md border border-input bg-background px-3 py-1.5 text-xs">
      <span
        className={`inline-block h-2 w-2 rounded-full ${
          stale ? "bg-amber-500" : "bg-emerald-500"
        }`}
      />
      <span className="text-muted-foreground">{label}</span>
      <button
        type="button"
        onClick={onRefresh}
        disabled={refreshing}
        className="inline-flex items-center gap-1 text-foreground hover:underline disabled:opacity-50"
        title="Buscar dados atualizados"
      >
        <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
        Atualizar
      </button>
    </div>
  );
}


export function DashboardDreView({
  filter,
  range,
  rows,
  companies,
  role,
  visibleBuckets,
  accumulatedBucket,
  selectedCompanyIds,
  lastSyncAt,
  segments,
  activeSegmentSlug,
}: DashboardDreViewProps) {
  const { showToast } = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const [refreshing, setRefreshing] = useState(false);

  const [periodMode, setPeriodMode] = useState<PeriodMode>(filter.periodMode);
  const [monthFrom, setMonthFrom] = useState(filter.monthFrom);
  const [yearFrom, setYearFrom] = useState(filter.yearFrom);
  const [monthTo, setMonthTo] = useState(filter.monthTo);
  const [yearTo, setYearTo] = useState(filter.yearTo);
  const [companySelection, setCompanySelection] = useState(filter.selectedCompanyIds);
  const [compareMode, setCompareMode] = useState(filter.compareCompanies);

  const [expanded, setExpanded] = useState<Record<string, boolean>>(
    () =>
      rows.filter((row) => row.hasChildren).reduce((acc, row) => ({ ...acc, [row.id]: true }), {}),
  );

  const [drilldown, setDrilldown] = useState<DrilldownState>({
    open: false,
    accountId: "",
    accountName: "",
    bucket: visibleBuckets[0] ?? accumulatedBucket,
  });
  const [drillRows, setDrillRows] = useState<DrilldownRow[]>([]);
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillSearch, setDrillSearch] = useState("");
  const [drillPage, setDrillPage] = useState(1);
  const [drillPageSize, setDrillPageSize] = useState(20);
  const [drillTotal, setDrillTotal] = useState(0);
  const [drillTotalValue, setDrillTotalValue] = useState(0);
  // Valor que estava na celula da DRE clicada e total agregado canonico
  // devolvido pela API. Se diferirem, exibimos um banner alertando que o
  // dashboard esta desatualizado e oferecemos botao para recarregar.
  const [drillCellValue, setDrillCellValue] = useState(0);
  const [drillAggregateTotal, setDrillAggregateTotal] = useState(0);

  const [selectedAccountId, setSelectedAccountId] = useState(rows[0]?.id ?? "");
  const [evolutionData, setEvolutionData] = useState<EvolutionPoint[]>([]);
  const [evolutionLoading, setEvolutionLoading] = useState(false);
  const [exporting, setExporting] = useState<null | "excel" | "pdf">(null);

  const byParent = useMemo(() => {
    const map = new Map<string | null, DashboardDisplayRow[]>();
    rows.forEach((row) => {
      const siblings = map.get(row.parent_id) ?? [];
      siblings.push(row);
      map.set(row.parent_id, siblings);
    });
    map.forEach((siblings) => {
      siblings.sort((a, b) => a.sort_order - b.sort_order || a.code.localeCompare(b.code, undefined, { numeric: true }));
    });
    return map;
  }, [rows]);

  const visibleRows = useMemo(() => {
    const result: DashboardDisplayRow[] = [];
    const walk = (parentId: string | null) => {
      (byParent.get(parentId) ?? []).forEach((child) => {
        result.push(child);
        if (expanded[child.id]) walk(child.id);
      });
    };
    walk(null);
    return result;
  }, [byParent, expanded]);

  const selectedAccount = rows.find((row) => row.id === selectedAccountId) ?? rows[0];

  const loadEvolution = async (accountId: string) => {
    if (!accountId) return;
    setEvolutionLoading(true);
    const params = new URLSearchParams({
      accountId,
      companyIds: selectedCompanyIds.join(","),
      endDate: range.dateTo,
    });
    const response = await fetch(`/api/dashboard/evolution?${params.toString()}`, { cache: "no-store" });
    const payload = (await response.json()) as { points?: EvolutionPoint[] };
    setEvolutionData(payload.points ?? []);
    setEvolutionLoading(false);
  };

  useEffect(() => {
    if (selectedAccount?.id) {
      void loadEvolution(selectedAccount.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccount?.id, range.dateTo, selectedCompanyIds.join(",")]);

  const openDrilldown = async (
    account: DashboardDisplayRow,
    bucket: DashboardPeriodBucket,
    page = 1,
    search = "",
    cellValueOverride?: number,
  ) => {
    setDrilldown({
      open: true,
      accountId: account.id,
      accountName: `${account.code} - ${account.name}`,
      bucket,
    });
    if (typeof cellValueOverride === "number") {
      setDrillCellValue(cellValueOverride);
    }
    setDrillLoading(true);
    const params = new URLSearchParams({
      accountId: account.id,
      dateFrom: bucket.dateFrom,
      dateTo: bucket.dateTo,
      companyIds: selectedCompanyIds.join(","),
      page: String(page),
      pageSize: String(drillPageSize),
      search,
    });
    const response = await fetch(`/api/dashboard/drilldown?${params.toString()}`, { cache: "no-store" });
    const payload = (await response.json()) as {
      rows?: DrilldownRow[];
      total?: number;
      totalValue?: number;
      aggregateTotal?: number;
    };
    setDrillRows(payload.rows ?? []);
    setDrillTotal(payload.total ?? 0);
    setDrillTotalValue(payload.totalValue ?? 0);
    setDrillAggregateTotal(payload.aggregateTotal ?? 0);
    setDrillPage(page);
    setDrillLoading(false);
  };

  const handleApply = () => {
    const params = new URLSearchParams();
    params.set("periodMode", periodMode);
    if (periodMode === "especifico") {
      params.set("monthFrom", String(monthFrom));
      params.set("yearFrom", String(yearFrom));
      params.set("monthTo", String(monthTo));
      params.set("yearTo", String(yearTo));
    }
    const allSelected = companySelection.length === companies.length;
    if (!allSelected) params.set("companyIds", companySelection.join(","));
    if (compareMode) params.set("compareCompanies", "true");
    router.push(`${pathname}?${params.toString()}`);
  };

  const columns = visibleBuckets;
  const chartColors = ["#0f766e", "#2563eb", "#a21caf", "#d97706", "#dc2626", "#059669"];

  const unitsLabel =
    selectedCompanyIds.length === companies.length
      ? "Consolidado"
      : companies
          .filter((company) => selectedCompanyIds.includes(company.id))
          .map((company) => company.name)
          .join("_");
  const periodLabel = range.label.replace(/\s+/g, "_");

  const exportDreExcel = () => {
    try {
      setExporting("excel");
      const sheetRows = visibleRows.map((row) => {
        const record: Record<string, string | number> = {
          Conta: `${" ".repeat((row.level - 1) * 2)}${row.name}`,
        };
        columns.forEach((column) => {
          record[column.label] = Number(row.valuesByBucket[column.key] ?? 0);
        });
        record[accumulatedBucket.label] = Number(row.accumulatedValue ?? 0);
        return record;
      });

      const worksheet = XLSX.utils.json_to_sheet(sheetRows);
      const rangeRef = XLSX.utils.decode_range(worksheet["!ref"] ?? "A1:A1");
      for (let rowIndex = 1; rowIndex <= rangeRef.e.r; rowIndex += 1) {
        for (let colIndex = 1; colIndex <= rangeRef.e.c; colIndex += 1) {
          const cellAddress = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
          const cell = worksheet[cellAddress];
          if (!cell) continue;
          cell.z = "R$ #,##0.00";
        }
      }

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "DRE");
      XLSX.writeFile(
        workbook,
        `DRE_ControllHub_${unitsLabel || "Consolidado"}_${periodLabel || "Periodo"}.xlsx`,
      );
      showToast({ title: "Exportacao concluida", description: "Excel do DRE gerado.", variant: "success" });
    } catch (error) {
      showToast({
        title: "Falha ao exportar",
        description: error instanceof Error ? error.message : "Erro ao gerar Excel.",
        variant: "destructive",
      });
    } finally {
      setExporting(null);
    }
  };

  const exportDrePdf = async () => {
    try {
      setExporting("pdf");
      const response = await fetch("/api/export/dre/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "DRE Gerencial",
          periodLabel: range.label,
          unitsLabel,
          buckets: columns.map((item) => ({ key: item.key, label: item.label })),
          rows: visibleRows,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Erro ao gerar PDF.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `DRE_ControllHub_${unitsLabel || "Consolidado"}_${periodLabel || "Periodo"}.pdf`;
      anchor.click();
      URL.revokeObjectURL(url);
      showToast({ title: "Exportacao concluida", description: "PDF do DRE gerado.", variant: "success" });
    } catch (error) {
      showToast({
        title: "Falha ao exportar",
        description: error instanceof Error ? error.message : "Erro ao gerar PDF.",
        variant: "destructive",
      });
    } finally {
      setExporting(null);
    }
  };

  // Number of data columns (months + total)
  const totalCols = columns.length + 1;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-xl border bg-background p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold">DRE Gerencial</h2>
            <p className="text-sm text-muted-foreground">{range.label}</p>
          </div>
          <div className="flex items-center gap-2">
            <SyncFreshnessIndicator
              lastSyncAt={lastSyncAt}
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                router.refresh();
                // router.refresh() nao retorna Promise observavel; usamos
                // timeout curto para o spinner sair quando o SSR terminar.
                window.setTimeout(() => setRefreshing(false), 1500);
              }}
            />
          <details className="relative">
            <summary className="list-none">
              <span className={buttonVariants({ variant: "outline" })}>Exportar</span>
            </summary>
            <div className="absolute right-0 z-20 mt-2 w-52 rounded-md border bg-background p-2 shadow-sm">
              <Button
                type="button"
                variant="ghost"
                className="w-full justify-start"
                onClick={exportDreExcel}
                disabled={exporting !== null}
              >
                {exporting === "excel" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <FileSpreadsheet className="mr-2 h-4 w-4" />
                )}
                Excel
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full justify-start"
                onClick={() => void exportDrePdf()}
                disabled={exporting !== null}
              >
                {exporting === "pdf" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <FileText className="mr-2 h-4 w-4" />
                )}
                PDF
              </Button>
            </div>
          </details>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="space-y-4 rounded-xl border bg-background p-4">
        <div className="flex flex-wrap items-end gap-4">
          {/* Segmento + Empresas */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              Segmento e empresas
            </label>
            <SegmentCompanyPicker
              segments={segments}
              activeSegmentSlug={activeSegmentSlug}
              companies={companies}
              selected={companySelection}
              onChange={(ids) => {
                if (role !== "gestor_unidade") setCompanySelection(ids);
              }}
              disabled={role === "gestor_unidade"}
            />
          </div>

          {/* Period mode */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Periodo</label>
            <div className="flex gap-1">
              {(
                [
                  { value: "mes_atual", label: "Mes atual" },
                  { value: "ano_atual", label: "Ano atual" },
                  { value: "especifico", label: "Periodo especifico" },
                ] as const
              ).map((opt) => (
                <Button
                  key={opt.value}
                  type="button"
                  size="sm"
                  variant={periodMode === opt.value ? "default" : "outline"}
                  onClick={() => setPeriodMode(opt.value)}
                >
                  {opt.label}
                </Button>
              ))}
            </div>
          </div>

          {/* Date range selectors for "especifico" */}
          {periodMode === "especifico" && (
            <>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">De</label>
                <div className="flex gap-1">
                  <select
                    value={monthFrom}
                    onChange={(e) => setMonthFrom(Number(e.target.value))}
                    className="h-10 rounded-md border border-input bg-background px-2 text-sm"
                  >
                    {MONTHS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                  <Input
                    className="w-20"
                    type="number"
                    value={yearFrom}
                    onChange={(e) => setYearFrom(Number(e.target.value))}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Ate</label>
                <div className="flex gap-1">
                  <select
                    value={monthTo}
                    onChange={(e) => setMonthTo(Number(e.target.value))}
                    className="h-10 rounded-md border border-input bg-background px-2 text-sm"
                  >
                    {MONTHS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                  <Input
                    className="w-20"
                    type="number"
                    value={yearTo}
                    onChange={(e) => setYearTo(Number(e.target.value))}
                  />
                </div>
              </div>
            </>
          )}

          {/* View mode toggles */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Visao</label>
            <div className="flex gap-1">
              <Button
                type="button"
                size="sm"
                variant={compareMode ? "default" : "outline"}
                onClick={() => setCompareMode(!compareMode)}
                disabled={companySelection.length < 2}
              >
                Comparativo entre empresas
              </Button>
            </div>
          </div>

          <Button type="button" onClick={handleApply}>Aplicar</Button>
        </div>
      </div>

      {/* DRE Table */}
      {filter.compareCompanies && rows[0]?.valuesByCompany ? (() => {
        // Comparative mode: one column per company + Var% between each pair
        const selectedCompanies = companies.filter((c) => selectedCompanyIds.includes(c.id));
        // Build column layout: Company1 | Company2 | Var% | Company3 | Var% | ...
        const compCols: Array<{ type: "company"; companyId: string; name: string } | { type: "var"; leftId: string; rightId: string }> = [];
        selectedCompanies.forEach((company, idx) => {
          compCols.push({ type: "company", companyId: company.id, name: company.name });
          if (idx > 0 && idx % 1 === 0) {
            // After every company (from the 2nd onward), add var% vs previous
            compCols.splice(compCols.length - 0, 0, {
              type: "var",
              leftId: selectedCompanies[idx - 1].id,
              rightId: company.id,
            });
          }
        });
        // Reorganize: Company1 | Company2 | Var%(1vs2) | Company3 | Var%(2vs3) ...
        const orderedCols: typeof compCols = [];
        for (let i = 0; i < selectedCompanies.length; i++) {
          orderedCols.push({ type: "company", companyId: selectedCompanies[i].id, name: selectedCompanies[i].name });
          if (i > 0) {
            orderedCols.push({ type: "var", leftId: selectedCompanies[i - 1].id, rightId: selectedCompanies[i].id });
          }
        }
        const gridCols = orderedCols.length;
        const gridTemplate = `minmax(320px, 2.6fr) repeat(${gridCols}, minmax(100px, 1fr))`;

        return (
          <div className="overflow-x-auto rounded-xl border bg-muted/50">
            <div style={{ minWidth: `${320 + gridCols * 110}px` }}>
              {/* Header */}
              <div className="grid border-b bg-muted px-4 py-3 text-xs font-semibold uppercase text-muted-foreground" style={{ gridTemplateColumns: gridTemplate }}>
                <span className="sticky left-0 z-10 bg-muted">Plano de Contas</span>
                {orderedCols.map((col, idx) =>
                  col.type === "company" ? (
                    <span key={`h-${idx}`} className="text-right">{col.name}</span>
                  ) : (
                    <span key={`h-${idx}`} className="text-center text-[10px] text-muted-foreground/60">Var %</span>
                  ),
                )}
              </div>

              {visibleRows.length === 0 ? (
                <div className="flex min-h-44 flex-col items-center justify-center gap-2 text-muted-foreground">
                  <Inbox className="h-6 w-6" />
                  <p className="text-sm">Nenhum dado encontrado.</p>
                </div>
              ) : null}

              {visibleRows.map((row) => {
                const isKeyResult = ["4", "6", "8", "11"].includes(row.code);
                const rowClass = isKeyResult ? "bg-background font-bold uppercase" : row.is_summary ? "bg-muted font-semibold" : "bg-card";
                const borderClass = isKeyResult ? "border-t-2 border-border" : "border-t border-border";
                const cv = row.valuesByCompany ?? {};

                return (
                  <div key={row.id} className={`grid px-4 py-2 text-sm ${rowClass} ${borderClass}`} style={{ gridTemplateColumns: gridTemplate }}>
                    <div className="sticky left-0 z-[1] flex items-center gap-2 bg-inherit" style={{ paddingLeft: `${(row.level - 1) * 14}px` }}>
                      {row.hasChildren ? (
                        <button type="button" onClick={() => setExpanded((prev) => ({ ...prev, [row.id]: !prev[row.id] }))} className="rounded p-0.5 text-muted-foreground hover:bg-muted">
                          {expanded[row.id] ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </button>
                      ) : (
                        <span className="w-4" />
                      )}
                      <button type="button" className="truncate text-left hover:underline" onClick={() => setSelectedAccountId(row.id)}>
                        {row.name}
                      </button>
                    </div>

                    {orderedCols.map((col, idx) => {
                      if (col.type === "company") {
                        return (
                          <div key={`${row.id}-c-${idx}`} className="text-right">
                            {formatCurrency(cv[col.companyId] ?? 0)}
                          </div>
                        );
                      }
                      const leftVal = cv[col.leftId] ?? 0;
                      const rightVal = cv[col.rightId] ?? 0;
                      return (
                        <div key={`${row.id}-v-${idx}`} className={`text-center text-xs ${varColor(leftVal, rightVal)}`}>
                          {formatVar(leftVal, rightVal)}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })() : (
        // Standard mode: monthly columns + total
        <div className="overflow-x-auto rounded-xl border bg-muted/50">
          <div style={{ minWidth: `${320 + totalCols * 120}px` }}>
            {/* Header */}
            <div
              className="grid border-b bg-muted px-4 py-3 text-xs font-semibold uppercase text-muted-foreground"
              style={{ gridTemplateColumns: `minmax(320px, 2.6fr) repeat(${totalCols}, minmax(110px, 1fr))` }}
            >
              <span className="sticky left-0 z-10 bg-muted">Plano de Contas</span>
              {columns.map((column) => (
                <span key={column.key} className="text-right">{column.label}</span>
              ))}
              <span className="text-right font-bold">{accumulatedBucket.label}</span>
            </div>

            {visibleRows.length === 0 ? (
              <div className="flex min-h-44 flex-col items-center justify-center gap-2 text-muted-foreground">
                <Inbox className="h-6 w-6" />
                <p className="text-sm">Nenhum dado encontrado para os filtros selecionados.</p>
              </div>
            ) : null}

            {/* Rows */}
            {visibleRows.map((row) => {
              const isKeyResult = ["4", "6", "8", "11"].includes(row.code);
              const rowClass = isKeyResult ? "bg-background font-bold uppercase" : row.is_summary ? "bg-muted font-semibold" : "bg-card";
              const borderClass = isKeyResult ? "border-t-2 border-slate-500" : "border-t border-slate-200";

              return (
                <div
                  key={row.id}
                  className={`grid px-4 py-2 text-sm ${rowClass} ${borderClass}`}
                  style={{ gridTemplateColumns: `minmax(320px, 2.6fr) repeat(${totalCols}, minmax(110px, 1fr))` }}
                >
                  {/* Account name */}
                  <div className="sticky left-0 z-[1] flex items-center gap-2 bg-inherit" style={{ paddingLeft: `${(row.level - 1) * 14}px` }}>
                    {row.hasChildren ? (
                      <button type="button" onClick={() => setExpanded((prev) => ({ ...prev, [row.id]: !prev[row.id] }))} className="rounded p-0.5 text-muted-foreground hover:bg-muted">
                        {expanded[row.id] ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </button>
                    ) : (
                      <span className="w-4" />
                    )}
                    <button
                      type="button"
                      className="truncate text-left hover:underline"
                      onClick={() => setSelectedAccountId(row.id)}
                    >
                      {row.name}
                    </button>
                  </div>

                  {/* Monthly values */}
                  {columns.map((column) => (
                    <div key={`${row.id}-${column.key}`} className="text-right">
                      <button
                        type="button"
                        className={`w-full text-right ${!row.is_summary ? "hover:underline" : ""}`}
                        onClick={() => {
                          if (row.is_summary) {
                            setExpanded((prev) => ({ ...prev, [row.id]: !prev[row.id] }));
                          } else {
                            void openDrilldown(
                              row,
                              column,
                              1,
                              drillSearch,
                              row.valuesByBucket[column.key] ?? 0,
                            );
                          }
                        }}
                      >
                        {formatCurrency(row.valuesByBucket[column.key] ?? 0)}
                      </button>
                    </div>
                  ))}

                  {/* Total column */}
                  <div className="text-right font-semibold">
                    {formatCurrency(row.accumulatedValue)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Evolution chart */}
      <div className="rounded-xl border bg-background p-4">
        <h3 className="text-lg font-semibold">Evolucao da Conta</h3>
        <p className="mb-3 text-sm text-muted-foreground">
          Conta selecionada: {selectedAccount ? `${selectedAccount.code} - ${selectedAccount.name}` : "-"}
        </p>
        <div className="h-80 w-full">
          {evolutionLoading ? (
            <div className="space-y-3 py-4">
              <Skeleton className="h-6 w-1/3" />
              <Skeleton className="h-60 w-full" />
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={evolutionData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" />
                <YAxis tickFormatter={(value) => formatCurrency(Number(value))} />
                <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                <Legend />
                {selectedCompanyIds.map((companyId, index) => {
                  const company = companies.find((item) => item.id === companyId);
                  const color = chartColors[index % chartColors.length];
                  return (
                    <Fragment key={companyId}>
                      <Area type="monotone" dataKey={companyId} stroke={color} fill={color} fillOpacity={0.12} name={company?.name ?? companyId} />
                      <Line type="monotone" dataKey={companyId} stroke={color} strokeWidth={2} dot={false} name={company?.name ?? companyId} />
                    </Fragment>
                  );
                })}
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Drilldown Sheet */}
      <Sheet open={drilldown.open} onOpenChange={(open) => setDrilldown((previous) => ({ ...previous, open }))}>
        <SheetContent className="left-auto right-0 max-w-5xl border-l border-r-0 p-5">
          <div className="space-y-4">
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-lg font-semibold">Drilldown</h3>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setDrilldown((previous) => ({ ...previous, open: false }))}
                >
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Voltar
                </Button>
              </div>
              <div className="mb-2 text-xs text-muted-foreground">
                DRE &gt; {drilldown.accountName} &gt; {drilldown.bucket.label}
              </div>
              <p className="text-sm text-muted-foreground">{drilldown.accountName} | {drilldown.bucket.label}</p>
            </div>

            {!drillLoading && Math.abs(drillAggregateTotal - drillCellValue) > 0.01 && (
              <div className="flex items-start justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <div>
                  <strong className="block">Dados do dashboard desatualizados.</strong>
                  <span>
                    Celula da DRE mostra <strong>{formatCurrency(drillCellValue)}</strong>,
                    mas o total real desta conta agora e{" "}
                    <strong>{formatCurrency(drillAggregateTotal)}</strong>.
                    Atualize para sincronizar.
                  </span>
                </div>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => router.refresh()}
                  className="shrink-0"
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Atualizar dashboard
                </Button>
              </div>
            )}

            <div className="flex items-center gap-2">
              <Input placeholder="Buscar descricao, fornecedor ou documento" value={drillSearch} onChange={(event) => setDrillSearch(event.target.value)} />
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const account = rows.find((row) => row.id === drilldown.accountId);
                  if (account) void openDrilldown(account, drilldown.bucket, 1, drillSearch);
                }}
              >
                <Search className="mr-2 h-4 w-4" />
                Buscar
              </Button>
            </div>

            <div className="overflow-hidden rounded-md border">
              <div className="grid grid-cols-[100px_2fr_1.5fr_140px_1fr] gap-2 bg-muted px-3 py-2 text-xs font-semibold uppercase text-muted-foreground">
                <span>Data Pgto</span><span>Descricao</span><span>Fornecedor/Cliente</span><span className="text-right">Valor</span><span>Unidade</span>
              </div>
              <div className="max-h-[420px] overflow-y-auto">
                {drillLoading ? (
                  <div className="flex items-center justify-center py-10 text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Carregando lancamentos...</div>
                ) : drillRows.length === 0 ? (
                  <p className="px-3 py-8 text-center text-sm text-muted-foreground">Nenhum lancamento encontrado.</p>
                ) : (
                  drillRows.map((row) => (
                    <div key={row.id} className="grid grid-cols-[100px_2fr_1.5fr_140px_1fr] gap-2 border-t px-3 py-2 text-sm">
                      <span>{new Date(row.payment_date).toLocaleDateString("pt-BR")}</span>
                      <span className="truncate cursor-default" title={row.description}>{row.description}</span>
                      <span className="truncate cursor-default" title={row.supplier_customer || "-"}>{row.supplier_customer || "-"}</span>
                      <span className="text-right">{formatCurrency(row.value)}</span>
                      <span>{row.company_name}</span>
                    </div>
                  ))
                )}
              </div>
              <div className="flex items-center justify-between border-t bg-muted px-3 py-2 text-sm">
                <div>
                  Registros: {drillTotal} | Total da pagina: <strong>{formatCurrency(drillTotalValue)}</strong>
                  {drillTotal > drillRows.length && (
                    <> | Total da conta: <strong>{formatCurrency(drillAggregateTotal)}</strong></>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <select value={String(drillPageSize)} onChange={(event) => setDrillPageSize(Number(event.target.value))} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
                    <option value="20">20</option><option value="50">50</option><option value="100">100</option>
                  </select>
                  <Button type="button" size="sm" variant="outline" disabled={drillPage <= 1} onClick={() => {
                    const account = rows.find((row) => row.id === drilldown.accountId);
                    if (account) void openDrilldown(account, drilldown.bucket, drillPage - 1, drillSearch);
                  }}><ChevronsLeft className="h-4 w-4" /></Button>
                  <span>Pagina {drillPage}</span>
                  <Button type="button" size="sm" variant="outline" disabled={drillPage * drillPageSize >= drillTotal} onClick={() => {
                    const account = rows.find((row) => row.id === drilldown.accountId);
                    if (account) void openDrilldown(account, drilldown.bucket, drillPage + 1, drillSearch);
                  }}><ChevronsRight className="h-4 w-4" /></Button>
                </div>
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
