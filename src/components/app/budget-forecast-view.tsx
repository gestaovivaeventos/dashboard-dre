"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Inbox,
  Loader2,
  Search,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  DashboardFilterState,
  DashboardRange,
  DashboardPeriodBucket,
  PeriodMode,
} from "@/lib/dashboard/dre";
import type { UserRole } from "@/lib/supabase/types";

type ViewTab = "orcamento" | "realizado" | "projecao";
type RealizadoSubView = "consolidado" | "mensal";

interface CompanyOption {
  id: string;
  name: string;
}

interface BudgetForecastDisplayRow {
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
  budgetValue?: number;
  realizedValue?: number;
  budgetByBucket?: Record<string, number>;
  accumulatedBudget?: number;
}

interface BudgetForecastViewProps {
  view: ViewTab;
  subView: RealizadoSubView;
  filter: DashboardFilterState;
  range: DashboardRange;
  rows: BudgetForecastDisplayRow[];
  companies: CompanyOption[];
  role: UserRole;
  visibleBuckets: DashboardPeriodBucket[];
  accumulatedBucket: DashboardPeriodBucket;
  selectedCompanyIds: string[];
  currentMonthIndex: number;
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
  previsto?: number;
  realizado?: number;
  valor?: number;
  tipo?: "Realizado" | "Orcamento";
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

const TAB_OPTIONS: Array<{ value: ViewTab; label: string }> = [
  { value: "orcamento", label: "Orcamento Anual" },
  { value: "realizado", label: "Previsto x Realizado" },
  { value: "projecao", label: "Projecao" },
];

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

export function BudgetForecastView({
  view,
  subView,
  filter,
  range,
  rows,
  companies,
  role,
  visibleBuckets,
  accumulatedBucket,
  selectedCompanyIds,
  currentMonthIndex,
}: BudgetForecastViewProps) {
  const router = useRouter();
  const pathname = usePathname();

  const [periodMode, setPeriodMode] = useState<PeriodMode>(filter.periodMode);
  const [monthFrom, setMonthFrom] = useState(filter.monthFrom);
  const [yearFrom, setYearFrom] = useState(filter.yearFrom);
  const [monthTo, setMonthTo] = useState(filter.monthTo);
  const [yearTo, setYearTo] = useState(filter.yearTo);
  const [companySelection, setCompanySelection] = useState(filter.selectedCompanyIds);

  const [expanded, setExpanded] = useState<Record<string, boolean>>(
    () =>
      rows.filter((row) => row.hasChildren).reduce((acc, row) => ({ ...acc, [row.id]: true }), {}),
  );

  const [selectedAccountId, setSelectedAccountId] = useState(rows[0]?.id ?? "");
  const [evolutionData, setEvolutionData] = useState<EvolutionPoint[]>([]);
  const [evolutionLoading, setEvolutionLoading] = useState(false);

  const [drilldown, setDrilldown] = useState<DrilldownState>({
    open: false,
    accountId: "",
    accountName: "",
    bucket: accumulatedBucket,
  });
  const [drillRows, setDrillRows] = useState<DrilldownRow[]>([]);
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillSearch, setDrillSearch] = useState("");
  const [drillPage, setDrillPage] = useState(1);
  const [drillPageSize, setDrillPageSize] = useState(20);
  const [drillTotal, setDrillTotal] = useState(0);
  const [drillTotalValue, setDrillTotalValue] = useState(0);

  const byParent = useMemo(() => {
    const map = new Map<string | null, BudgetForecastDisplayRow[]>();
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
    const result: BudgetForecastDisplayRow[] = [];
    const walk = (parentId: string | null) => {
      (byParent.get(parentId) ?? []).forEach((child) => {
        result.push(child);
        if (expanded[child.id]) walk(child.id);
      });
    };
    walk(null);
    return result;
  }, [byParent, expanded]);

  const selectedAccount = rows.find((r) => r.id === selectedAccountId) ?? rows[0];

  const loadEvolution = async (accountId: string) => {
    if (!accountId || !range.dateTo) return;
    setEvolutionLoading(true);
    const params = new URLSearchParams({
      accountId,
      companyIds: selectedCompanyIds.join(","),
      startDate: range.dateFrom,
      endDate: range.dateTo,
      mode: view === "projecao" ? "projecao" : "compare",
    });
    const response = await fetch(`/api/budget-forecast/evolution?${params.toString()}`, { cache: "no-store" });
    const payload = (await response.json()) as { points?: EvolutionPoint[] };
    setEvolutionData(payload.points ?? []);
    setEvolutionLoading(false);
  };

