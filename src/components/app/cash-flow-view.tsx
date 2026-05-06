"use client";

import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Inbox,
  Loader2,
  RefreshCw,
  Search,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import type {
  CashFlowAccountBase,
  CashFlowFilterState,
  CashFlowPeriodBucket,
  CashFlowRange,
  PeriodMode,
} from "@/lib/dashboard/cash-flow";
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
  role,
  visibleBuckets,
  accumulatedBucket,
  selectedCompanyIds,
  lastSyncAt,
}: CashFlowViewProps) {
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
    () => rows.filter((r) => r.hasChildren).reduce((acc, r) => ({ ...acc, [r.id]: true }), {}),
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
    router.push(`${pathname}?${params.toString()}`);
  };

  const columns = visibleBuckets;
  const totalCols = columns.length + 1;

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
          <SyncFreshnessIndicator
            lastSyncAt={lastSyncAt}
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              router.refresh();
              window.setTimeout(() => setRefreshing(false), 1500);
            }}
          />
        </div>
      </div>

      {/* Filters */}
      <div className="space-y-4 rounded-xl border bg-background p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Empresas</label>
            <CompanyMultiSelect
              companies={companies}
              selected={companySelection}
              onChange={(ids) => {
                if (role !== "gestor_unidade") setCompanySelection(ids);
              }}
              disabled={role === "gestor_unidade"}
            />
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

          <Button type="button" onClick={handleApply}>Aplicar</Button>
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
          return (
            <div key={row.id} className={`grid px-4 py-2 text-sm ${rowClass}`} style={{ gridTemplateColumns: gridTemplate }}>
              <div className="sticky left-0 z-[1] flex items-center gap-2 bg-inherit" style={{ paddingLeft: `${(row.level - 1) * 14}px` }}>
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
              const borderClass = isMainTotal
                ? "border-t-2 border-slate-500"
                : "border-t border-slate-200";
              return (
                <div
                  key={row.id}
                  className={`grid ${borderClass} px-4 py-2 text-sm ${rowClass}`}
                  style={{ gridTemplateColumns: `minmax(320px, 2.6fr) repeat(${totalCols}, minmax(110px, 1fr))` }}
                >
                  <div className="sticky left-0 z-[1] flex items-center gap-2 bg-inherit" style={{ paddingLeft: `${(row.level - 1) * 14}px` }}>
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
                  <span>Fluxo de Caixa</span>
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
                    <div className="sticky left-0 z-[1] flex items-center gap-2 bg-inherit">
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
