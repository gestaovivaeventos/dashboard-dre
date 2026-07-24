"use client";

import { ChevronRight } from "lucide-react";
import { Fragment, useState } from "react";

export interface OrcamentoSectorRow {
  sector_id: string | null;
  sector_name: string;
  orcado: number;
  realizado: number;
  pendente: number;
}

export interface OrcamentoRow {
  expense_type_id: string | null;
  name: string;
  orcado: number;
  realizado: number;
  pendente: number;
  // Detalhamento por setor (orçado + consumo). Aberto ao clicar na linha.
  sectors: OrcamentoSectorRow[];
}

const fmt = new Intl.NumberFormat("pt-BR", {
  style: "decimal",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function pct(value: number, total: number) {
  if (total <= 0) return 0;
  return Math.min(100, (value / total) * 100);
}

// Colunas numéricas + barra de execução — compartilhadas entre a linha-pai
// (tipo de despesa) e as sub-linhas (setor).
function ValueCells({
  orcado,
  realizado,
  pendente,
}: {
  orcado: number;
  realizado: number;
  pendente: number;
}) {
  const usado = realizado + pendente;
  const disponivel = orcado - usado;
  const execPct = pct(realizado, orcado);
  const pendPct = pct(pendente, orcado);
  const overBudget = orcado > 0 && usado > orcado;
  return (
    <>
      <td className="px-4 py-3 text-right tabular-nums">{fmt.format(orcado)}</td>
      <td className="px-4 py-3 text-right tabular-nums text-green-600">{fmt.format(realizado)}</td>
      <td className="px-4 py-3 text-right tabular-nums text-amber-600">{fmt.format(pendente)}</td>
      <td
        className={`px-4 py-3 text-right tabular-nums font-medium ${disponivel < 0 ? "text-red-600" : "text-sky-600"}`}
      >
        {orcado > 0 ? fmt.format(disponivel) : "—"}
      </td>
      <td className="px-4 py-3">
        {orcado > 0 ? (
          <div className="space-y-1">
            <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
              <div className="h-full flex">
                <div className="bg-green-500 transition-all" style={{ width: `${execPct}%` }} />
                <div
                  className={`transition-all ${overBudget ? "bg-red-400" : "bg-amber-400"}`}
                  style={{ width: `${Math.min(pendPct, 100 - execPct)}%` }}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{(execPct + pendPct).toFixed(0)}% utilizado</p>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">sem orçamento</span>
        )}
      </td>
    </>
  );
}

export function OrcamentoTable({ rows }: { rows: OrcamentoRow[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="rounded-lg border overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/40">
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Tipo de despesa</th>
            <th className="px-4 py-3 text-right font-medium text-muted-foreground">Orçado</th>
            <th className="px-4 py-3 text-right font-medium text-muted-foreground">Realizado</th>
            <th className="px-4 py-3 text-right font-medium text-muted-foreground">Pendente</th>
            <th className="px-4 py-3 text-right font-medium text-muted-foreground">Disponível</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground w-32">Execução</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row) => {
            const key = row.expense_type_id ?? "__none__";
            const isOpen = expanded.has(key);
            const hasSectors = row.sectors.length > 0;
            return (
              <Fragment key={key}>
                <tr
                  className={`transition-colors ${hasSectors ? "cursor-pointer hover:bg-muted/30" : "hover:bg-muted/20"}`}
                  onClick={hasSectors ? () => toggle(key) : undefined}
                  aria-expanded={hasSectors ? isOpen : undefined}
                >
                  <td className="px-4 py-3 font-medium">
                    <span className="inline-flex items-center gap-1.5">
                      {hasSectors ? (
                        <ChevronRight
                          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`}
                        />
                      ) : (
                        <span className="inline-block w-4 shrink-0" />
                      )}
                      {row.name}
                    </span>
                  </td>
                  <ValueCells orcado={row.orcado} realizado={row.realizado} pendente={row.pendente} />
                </tr>

                {isOpen &&
                  row.sectors.map((s) => (
                    <tr key={`${key}|${s.sector_id ?? "none"}`} className="bg-muted/20 text-[13px]">
                      <td className="py-2.5 pr-4 pl-12 text-muted-foreground">
                        <span className="inline-flex items-center gap-2">
                          <span aria-hidden className="h-1 w-1 rounded-full bg-muted-foreground/50" />
                          {s.sector_name}
                        </span>
                      </td>
                      <ValueCells orcado={s.orcado} realizado={s.realizado} pendente={s.pendente} />
                    </tr>
                  ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
