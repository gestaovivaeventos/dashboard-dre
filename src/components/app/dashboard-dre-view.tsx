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
import type {
  DashboardFilterState,
  DashboardRange,
  DashboardPeriodBucket,
  ViewMode,
} from "@/lib/dashboard/dre";
import type { UserRole } from "@/lib/supabase/types";

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
  variationPercentage: number;
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
const percentageFormatter = new Intl.NumberFormat("pt-BR", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function formatCurrency(value: number) {
  return currencyFormatter.format(value);
}

function formatPercentage(value: number) {
  return percentageFormatter.format(value / 100);
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
}: DashboardDreViewProps) {
  const { showToast } = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const [viewMode, setViewMode] = useState<ViewMode>(filter.viewMode);
  const [periodType, setPeriodType] = useState(filter.periodType);
  const [year, setYear] = useState(String(filter.year));
  const [month, setMonth] = useState(String(filter.month));
  const [quarter, setQuarter] = useState(String(filter.quarter));
  const [semester, setSemester] = useState(String(filter.semester));
  const [startDate, setStartDate] = useState(filter.startDate);
  const [endDate, setEndDate] = useState(filter.endDate);
  const [companySelection, setCompanySelection] = useState(filter.selectedCompanyIds);

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
  ) => {
    setDrilldown({
      open: true,
      accountId: account.id,
      accountName: `${account.code} - ${account.name}`,
      bucket,
    });
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
    };
    setDrillRows(payload.rows ?? []);
    setDrillTotal(payload.total ?? 0);
    setDrillTotalValue(payload.totalValue ?? 0);
    setDrillPage(page);
    setDrillLoading(false);
  };

  const handleApply = () => {
    const params = new URLSearchParams();
    params.set("viewMode", viewMode);
    params.set("periodType", periodType);
    params.set("year", year);
    if (periodType === "mensal") params.set("month", month);
    if (periodType === "trimestral") params.set("quarter", quarter);
    if (periodType === "semestral") params.set("semester", semester);
    if (periodType === "acumulado") {
      params.set("startDate", startDate);
      params.set("endDate", endDate);
    }
    const allSelected = companySelection.length === companies.length;
    if (!allSelected) params.set("companyIds", companySelection.join(","));
    router.push(`${pathname}?${params.toString()}`);
  };

  const toggleCompany = (companyId: string, checked: boolean) => {
    if (role === "gestor_unidade") return;
    setCompanySelection((previous) =>
      checked
        ? Array.from(new Set([...previous, companyId]))
        : previous.filter((id) => id !== companyId),
    );
  };

  const selectAllCompanies = (checked: boolean) => {
    if (role === "gestor_unidade") return;
    setCompanySelection(checked ? companies.map((company) => company.id) : []);
  };

  const columns = viewMode === "comparativa" ? visibleBuckets : [visibleBuckets[0] ?? accumulatedBucket];
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
        record["Var %"] = Number(row.variationPercentage ?? 0) / 100;
        return record;
      });

      const worksheet = XLSX.utils.json_to_sheet(sheetRows);
      const rangeRef = XLSX.utils.decode_range(worksheet["!ref"] ?? "A1:A1");
      for (let rowIndex = 1; rowIndex <= rangeRef.e.r; rowIndex += 1) {
        for (let colIndex = 1; colIndex <= rangeRef.e.c; colIndex += 1) {
          const cellAddress = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
          const cell = worksheet[cellAddress];
          if (!cell) continue;
          if (colIndex === rangeRef.e.c) {
            cell.z = "0.00%";
          } else {
            cell.z = "R$ #,##0.00";
          }
        }
      }

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "DRE");
      XLSX.writeFile(
        workbook,
        `DRE_Hero_${unitsLabel || "Consolidado"}_${periodLabel || "Periodo"}.xlsx`,
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
      anchor.download = `DRE_Hero_${unitsLabel || "Consolidado"}_${periodLabel || "Periodo"}.pdf`;
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

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-background p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-2xl font-semibold">DRE Gerencial</h2>
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
        <p className="text-sm text-muted-foreground">{range.label}</p>
      </div>

      <div className="space-y-4 rounded-xl border bg-background p-4">
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant={viewMode === "simples" ? "default" : "outline"} onClick={() => setViewMode("simples")}>
            Visao Simples
          </Button>
          <Button type="button" variant={viewMode === "comparativa" ? "default" : "outline"} onClick={() => setViewMode("comparativa")}>
            Visao Comparativa
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          {(["mensal", "trimestral", "semestral", "anual", "acumulado"] as const).map((mode) => (
            <Button
              key={mode}
              type="button"
              variant={periodType === mode ? "default" : "outline"}
              onClick={() => setPeriodType(mode)}
            >
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

        <details className="rounded-md border p-3">
          <summary className="cursor-pointer text-sm font-medium">
            Unidade ({companySelection.length}/{companies.length})
          </summary>
          <div className="mt-3 space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={companySelection.length === companies.length} onChange={(event) => selectAllCompanies(event.target.checked)} disabled={role === "gestor_unidade"} />
              Todas (Consolidado)
            </label>
            {companies.map((company) => (
              <label key={company.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={companySelection.includes(company.id)} onChange={(event) => toggleCompany(company.id, event.target.checked)} disabled={role === "gestor_unidade"} />
                {company.name}
              </label>
            ))}
          </div>
        </details>

        <Button type="button" onClick={handleApply}>Aplicar Filtros</Button>
      </div>

      <div className="overflow-x-auto rounded-xl border bg-[#f3f3f3]">
        <div className="min-w-[980px]">
          <div
            className="grid border-b bg-slate-100 px-4 py-3 text-xs font-semibold uppercase text-slate-600"
            style={{ gridTemplateColumns: `minmax(320px, 2.6fr) repeat(${columns.length}, minmax(120px, 1fr)) minmax(130px,1fr) minmax(110px,1fr)` }}
          >
            <span className="sticky left-0 z-10 bg-slate-100">Plano de Contas</span>
            {columns.map((column) => (
              <span key={column.key} className="text-right">{column.label}</span>
            ))}
            <span className="text-right">{accumulatedBucket.label}</span>
            <span className="text-right">Var %</span>
          </div>

          {visibleRows.length === 0 ? (
            <div className="flex min-h-44 flex-col items-center justify-center gap-2 text-muted-foreground">
              <Inbox className="h-6 w-6" />
              <p className="text-sm">Nenhum dado encontrado para os filtros selecionados.</p>
            </div>
          ) : null}
          {visibleRows.map((row) => {
            const isKeyResult = ["4", "6", "8", "11"].includes(row.code);
            const rowClass = isKeyResult ? "bg-white font-bold uppercase" : row.is_summary ? "bg-[#f7f7f7] font-semibold" : "bg-[#f3f3f3]";
            const borderClass = isKeyResult ? "border-t-2 border-slate-500" : "border-t border-slate-200";

            return (
              <div
                key={row.id}
                className={`grid px-4 py-2 text-sm ${rowClass} ${borderClass}`}
                style={{ gridTemplateColumns: `minmax(320px, 2.6fr) repeat(${columns.length}, minmax(120px, 1fr)) minmax(130px,1fr) minmax(110px,1fr)` }}
              >
                <div className="sticky left-0 z-[1] flex items-center gap-2 bg-inherit" style={{ paddingLeft: `${(row.level - 1) * 14}px` }}>
                  {row.hasChildren ? (
                    <button type="button" onClick={() => setExpanded((prev) => ({ ...prev, [row.id]: !prev[row.id] }))} className="rounded p-0.5 text-slate-500 hover:bg-slate-200">
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

                {columns.map((column) => (
                  <div key={`${row.id}-${column.key}`} className="text-right">
                    <button
                      type="button"
                      className={`w-full text-right ${!row.is_summary ? "hover:underline" : ""}`}
                      onClick={() => {
                        if (row.is_summary) {
                          setExpanded((prev) => ({ ...prev, [row.id]: !prev[row.id] }));
                        } else {
                          void openDrilldown(row, column, 1, drillSearch);
                        }
                      }}
                    >
                      {formatCurrency(row.valuesByBucket[column.key] ?? 0)}
                    </button>
                  </div>
                ))}

                <div className="text-right">{formatCurrency(row.accumulatedValue)}</div>
                <div className={`text-right ${row.variationPercentage >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                  {formatPercentage(row.variationPercentage)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

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
              <div className="grid grid-cols-[100px_2fr_1.5fr_140px_140px_1fr] gap-2 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase text-slate-600">
                <span>Data Pgto</span><span>Descricao</span><span>Fornecedor/Cliente</span><span>N Documento</span><span className="text-right">Valor</span><span>Unidade</span>
              </div>
              <div className="max-h-[420px] overflow-y-auto">
                {drillLoading ? (
                  <div className="flex items-center justify-center py-10 text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Carregando lancamentos...</div>
                ) : drillRows.length === 0 ? (
                  <p className="px-3 py-8 text-center text-sm text-muted-foreground">Nenhum lancamento encontrado.</p>
                ) : (
                  drillRows.map((row) => (
                    <div key={row.id} className="grid grid-cols-[100px_2fr_1.5fr_140px_140px_1fr] gap-2 border-t px-3 py-2 text-sm">
                      <span>{new Date(row.payment_date).toLocaleDateString("pt-BR")}</span>
                      <span className="truncate">{row.description}</span>
                      <span className="truncate">{row.supplier_customer || "-"}</span>
                      <span>{row.document_number || "-"}</span>
                      <span className="text-right">{formatCurrency(row.value)}</span>
                      <span>{row.company_name}</span>
                    </div>
                  ))
                )}
              </div>
              <div className="flex items-center justify-between border-t bg-slate-50 px-3 py-2 text-sm">
                <div>Registros: {drillTotal} | Total da pagina: <strong>{formatCurrency(drillTotalValue)}</strong></div>
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
