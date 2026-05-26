"use client";

import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUpDown,
  FileSpreadsheet,
  Inbox,
  Loader2,
  RefreshCw,
  Search,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";

import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toaster";
import type {
  CashFlowAccountBase,
  CashFlowAccumulatedSection,
  CashFlowFilterState,
  CashFlowPeriodBucket,
  CashFlowRange,
  PeriodMode,
} from "@/lib/dashboard/cash-flow";
import {
  saveSharedCompanyFilter,
  useSharedCompanyFilterHydration,
} from "@/lib/dashboard/shared-company-filter";
import type { UserRole } from "@/lib/supabase/types";

interface CompanyOption {
  id: string;
  name: string;
}

interface CashFlowDisplayRow extends CashFlowAccountBase {
  hasChildren: boolean;
  valuesByBucket: Record<string, number>;
  accumulatedValue: number;
  valuesByCompany?: Record<string, number>;
}

interface CashFlowViewProps {
  filter: CashFlowFilterState;
  range: CashFlowRange;
  rows: CashFlowDisplayRow[];
  accounts: CashFlowAccountBase[];
  companies: CompanyOption[];
  role: UserRole;
  visibleBuckets: CashFlowPeriodBucket[];
  accumulatedBucket: CashFlowPeriodBucket;
  selectedCompanyIds: string[];
  lastSyncAt: string | null;
  accumulatedSection: CashFlowAccumulatedSection;
}

interface DrilldownState {
  open: boolean;
  accountId: string;
  accountName: string;
  bucket: CashFlowPeriodBucket;
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

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "decimal",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
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
      >
        <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
        Atualizar
      </button>
    </div>
  );
}

