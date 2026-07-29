"use client";

import { CalendarRange } from "lucide-react";

import { orcamentoYears } from "@/lib/orcamento/years";

const SELECT_CLS =
  "rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";

interface Props {
  value: number;
  onChange: (year: number) => void;
  disabled?: boolean;
  /** Mostra o rótulo "Ano do orçamento" acima do seletor. */
  withLabel?: boolean;
}

/**
 * Seletor do ano do orçamento, reutilizado por todas as telas de configuração.
 * A configuração é versionada por ano, então trocar o ano recarrega os dados
 * daquele ano.
 */
export function YearSelect({ value, onChange, disabled, withLabel = true }: Props) {
  const select = (
    <div className="relative">
      <CalendarRange className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        aria-label="Ano do orçamento"
        className={SELECT_CLS + " pl-8 font-medium tabular-nums"}
      >
        {orcamentoYears().map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
    </div>
  );

  if (!withLabel) return select;

  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">Ano do orçamento</label>
      {select}
    </div>
  );
}