  useEffect(() => {
    if (selectedAccount?.id) {
      void loadEvolution(selectedAccount.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccount?.id, range.dateFrom, range.dateTo, selectedCompanyIds.join(","), view]);

  const openDrilldown = async (
    account: BudgetForecastDisplayRow,
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

  const buildQuery = (overrides: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const v = overrides.view ?? view;
    if (v && v !== "orcamento") params.set("view", v);
    if (overrides.subView !== undefined) {
      if (overrides.subView && overrides.subView !== "consolidado") {
        params.set("subView", overrides.subView);
      }
    } else if (subView !== "consolidado") {
      params.set("subView", subView);
    }
    const pm = overrides.periodMode ?? periodMode;
    params.set("periodMode", pm);
    if (pm === "especifico") {
      params.set("monthFrom", String(overrides.monthFrom ?? monthFrom));
      params.set("yearFrom", String(overrides.yearFrom ?? yearFrom));
      params.set("monthTo", String(overrides.monthTo ?? monthTo));
      params.set("yearTo", String(overrides.yearTo ?? yearTo));
    }
    const allSelected = companySelection.length === companies.length;
    if (!allSelected) params.set("companyIds", companySelection.join(","));
    return params.toString();
  };

  const handleApply = () => {
    router.push(`${pathname}?${buildQuery({})}`);
  };

  const switchTab = (next: ViewTab) => {
    // Reset subView when switching away from realizado
    const overrides: Record<string, string | undefined> = { view: next };
    if (next !== "realizado") overrides.subView = "consolidado";
    router.push(`${pathname}?${buildQuery(overrides)}`);
  };

  const switchSubView = (next: RealizadoSubView) => {
    router.push(`${pathname}?${buildQuery({ subView: next })}`);
  };

  const columns = visibleBuckets;
  const totalCols = columns.length + 1;

  const titleByView: Record<ViewTab, string> = {
    orcamento: "Orcamento Anual",
    realizado: "Previsto x Realizado",
    projecao: "Projecao (Realizado + Orcamento)",
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-xl border bg-background p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold">Budget e Forecast</h2>
            <p className="text-sm text-muted-foreground">
              {titleByView[view]} | {range.label}
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="mt-4 flex flex-wrap gap-2">
          {TAB_OPTIONS.map((tab) => (
            <Button
              key={tab.value}
              type="button"
              size="sm"
              variant={view === tab.value ? "default" : "outline"}
              onClick={() => switchTab(tab.value)}
            >
              {tab.label}
            </Button>
          ))}
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

          {/* Sub-view toggle (only on Previsto x Realizado) */}
          {view === "realizado" && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Detalhe</label>
              <div className="flex gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant={subView === "consolidado" ? "default" : "outline"}
                  onClick={() => switchSubView("consolidado")}
                >
                  Consolidado
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={subView === "mensal" ? "default" : "outline"}
                  onClick={() => switchSubView("mensal")}
                >
                  Mensal
                </Button>
              </div>
            </div>
          )}

          <Button type="button" onClick={handleApply}>Aplicar</Button>
        </div>
      </div>

      {/* Tables per view */}
      {view === "realizado" && subView === "consolidado" ? (
        <RealizadoTable
          rows={visibleRows}
          expanded={expanded}
          setExpanded={setExpanded}
          accumulatedBucket={accumulatedBucket}
          onSelectAccount={setSelectedAccountId}
          onDrilldownRealized={(row) => void openDrilldown(row, accumulatedBucket, 1, "")}
        />
      ) : view === "realizado" && subView === "mensal" ? (
        <RealizadoMensalTable
          rows={visibleRows}
          expanded={expanded}
          setExpanded={setExpanded}
          columns={columns}
          totalCols={totalCols}
          onSelectAccount={setSelectedAccountId}
          onDrilldownRealized={(row, bucket) => void openDrilldown(row, bucket, 1, "")}
        />
      ) : (
        <MonthlyTable
          rows={visibleRows}
          expanded={expanded}
          setExpanded={setExpanded}
          columns={columns}
          accumulatedBucket={accumulatedBucket}
          totalCols={totalCols}
          highlightSplitIndex={view === "projecao" ? currentMonthIndex : -1}
          onSelectAccount={setSelectedAccountId}
          onDrilldownRealized={(row, bucket) => void openDrilldown(row, bucket, 1, "")}
          enableDrilldown={view === "projecao"}
          isProjecao={view === "projecao"}
        />
      )}

      {/* Evolution chart */}
      <div className="rounded-xl border bg-background p-4">
        <h3 className="text-lg font-semibold">
          {view === "projecao" ? "Evolucao da Conta (Realizado + Orcamento)" : "Evolucao Previsto vs Realizado"}
        </h3>
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
              <LineChart data={evolutionData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" />
                <YAxis tickFormatter={(value) => formatCurrency(Number(value))} />
                <Tooltip
                  formatter={(value, _name, item) => {
                    const tipo = (item as { payload?: EvolutionPoint } | undefined)?.payload?.tipo;
                    return [formatCurrency(Number(value)), tipo ?? String(_name)];
                  }}
                />
                <Legend />
                {view === "projecao" ? (
                  <Line
                    type="monotone"
                    dataKey="valor"
                    stroke="#0f766e"
                    strokeWidth={2}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    dot={((props: any) => {
                      const { cx, cy, payload, index } = props ?? {};
                      const isBudget = (payload as EvolutionPoint | undefined)?.tipo === "Orcamento";
                      return (
                        <circle
                          key={`dot-${index ?? 0}`}
                          cx={cx}
                          cy={cy}
                          r={4}
                          fill={isBudget ? "#d97706" : "#0f766e"}
                          stroke={isBudget ? "#d97706" : "#0f766e"}
                        />
                      );
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    }) as any}
                    name="Realizado + Orcamento"
                  />
                ) : (
                  <>
                    <Line type="monotone" dataKey="previsto" stroke="#d97706" strokeWidth={2} dot={false} name="Previsto" />
                    <Line type="monotone" dataKey="realizado" stroke="#0f766e" strokeWidth={2} dot={false} name="Realizado" />
                  </>
                )}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
        {view === "projecao" ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Pontos em verde representam meses realizados; pontos em laranja representam meses do orcamento.
          </p>
        ) : null}
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
                Budget e Forecast &gt; {drilldown.accountName} &gt; {drilldown.bucket.label}
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

function MonthlyTable({
  rows,
  expanded,
  setExpanded,
  columns,
  accumulatedBucket,
  totalCols,
  highlightSplitIndex,
  onSelectAccount,
  onDrilldownRealized,
  enableDrilldown,
  isProjecao,
}: {
  rows: BudgetForecastDisplayRow[];
  expanded: Record<string, boolean>;
  setExpanded: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  columns: DashboardPeriodBucket[];
  accumulatedBucket: DashboardPeriodBucket;
  totalCols: number;
  highlightSplitIndex: number;
  onSelectAccount: (id: string) => void;
  onDrilldownRealized: (row: BudgetForecastDisplayRow, bucket: DashboardPeriodBucket) => void;
  enableDrilldown: boolean;
  isProjecao: boolean;
}) {
  const gridTemplate = `minmax(320px, 2.6fr) repeat(${totalCols}, minmax(110px, 1fr))`;

  return (
    <div className="overflow-x-auto rounded-xl border bg-muted/50">
      <div style={{ minWidth: `${320 + totalCols * 120}px` }}>
        <div
          className="grid border-b bg-muted px-4 py-3 text-xs font-semibold uppercase text-muted-foreground"
          style={{ gridTemplateColumns: gridTemplate }}
        >
          <span className="sticky left-0 z-10 bg-muted">Plano de Contas</span>
          {columns.map((column, idx) => {
            const isBudgetCol = highlightSplitIndex >= 0 && idx >= highlightSplitIndex;
            return (
              <span
                key={column.key}
                className={`text-right ${isBudgetCol ? "text-amber-700" : ""}`}
                title={isBudgetCol ? "Orcamento" : highlightSplitIndex >= 0 ? "Realizado" : undefined}
              >
                {column.label}
                {isBudgetCol ? " (Orc)" : highlightSplitIndex >= 0 ? " (Real)" : ""}
              </span>
            );
          })}
          <span className="text-right font-bold">{accumulatedBucket.label}</span>
        </div>

        {rows.length === 0 ? (
          <div className="flex min-h-44 flex-col items-center justify-center gap-2 text-muted-foreground">
            <Inbox className="h-6 w-6" />
            <p className="text-sm">Nenhum dado encontrado para os filtros selecionados.</p>
          </div>
        ) : null}

        {rows.map((row) => {
          const isKeyResult = ["4", "6", "8", "11"].includes(row.code);
          const rowClass = isKeyResult ? "bg-background font-bold uppercase" : row.is_summary ? "bg-muted font-semibold" : "bg-muted/50";
          const borderClass = isKeyResult ? "border-t-2 border-slate-500" : "border-t border-slate-200";

          return (
            <div
              key={row.id}
              className={`grid px-4 py-2 text-sm ${rowClass} ${borderClass}`}
              style={{ gridTemplateColumns: gridTemplate }}
            >
              <div className="sticky left-0 z-[1] flex items-center gap-2 bg-inherit" style={{ paddingLeft: `${(row.level - 1) * 14}px` }}>
                {row.hasChildren ? (
                  <button type="button" onClick={() => setExpanded((prev) => ({ ...prev, [row.id]: !prev[row.id] }))} className="rounded p-0.5 text-muted-foreground hover:bg-muted">
                    {expanded[row.id] ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>
                ) : (
                  <span className="w-4" />
                )}
                <button type="button" className="truncate text-left hover:underline" onClick={() => onSelectAccount(row.id)}>
                  {row.name}
                </button>
              </div>

              {columns.map((column, idx) => {
                const isBudgetCol = highlightSplitIndex >= 0 && idx >= highlightSplitIndex;
                const value = row.valuesByBucket[column.key] ?? 0;
                // Drilldown is allowed only for realized (not summary, not budget col)
                const canDrill = enableDrilldown && !row.is_summary && (!isProjecao || !isBudgetCol);
                return (
                  <div
                    key={`${row.id}-${column.key}`}
                    className={`text-right ${isBudgetCol ? "text-amber-800" : ""}`}
                  >
                    {canDrill ? (
                      <button
                        type="button"
                        className="w-full text-right hover:underline"
                        onClick={() => onDrilldownRealized(row, column)}
                      >
                        {formatCurrency(value)}
                      </button>
                    ) : (
                      formatCurrency(value)
                    )}
                  </div>
                );
              })}

              <div className="text-right font-semibold">
                {formatCurrency(row.accumulatedValue)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RealizadoTable({
  rows,
  expanded,
  setExpanded,
  accumulatedBucket,
  onSelectAccount,
  onDrilldownRealized,
}: {
  rows: BudgetForecastDisplayRow[];
  expanded: Record<string, boolean>;
  setExpanded: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  accumulatedBucket: DashboardPeriodBucket;
  onSelectAccount: (id: string) => void;
  onDrilldownRealized: (row: BudgetForecastDisplayRow) => void;
}) {
  void accumulatedBucket;
  const gridTemplate = "minmax(320px, 2.6fr) minmax(130px, 1fr) minmax(130px, 1fr) minmax(100px, 1fr)";

  return (
    <div className="overflow-x-auto rounded-xl border bg-muted/50">
      <div style={{ minWidth: "700px" }}>
        <div className="grid border-b bg-muted px-4 py-3 text-xs font-semibold uppercase text-muted-foreground" style={{ gridTemplateColumns: gridTemplate }}>
          <span className="sticky left-0 z-10 bg-muted">Plano de Contas</span>
          <span className="text-right">Previsto</span>
          <span className="text-right">Realizado</span>
          <span className="text-center">Var %</span>
        </div>

        {rows.length === 0 ? (
          <div className="flex min-h-44 flex-col items-center justify-center gap-2 text-muted-foreground">
            <Inbox className="h-6 w-6" />
            <p className="text-sm">Nenhum dado encontrado.</p>
          </div>
        ) : null}

        {rows.map((row) => {
          const isKeyResult = ["4", "6", "8", "11"].includes(row.code);
          const rowClass = isKeyResult ? "bg-background font-bold uppercase" : row.is_summary ? "bg-muted font-semibold" : "bg-muted/50";
          const borderClass = isKeyResult ? "border-t-2 border-border" : "border-t border-border";
          const budgetVal = row.budgetValue ?? 0;
          const actualVal = row.realizedValue ?? row.accumulatedValue ?? 0;
          const canDrill = !row.is_summary;

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
                <button type="button" className="truncate text-left hover:underline" onClick={() => onSelectAccount(row.id)}>
                  {row.name}
                </button>
              </div>
              <div className="text-right">{formatCurrency(budgetVal)}</div>
              <div className="text-right">
                {canDrill ? (
                  <button type="button" className="w-full text-right hover:underline" onClick={() => onDrilldownRealized(row)}>
                    {formatCurrency(actualVal)}
                  </button>
                ) : (
                  formatCurrency(actualVal)
                )}
              </div>
              <div className={`text-center ${varColor(budgetVal, actualVal)}`}>
                {formatVar(budgetVal, actualVal)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RealizadoMensalTable({
  rows,
  expanded,
  setExpanded,
  columns,
  totalCols,
  onSelectAccount,
  onDrilldownRealized,
}: {
  rows: BudgetForecastDisplayRow[];
  expanded: Record<string, boolean>;
  setExpanded: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  columns: DashboardPeriodBucket[];
  totalCols: number;
  onSelectAccount: (id: string) => void;
  onDrilldownRealized: (row: BudgetForecastDisplayRow, bucket: DashboardPeriodBucket) => void;
}) {
  void totalCols;
  // Per month: Prev | Real | Var%, plus a final triplet for Total.
  const monthGroups = columns.length;
  // Each month = 3 columns of ~85px; total = 3 columns of ~95px
  const gridTemplate = `minmax(280px, 2.4fr) ${"minmax(85px, 1fr) ".repeat(monthGroups * 3)}minmax(95px, 1fr) minmax(95px, 1fr) minmax(80px, 1fr)`;
  const minWidth = 280 + monthGroups * 3 * 90 + 3 * 100;

  return (
    <div className="overflow-x-auto rounded-xl border bg-muted/50">
      <div style={{ minWidth: `${minWidth}px` }}>
        {/* Two-row header: month label spans 3 cols, then Prev/Real/Var */}
        <div
          className="grid border-b bg-muted px-4 pt-3 text-xs font-semibold uppercase text-muted-foreground"
          style={{ gridTemplateColumns: gridTemplate }}
        >
          <span className="sticky left-0 z-10 row-span-2 bg-muted">Plano de Contas</span>
          {columns.map((column) => (
            <span key={`mh-${column.key}`} className="col-span-3 text-center">
              {column.label}
            </span>
          ))}
          <span className="col-span-3 text-center font-bold">Total</span>
        </div>
        <div
          className="grid border-b bg-muted px-4 pb-2 text-[10px] font-semibold uppercase text-muted-foreground/80"
          style={{ gridTemplateColumns: gridTemplate }}
        >
          <span className="sticky left-0 z-10 bg-muted" />
          {columns.map((column) => (
            <span key={`sub-${column.key}`} className="contents">
              <span className="text-right">Prev</span>
              <span className="text-right">Real</span>
              <span className="text-center">Var %</span>
            </span>
          ))}
          <span className="text-right">Prev</span>
          <span className="text-right">Real</span>
          <span className="text-center">Var %</span>
        </div>

        {rows.length === 0 ? (
          <div className="flex min-h-44 flex-col items-center justify-center gap-2 text-muted-foreground">
            <Inbox className="h-6 w-6" />
            <p className="text-sm">Nenhum dado encontrado.</p>
          </div>
        ) : null}

        {rows.map((row) => {
          const isKeyResult = ["4", "6", "8", "11"].includes(row.code);
          const rowClass = isKeyResult ? "bg-background font-bold uppercase" : row.is_summary ? "bg-muted font-semibold" : "bg-muted/50";
          const borderClass = isKeyResult ? "border-t-2 border-slate-500" : "border-t border-slate-200";
          const canDrill = !row.is_summary;
          const totalReal = row.accumulatedValue ?? 0;
          const totalBudget = row.accumulatedBudget ?? 0;

          return (
            <div
              key={row.id}
              className={`grid px-4 py-2 text-sm ${rowClass} ${borderClass}`}
              style={{ gridTemplateColumns: gridTemplate }}
            >
              <div className="sticky left-0 z-[1] flex items-center gap-2 bg-inherit" style={{ paddingLeft: `${(row.level - 1) * 14}px` }}>
                {row.hasChildren ? (
                  <button type="button" onClick={() => setExpanded((prev) => ({ ...prev, [row.id]: !prev[row.id] }))} className="rounded p-0.5 text-muted-foreground hover:bg-muted">
                    {expanded[row.id] ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>
                ) : (
                  <span className="w-4" />
                )}
                <button type="button" className="truncate text-left hover:underline" onClick={() => onSelectAccount(row.id)}>
                  {row.name}
                </button>
              </div>

              {columns.map((column) => {
                const real = row.valuesByBucket[column.key] ?? 0;
                const bud = row.budgetByBucket?.[column.key] ?? 0;
                return (
                  <span key={`${row.id}-${column.key}-grp`} className="contents">
                    <span className="text-right">{formatCurrency(bud)}</span>
                    <span className="text-right">
                      {canDrill ? (
                        <button type="button" className="w-full text-right hover:underline" onClick={() => onDrilldownRealized(row, column)}>
                          {formatCurrency(real)}
                        </button>
                      ) : (
                        formatCurrency(real)
                      )}
                    </span>
                    <span className={`text-center ${varColor(bud, real)}`}>{formatVar(bud, real)}</span>
                  </span>
                );
              })}

              <span className="text-right font-semibold">{formatCurrency(totalBudget)}</span>
              <span className="text-right font-semibold">{formatCurrency(totalReal)}</span>
              <span className={`text-center font-semibold ${varColor(totalBudget, totalReal)}`}>{formatVar(totalBudget, totalReal)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