function CompanyMultiSelect({
  companies,
  selected,
  onChange,
  disabled,
}: {
  companies: CompanyOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const allSelected = selected.length === companies.length;
  const label =
    selected.length === 0
      ? "Nenhuma empresa"
      : allSelected
        ? "Todas as empresas"
        : selected.length === 1
          ? companies.find((c) => c.id === selected[0])?.name ?? "1 empresa"
          : `${selected.length} empresas`;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(!open)}
        className="flex h-10 w-full min-w-[200px] items-center justify-between rounded-md border border-input bg-background px-3 text-sm hover:bg-accent disabled:opacity-50"
      >
        <span className="truncate">{label}</span>
        <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 max-h-60 w-full min-w-[240px] overflow-y-auto rounded-md border bg-background shadow-lg">
          <label className="flex cursor-pointer items-center gap-2 border-b px-3 py-2 text-sm font-medium hover:bg-accent">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={(e) =>
                onChange(e.target.checked ? companies.map((c) => c.id) : [])
              }
            />
            Todas (Consolidado)
          </label>
          {companies.map((company) => (
            <label
              key={company.id}
              className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-accent"
            >
              <input
                type="checkbox"
                checked={selected.includes(company.id)}
                onChange={(e) =>
                  onChange(
                    e.target.checked
                      ? [...selected, company.id]
                      : selected.filter((id) => id !== company.id),
                  )
                }
              />
              {company.name}
              {selected.includes(company.id) && (
                <Check className="ml-auto h-3.5 w-3.5 text-primary" />
              )}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export function CashFlowView({
  filter,
  range,
  rows,
  companies,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  role,
  visibleBuckets,
  accumulatedBucket,
  selectedCompanyIds,
  lastSyncAt,
  accumulatedSection,
}: CashFlowViewProps) {
  const router = useRouter();
  const pathname = usePathname();
  // Compartilha filtro de empresas com Dashboard e Budget e Forecast via
  // sessionStorage. Hidrata no mount quando a URL nao traz companyIds.
  useSharedCompanyFilterHydration();
  const { showToast } = useToast();
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState<null | "excel">(null);

  const [periodMode, setPeriodMode] = useState<PeriodMode>(filter.periodMode);
  const [monthFrom, setMonthFrom] = useState(filter.monthFrom);
  const [yearFrom, setYearFrom] = useState(filter.yearFrom);
  const [monthTo, setMonthTo] = useState(filter.monthTo);
  const [yearTo, setYearTo] = useState(filter.yearTo);
  const [companySelection, setCompanySelection] = useState(filter.selectedCompanyIds);
  // Re-sincroniza com a prop quando a URL muda (hidratacao do filtro
  // compartilhado faz router.replace que troca filter.selectedCompanyIds).
  useEffect(() => {
    setCompanySelection(filter.selectedCompanyIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter.selectedCompanyIds.join(",")]);
  const [compareMode, setCompareMode] = useState(filter.compareCompanies);

  const [expanded, setExpanded] = useState<Record<string, boolean>>(
    () => rows.filter((r) => r.hasChildren).reduce((acc, r) => ({ ...acc, [r.id]: true }), {}),
  );

  // Subniveis dos acumulados iniciam COLAPSADOS para reduzir poluicao visual
  // — usuario que quiser ver detalhamento por socio expande manualmente.
  const [accAportesOpen, setAccAportesOpen] = useState(false);
  const [accDividendsOpen, setAccDividendsOpen] = useState(false);

  // Expand/collapse global — cobre tanto as linhas hierarquicas quanto a
  // secao "Acumulados" (sub-niveis por socio).
  const expandAllRows = () => {
    setExpanded(
      rows
        .filter((row) => row.hasChildren)
        .reduce((acc, row) => ({ ...acc, [row.id]: true }), {} as Record<string, boolean>),
    );
    setAccAportesOpen(true);
    setAccDividendsOpen(true);
  };
  const collapseAllRows = () => {
    setExpanded(
      rows
        .filter((row) => row.hasChildren)
        .reduce((acc, row) => ({ ...acc, [row.id]: false }), {} as Record<string, boolean>),
    );
    setAccAportesOpen(false);
    setAccDividendsOpen(false);
  };

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

  // Separa linhas em "principais" (codes 1-5) e "destaque" (is_highlight_block).
  // Renderizamos os dois grupos em blocos visualmente distintos.
  const { mainRows, highlightRows } = useMemo(() => {
    const byParent = new Map<string | null, CashFlowDisplayRow[]>();
    rows.forEach((row) => {
      if (row.is_highlight_block) return; // destaque trata a parte
      const siblings = byParent.get(row.parent_id) ?? [];
      siblings.push(row);
      byParent.set(row.parent_id, siblings);
    });
    byParent.forEach((siblings) => {
      siblings.sort((a, b) => a.sort_order - b.sort_order || a.code.localeCompare(b.code, undefined, { numeric: true }));
    });

    const flat: CashFlowDisplayRow[] = [];
    const walk = (parentId: string | null) => {
      (byParent.get(parentId) ?? []).forEach((child) => {
        flat.push(child);
        if (expanded[child.id]) walk(child.id);
      });
    };
    walk(null);

    const highlight = rows
      .filter((r) => r.is_highlight_block)
      .sort((a, b) => a.sort_order - b.sort_order);

    return { mainRows: flat, highlightRows: highlight };
  }, [rows, expanded]);

  const openDrilldown = async (
    account: CashFlowDisplayRow,
    bucket: CashFlowPeriodBucket,
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
    const response = await fetch(`/api/cash-flow/drilldown?${params.toString()}`, { cache: "no-store" });
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
    // Persiste o filtro de empresas para Dashboard e Budget e Forecast.
    saveSharedCompanyFilter(companySelection);
    router.push(`${pathname}?${params.toString()}`);
  };

  const columns = visibleBuckets;
  const totalCols = columns.length + 1;

  // Export Excel — mesma estrutura visual da tela (analiticas com indent,
  // bloco "Fluxo de Caixa" e secao "Acumulados" no final). Inclui sempre
  // TODOS os niveis e sub-niveis de socio, independentemente do estado de
  // expand/collapse na UI: o usuario que exporta quer a foto completa.
  const exportCashFlowExcel = () => {
    try {
      setExporting("excel");
      const totalLabel = accumulatedBucket.label || "Total";
      const sheetRows: Array<Record<string, string | number>> = [];

      const pushRow = (
        name: string,
        valuesByBucket: Record<string, number>,
        accumulated: number,
      ) => {
        const record: Record<string, string | number> = { Conta: name };
        columns.forEach((column) => {
          record[column.label] = Number(valuesByBucket[column.key] ?? 0);
        });
        record[totalLabel] = Number(accumulated ?? 0);
        sheetRows.push(record);
      };

      const pushSeparator = (label: string) => {
        const record: Record<string, string | number> = { Conta: label };
        columns.forEach((column) => {
          record[column.label] = "";
        });
        record[totalLabel] = "";
        sheetRows.push(record);
      };

      // Walk hierarquico completo das linhas principais (sem respeitar o
      // estado de expanded — sempre exporta tudo).
      const byParent = new Map<string | null, CashFlowDisplayRow[]>();
      rows.forEach((row) => {
        if (row.is_highlight_block) return;
        const siblings = byParent.get(row.parent_id) ?? [];
        siblings.push(row);
        byParent.set(row.parent_id, siblings);
      });
      byParent.forEach((siblings) => {
        siblings.sort(
          (a, b) =>
            a.sort_order - b.sort_order ||
            a.code.localeCompare(b.code, undefined, { numeric: true }),
        );
      });
      const walk = (parentId: string | null) => {
        (byParent.get(parentId) ?? []).forEach((child) => {
          const indent = "  ".repeat(Math.max(0, child.level - 1));
          pushRow(`${indent}${child.name}`, child.valuesByBucket, child.accumulatedValue);
          walk(child.id);
        });
      };
      walk(null);

      // Bloco destaque "Fluxo de Caixa".
      if (highlightRows.length > 0) {
        pushSeparator("FLUXO DE CAIXA");
        highlightRows.forEach((row) => {
          pushRow(row.name, row.valuesByBucket, row.accumulatedValue);
        });
      }

      // Bloco "Acumulados" (Aportes + Dividendos), com socios sempre incluidos.
      if (accumulatedSection.showAportes || accumulatedSection.showDividends) {
        pushSeparator("ACUMULADOS");
        if (accumulatedSection.showAportes) {
          pushRow(
            "APORTES ACUMULADOS",
            accumulatedSection.aportes.totalsByBucket,
            accumulatedSection.aportes.accumulatedTotal,
          );
          accumulatedSection.aportes.partners.forEach((p) => {
            pushRow(`  ${p.name}`, p.valuesByBucket, p.accumulatedTotal);
          });
        }
        if (accumulatedSection.showDividends) {
          pushRow(
            "DIVIDENDOS ACUMULADOS",
            accumulatedSection.dividends.totalsByBucket,
            accumulatedSection.dividends.accumulatedTotal,
          );
          accumulatedSection.dividends.partners.forEach((p) => {
            pushRow(`  ${p.name}`, p.valuesByBucket, p.accumulatedTotal);
          });
        }
      }

      const worksheet = XLSX.utils.json_to_sheet(sheetRows);
      // Formata todas as colunas numericas como moeda BRL — mesmo padrao do
      // export do DRE.
      const rangeRef = XLSX.utils.decode_range(worksheet["!ref"] ?? "A1:A1");
      for (let rowIndex = 1; rowIndex <= rangeRef.e.r; rowIndex += 1) {
        for (let colIndex = 1; colIndex <= rangeRef.e.c; colIndex += 1) {
          const cellAddress = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
          const cell = worksheet[cellAddress];
          if (!cell || cell.v === "" || typeof cell.v !== "number") continue;
          cell.z = "R$ #,##0.00";
        }
      }

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Fluxo de Caixa");

      const allCompaniesSelected = companies.length === selectedCompanyIds.length;
      const unitsLabel = allCompaniesSelected
        ? "Consolidado"
        : companies
            .filter((company) => selectedCompanyIds.includes(company.id))
            .map((company) => company.name)
            .join("_");
      const periodLabel = range.label.replace(/\s+/g, "_");

      XLSX.writeFile(
        workbook,
        `FluxoDeCaixa_ControllHub_${unitsLabel || "Consolidado"}_${periodLabel || "Periodo"}.xlsx`,
      );
      showToast({
        title: "Exportacao concluida",
        description: "Excel do Fluxo de Caixa gerado.",
        variant: "success",
      });
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

  // Linhas que aceitam drilldown (analiticas com mapeamento) — exclui linhas
  // calculadas, summary e linhas com source especial.
  const isDrillable = (row: CashFlowDisplayRow) =>
    !row.is_summary && !row.source && row.type !== "calculado";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-xl border bg-background p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold">Fluxo de Caixa</h2>
            <p className="text-sm text-muted-foreground">{range.label}</p>
          </div>
          <div className="flex items-center gap-2">
            <SyncFreshnessIndicator
              lastSyncAt={lastSyncAt}
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                router.refresh();
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
                  onClick={exportCashFlowExcel}
                  disabled={exporting !== null || rows.length === 0}
                >
                  {exporting === "excel" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <FileSpreadsheet className="mr-2 h-4 w-4" />
                  )}
                  Excel
                </Button>
              </div>
            </details>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="space-y-4 rounded-xl border bg-background p-4">
        <div className="flex flex-wrap items-start gap-4">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Empresas</label>
            <CompanyMultiSelect
              companies={companies}
              selected={companySelection}
              onChange={(ids) => setCompanySelection(ids)}
              disabled={companies.length <= 1}
            />
            {/* Expandir / recolher todas — abaixo do seletor de empresa para
                melhor visibilidade. Acao puramente client-side. */}
            <div className="flex gap-1 pt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={expandAllRows}
                title="Expandir todas as linhas"
                aria-label="Expandir todas as linhas"
              >
                <ChevronsUpDown className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={collapseAllRows}
                title="Recolher todas as linhas"
                aria-label="Recolher todas as linhas"
              >
                <ChevronsDownUp className="h-4 w-4" />
              </Button>
            </div>
          </div>

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
                      <option key={m.value} value={m.value}>{m.label}</option>
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
                      <option key={m.value} value={m.value}>{m.label}</option>
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

          {/* Spacer simula altura do label para alinhar o Aplicar com a
              linha dos outros botoes apos mudanca para items-start. */}
          <div className="space-y-1">
            <span aria-hidden className="block text-xs font-medium opacity-0">.</span>
            <Button type="button" onClick={handleApply}>Aplicar</Button>
          </div>
        </div>
      </div>

      {/* Tabela */}
      {filter.compareCompanies && rows[0]?.valuesByCompany ? (() => {
        const selectedCompanies = companies.filter((c) => selectedCompanyIds.includes(c.id));
        const orderedCols: Array<
          { type: "company"; companyId: string; name: string }
          | { type: "var"; leftId: string; rightId: string }
        > = [];
        for (let i = 0; i < selectedCompanies.length; i += 1) {
          orderedCols.push({ type: "company", companyId: selectedCompanies[i].id, name: selectedCompanies[i].name });
          if (i > 0) {
            orderedCols.push({ type: "var", leftId: selectedCompanies[i - 1].id, rightId: selectedCompanies[i].id });
          }
        }
        const gridCols = orderedCols.length;
        const gridTemplate = `minmax(320px, 2.6fr) repeat(${gridCols}, minmax(110px, 1fr))`;

        const renderRow = (row: CashFlowDisplayRow, isHighlight: boolean) => {
          const cv = row.valuesByCompany ?? {};
          const isMainTotal = !isHighlight && row.level === 1;
          const rowClass = isHighlight
            ? "bg-viva-50 font-bold uppercase border-t-2 border-viva-500"
            : isMainTotal
              ? "bg-background font-bold uppercase border-t-2 border-slate-500"
              : row.is_summary
                ? "bg-muted font-semibold border-t border-border"
                : "bg-muted/50 border-t border-border";
          const stickyBgClass = isHighlight
            ? "bg-viva-50"
            : isMainTotal
              ? "bg-background"
              : row.is_summary
                ? "bg-muted"
                : "bg-card";
          return (
            <div key={row.id} className={`grid px-4 py-2 text-sm ${rowClass}`} style={{ gridTemplateColumns: gridTemplate }}>
              <div className={`sticky left-0 z-[2] flex items-center gap-2 ${stickyBgClass}`} style={{ paddingLeft: `${(row.level - 1) * 14}px` }}>
                {row.hasChildren && !isHighlight ? (
                  <button type="button" onClick={() => setExpanded((prev) => ({ ...prev, [row.id]: !prev[row.id] }))} className="rounded p-0.5 text-muted-foreground hover:bg-muted">
                    {expanded[row.id] ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>
                ) : (
                  <span className="w-4" />
                )}
                <span className="truncate">{row.name}</span>
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
        };

        return (
          <div className="overflow-x-auto rounded-xl border bg-muted/50">
            <div style={{ minWidth: `${320 + gridCols * 110}px` }}>
              <div className="grid border-b bg-muted px-4 py-3 text-xs font-semibold uppercase text-muted-foreground" style={{ gridTemplateColumns: gridTemplate }}>
                <span className="sticky left-0 z-10 bg-muted">Conta</span>
                {orderedCols.map((col, idx) =>
                  col.type === "company" ? (
                    <span key={`h-${idx}`} className="text-right">{col.name}</span>
                  ) : (
                    <span key={`h-${idx}`} className="text-center text-[10px] text-muted-foreground/60">Var %</span>
                  ),
                )}
              </div>
              {mainRows.length === 0 && highlightRows.length === 0 ? (
                <div className="flex min-h-44 flex-col items-center justify-center gap-2 text-muted-foreground">
                  <Inbox className="h-6 w-6" />
                  <p className="text-sm">Nenhum dado encontrado.</p>
                </div>
              ) : (
                <>
                  {mainRows.map((row) => renderRow(row, false))}
                  {highlightRows.map((row) => renderRow(row, true))}
                </>
              )}
            </div>
          </div>
        );
      })() : (
        <div className="overflow-x-auto rounded-xl border bg-muted/50">
          <div style={{ minWidth: `${320 + totalCols * 120}px` }}>
            <div
              className="grid border-b bg-muted px-4 py-3 text-xs font-semibold uppercase text-muted-foreground"
              style={{ gridTemplateColumns: `minmax(320px, 2.6fr) repeat(${totalCols}, minmax(110px, 1fr))` }}
            >
              <span className="sticky left-0 z-10 bg-muted">Conta</span>
              {columns.map((column) => (
                <span key={column.key} className="text-right">{column.label}</span>
              ))}
              <span className="text-right font-bold">{accumulatedBucket.label}</span>
            </div>

            {mainRows.length === 0 && highlightRows.length === 0 ? (
              <div className="flex min-h-44 flex-col items-center justify-center gap-2 text-muted-foreground">
                <Inbox className="h-6 w-6" />
                <p className="text-sm">Nenhum dado encontrado para os filtros selecionados.</p>
              </div>
            ) : null}

            {mainRows.map((row) => {
              const isMainTotal = row.level === 1;
              const rowClass = isMainTotal
                ? "bg-background font-bold uppercase"
                : row.is_summary
                  ? "bg-muted font-semibold"
                  : "bg-muted/50";
              const stickyBgClass = isMainTotal
                ? "bg-background"
                : row.is_summary
                  ? "bg-muted"
                  : "bg-card";
              const borderClass = isMainTotal
                ? "border-t-2 border-slate-500"
                : "border-t border-slate-200";
              return (
                <div
                  key={row.id}
                  className={`grid ${borderClass} px-4 py-2 text-sm ${rowClass}`}
                  style={{ gridTemplateColumns: `minmax(320px, 2.6fr) repeat(${totalCols}, minmax(110px, 1fr))` }}
                >
                  <div className={`sticky left-0 z-[2] flex items-center gap-2 ${stickyBgClass}`} style={{ paddingLeft: `${(row.level - 1) * 14}px` }}>
                    {row.hasChildren ? (
                      <button
                        type="button"
                        onClick={() => setExpanded((prev) => ({ ...prev, [row.id]: !prev[row.id] }))}
                        className="rounded p-0.5 text-muted-foreground hover:bg-muted"
                      >
                        {expanded[row.id] ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </button>
                    ) : (
                      <span className="w-4" />
                    )}
                    <span className="truncate">{row.name}</span>
                  </div>

                  {columns.map((column) => (
                    <div key={`${row.id}-${column.key}`} className="text-right">
                      {isDrillable(row) ? (
                        <button
                          type="button"
                          className="w-full text-right hover:underline"
                          onClick={() => void openDrilldown(row, column, 1, drillSearch)}
                        >
                          {formatCurrency(row.valuesByBucket[column.key] ?? 0)}
                        </button>
                      ) : (
                        formatCurrency(row.valuesByBucket[column.key] ?? 0)
                      )}
                    </div>
                  ))}

                  <div className="text-right font-semibold">
                    {formatCurrency(row.accumulatedValue)}
                  </div>
                </div>
              );
            })}

            {/* Bloco destaque — Saldo Inicial / Caixa Gerado / Caixa Final */}
            {highlightRows.length > 0 && (
              <>
                <div
                  className="grid border-t-4 border-viva-500 bg-viva-500/10 px-4 py-2 text-xs font-bold uppercase tracking-wide text-viva-700"
                  style={{ gridTemplateColumns: `minmax(320px, 2.6fr) repeat(${totalCols}, minmax(110px, 1fr))` }}
                >
                  <span className="sticky left-0 z-[2] bg-card">Fluxo de Caixa</span>
                  {Array.from({ length: totalCols }).map((_, i) => (
                    <span key={`hl-h-${i}`} />
                  ))}
                </div>
                {highlightRows.map((row) => (
                  <div
                    key={row.id}
                    className="grid border-t border-viva-500/40 bg-viva-500/5 px-4 py-2 text-sm font-semibold"
                    style={{ gridTemplateColumns: `minmax(320px, 2.6fr) repeat(${totalCols}, minmax(110px, 1fr))` }}
                  >
                    <div className="sticky left-0 z-[2] flex items-center gap-2 bg-card">
                      <span className="w-4" />
                      <span className="truncate">{row.name}</span>
                    </div>
                    {columns.map((column) => (
                      <div key={`${row.id}-${column.key}`} className="text-right">
                        {formatCurrency(row.valuesByBucket[column.key] ?? 0)}
                      </div>
                    ))}
                    <div className="text-right font-bold">
                      {formatCurrency(row.accumulatedValue)}
                    </div>
                  </div>
                ))}
              </>
            )}

            {/* Bloco destaque — Aportes / Dividendos Acumulados.
                Renderizado APOS o bloco "Fluxo de Caixa". Apenas o header
                "Acumulados" e destacado em indigo; totalizadoras usam cor de
                texto padrao (foreground) para melhor leitura no tema escuro.
                Subniveis por socio iniciam COLAPSADOS — chevron expande. */}
            {(accumulatedSection.showAportes || accumulatedSection.showDividends) && (
              <>
                <div
                  className="grid border-t-4 border-indigo-500 bg-indigo-500/10 px-4 py-2 text-xs font-bold uppercase tracking-wide text-indigo-700"
                  style={{ gridTemplateColumns: `minmax(320px, 2.6fr) repeat(${totalCols}, minmax(110px, 1fr))` }}
                >
                  <span className="sticky left-0 z-[2] bg-card">Acumulados</span>
                  {Array.from({ length: totalCols }).map((_, i) => (
                    <span key={`acc-h-${i}`} />
                  ))}
                </div>

                {accumulatedSection.showAportes && (
                  <>
                    <div
                      className="grid border-t border-indigo-500/40 bg-indigo-500/10 px-4 py-2 text-sm font-bold uppercase"
                      style={{ gridTemplateColumns: `minmax(320px, 2.6fr) repeat(${totalCols}, minmax(110px, 1fr))` }}
                    >
                      <div className="sticky left-0 z-[2] flex items-center gap-2 bg-card">
                        {accumulatedSection.aportes.partners.length > 0 ? (
                          <button
                            type="button"
                            onClick={() => setAccAportesOpen((prev) => !prev)}
                            className="rounded p-0.5 text-muted-foreground hover:bg-muted"
                            aria-label={accAportesOpen ? "Recolher socios" : "Expandir socios"}
                          >
                            {accAportesOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </button>
                        ) : (
                          <span className="w-4" />
                        )}
                        <span className="truncate">Aportes Acumulados</span>
                      </div>
                      {columns.map((column) => (
                        <div key={`acc-ap-tot-${column.key}`} className="text-right">
                          {formatCurrency(accumulatedSection.aportes.totalsByBucket[column.key] ?? 0)}
                        </div>
                      ))}
                      <div className="text-right font-bold">
                        {formatCurrency(accumulatedSection.aportes.accumulatedTotal)}
                      </div>
                    </div>
                    {accAportesOpen && accumulatedSection.aportes.partners.map((p) => (
                      <div
                        key={p.id}
                        className="grid border-t border-indigo-500/20 bg-indigo-500/[0.03] px-4 py-2 text-sm"
                        style={{ gridTemplateColumns: `minmax(320px, 2.6fr) repeat(${totalCols}, minmax(110px, 1fr))` }}
                      >
                        <div className="sticky left-0 z-[2] flex items-center gap-2 bg-card pl-4">
                          <span className="w-4" />
                          <span className="truncate text-muted-foreground">{p.name}</span>
                        </div>
                        {columns.map((column) => (
                          <div key={`${p.id}-${column.key}`} className="text-right">
                            {formatCurrency(p.valuesByBucket[column.key] ?? 0)}
                          </div>
                        ))}
                        <div className="text-right font-semibold">
                          {formatCurrency(p.accumulatedTotal)}
                        </div>
                      </div>
                    ))}
                  </>
                )}

                {accumulatedSection.showDividends && (
                  <>
                    <div
                      className="grid border-t border-indigo-500/40 bg-indigo-500/10 px-4 py-2 text-sm font-bold uppercase"
                      style={{ gridTemplateColumns: `minmax(320px, 2.6fr) repeat(${totalCols}, minmax(110px, 1fr))` }}
                    >
                      <div className="sticky left-0 z-[2] flex items-center gap-2 bg-card">
                        {accumulatedSection.dividends.partners.length > 0 ? (
                          <button
                            type="button"
                            onClick={() => setAccDividendsOpen((prev) => !prev)}
                            className="rounded p-0.5 text-muted-foreground hover:bg-muted"
                            aria-label={accDividendsOpen ? "Recolher socios" : "Expandir socios"}
                          >
                            {accDividendsOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </button>
                        ) : (
                          <span className="w-4" />
                        )}
                        <span className="truncate">Dividendos Acumulados</span>
                      </div>
                      {columns.map((column) => (
                        <div key={`acc-dv-tot-${column.key}`} className="text-right">
                          {formatCurrency(accumulatedSection.dividends.totalsByBucket[column.key] ?? 0)}
                        </div>
                      ))}
                      <div className="text-right font-bold">
                        {formatCurrency(accumulatedSection.dividends.accumulatedTotal)}
                      </div>
                    </div>
                    {accDividendsOpen && accumulatedSection.dividends.partners.map((p) => (
                      <div
                        key={p.id}
                        className="grid border-t border-indigo-500/20 bg-indigo-500/[0.03] px-4 py-2 text-sm"
                        style={{ gridTemplateColumns: `minmax(320px, 2.6fr) repeat(${totalCols}, minmax(110px, 1fr))` }}
                      >
                        <div className="sticky left-0 z-[2] flex items-center gap-2 bg-card pl-4">
                          <span className="w-4" />
                          <span className="truncate text-muted-foreground">{p.name}</span>
                        </div>
                        {columns.map((column) => (
                          <div key={`${p.id}-${column.key}`} className="text-right">
                            {formatCurrency(p.valuesByBucket[column.key] ?? 0)}
                          </div>
                        ))}
                        <div className="text-right font-semibold">
                          {formatCurrency(p.accumulatedTotal)}
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Drilldown */}
      <Sheet open={drilldown.open} onOpenChange={(open) => setDrilldown((prev) => ({ ...prev, open }))}>
        <SheetContent className="left-auto right-0 max-w-5xl border-l border-r-0 p-5">
          <div className="space-y-4">
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-lg font-semibold">Drilldown</h3>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setDrilldown((prev) => ({ ...prev, open: false }))}
                >
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Voltar
                </Button>
              </div>
              <div className="mb-2 text-xs text-muted-foreground">
                Fluxo de Caixa &gt; {drilldown.accountName} &gt; {drilldown.bucket.label}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Input
                placeholder="Buscar descricao, fornecedor ou documento"
                value={drillSearch}
                onChange={(e) => setDrillSearch(e.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const account = rows.find((r) => r.id === drilldown.accountId);
                  if (account) void openDrilldown(account, drilldown.bucket, 1, drillSearch);
                }}
              >
                <Search className="mr-2 h-4 w-4" />
                Buscar
              </Button>
            </div>

            <div className="overflow-hidden rounded-md border">
              <div className="grid grid-cols-[100px_2fr_1.5fr_140px_1fr] gap-2 bg-muted px-3 py-2 text-xs font-semibold uppercase text-muted-foreground">
                <span>Data Pgto</span><span>Descricao</span><span>Fornecedor/Cliente</span>
                <span className="text-right">Valor</span><span>Unidade</span>
              </div>
              <div className="max-h-[420px] overflow-y-auto">
                {drillLoading ? (
                  <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />Carregando lancamentos...
                  </div>
                ) : drillRows.length === 0 ? (
                  <p className="px-3 py-8 text-center text-sm text-muted-foreground">Nenhum lancamento encontrado.</p>
                ) : (
                  drillRows.map((row) => (
                    <div key={row.id} className="grid grid-cols-[100px_2fr_1.5fr_140px_1fr] gap-2 border-t px-3 py-2 text-sm">
                      <span>{new Date(row.payment_date).toLocaleDateString("pt-BR")}</span>
                      <span className="truncate" title={row.description}>{row.description}</span>
                      <span className="truncate" title={row.supplier_customer || "-"}>{row.supplier_customer || "-"}</span>
                      <span className="text-right">{formatCurrency(row.value)}</span>
                      <span>{row.company_name}</span>
                    </div>
                  ))
                )}
              </div>
              <div className="flex items-center justify-between border-t bg-muted px-3 py-2 text-sm">
                <div>
                  Registros: {drillTotal} | Total da pagina: <strong>{formatCurrency(drillTotalValue)}</strong>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={String(drillPageSize)}
                    onChange={(e) => setDrillPageSize(Number(e.target.value))}
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  >
                    <option value="20">20</option><option value="50">50</option><option value="100">100</option>
                  </select>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={drillPage <= 1}
                    onClick={() => {
                      const account = rows.find((r) => r.id === drilldown.accountId);
                      if (account) void openDrilldown(account, drilldown.bucket, drillPage - 1, drillSearch);
                    }}
                  >
                    <ChevronsLeft className="h-4 w-4" />
                  </Button>
                  <span>Pagina {drillPage}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={drillPage * drillPageSize >= drillTotal}
                    onClick={() => {
                      const account = rows.find((r) => r.id === drilldown.accountId);
                      if (account) void openDrilldown(account, drilldown.bucket, drillPage + 1, drillSearch);
                    }}
                  >
                    <ChevronsRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
