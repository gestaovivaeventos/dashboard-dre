"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Check, ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { DashboardFilterState, DashboardRange, PeriodMode } from "@/lib/dashboard/dre";
import type { KpiFormulaType } from "@/lib/kpi/calc";
import type { UserRole } from "@/lib/supabase/types";

interface CompanyOption {
  id: string;
  name: string;
}

interface KpiCard {
  id: string;
  name: string;
  description: string | null;
  formula_type: KpiFormulaType;
  value: number;
}

interface KpiAllViewProps {
  filter: DashboardFilterState;
  range: DashboardRange;
  kpiCards: KpiCard[];
  companies: CompanyOption[];
  role: UserRole;
  selectedCompanyIds: string[];
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

function formatKpiValue(value: number, formulaType: KpiFormulaType) {
  if (formulaType === "value") {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(value);
  }
  return (
    new Intl.NumberFormat("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value) + (formulaType === "percentage" ? "%" : "")
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
              onChange={(e) => onChange(e.target.checked ? companies.map((c) => c.id) : [])}
            />
            Todas (Consolidado)
          </label>
          {companies.map((company) => (
            <label key={company.id} className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-accent">
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
              {selected.includes(company.id) && <Check className="ml-auto h-3.5 w-3.5 text-primary" />}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export function KpiAllView({ filter, range, kpiCards, companies, role }: KpiAllViewProps) {
  const router = useRouter();
  const pathname = usePathname();

  const [periodMode, setPeriodMode] = useState<PeriodMode>(filter.periodMode);
  const [monthFrom, setMonthFrom] = useState(filter.monthFrom);
  const [yearFrom, setYearFrom] = useState(filter.yearFrom);
  const [monthTo, setMonthTo] = useState(filter.monthTo);
  const [yearTo, setYearTo] = useState(filter.yearTo);
  const [companySelection, setCompanySelection] = useState(filter.selectedCompanyIds);

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
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-background p-4">
        <h2 className="text-2xl font-semibold">KPIs</h2>
        <p className="text-sm text-muted-foreground">
          Indicadores consolidados — {range.label}
        </p>
      </div>

      {/* Filters */}
      <div className="space-y-4 rounded-xl border bg-background p-4">
        <div className="flex flex-wrap items-end gap-4">
          {/* Company multi-select */}
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

          {/* Date range for "especifico" */}
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
                  <Input className="w-20" type="number" value={yearFrom} onChange={(e) => setYearFrom(Number(e.target.value))} />
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
                  <Input className="w-20" type="number" value={yearTo} onChange={(e) => setYearTo(Number(e.target.value))} />
                </div>
              </div>
            </>
          )}

          <Button type="button" onClick={handleApply}>Aplicar</Button>
        </div>
      </div>

      {/* KPI cards grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {kpiCards.map((kpi) => (
          <Card key={kpi.id}>
            <CardContent className="pt-5">
              <p className="text-sm font-medium text-muted-foreground">{kpi.name}</p>
              <p className="mt-1 text-3xl font-bold">
                {formatKpiValue(kpi.value, kpi.formula_type)}
              </p>
              {kpi.description ? (
                <p className="mt-2 text-xs text-muted-foreground">{kpi.description}</p>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
