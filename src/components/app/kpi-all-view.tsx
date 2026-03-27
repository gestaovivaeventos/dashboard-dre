"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { DashboardFilterState } from "@/lib/dashboard/dre";
import type { KpiFormulaType } from "@/lib/kpi/calc";
import type { UserRole } from "@/lib/supabase/types";

interface KpiCard {
  id: string;
  name: string;
  description: string | null;
  formula_type: KpiFormulaType;
  value: number;
}

interface KpiAllViewProps {
  filter: DashboardFilterState;
  kpiCards: KpiCard[];
  role: UserRole;
}

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

export function KpiAllView({ filter, kpiCards }: KpiAllViewProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [periodType, setPeriodType] = useState(filter.periodType);
  const [year, setYear] = useState(String(filter.year));
  const [month, setMonth] = useState(String(filter.month));
  const [quarter, setQuarter] = useState(String(filter.quarter));
  const [semester, setSemester] = useState(String(filter.semester));
  const [startDate, setStartDate] = useState(filter.startDate);
  const [endDate, setEndDate] = useState(filter.endDate);

  const handleApply = () => {
    const params = new URLSearchParams();
    params.set("periodType", periodType);
    params.set("year", year);
    if (periodType === "mensal") params.set("month", month);
    if (periodType === "trimestral") params.set("quarter", quarter);
    if (periodType === "semestral") params.set("semester", semester);
    if (periodType === "acumulado") {
      params.set("startDate", startDate);
      params.set("endDate", endDate);
    }
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-background p-4">
        <h2 className="text-2xl font-semibold">KPIs</h2>
        <p className="text-sm text-muted-foreground">
          Indicadores consolidados do periodo.
        </p>
      </div>

      {/* Period filter */}
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

        <Button type="button" onClick={handleApply}>Aplicar Filtros</Button>
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
