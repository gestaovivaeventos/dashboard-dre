"use client";

import { PiggyBank } from "lucide-react";

import { WidgetCard, WidgetEmpty } from "@/components/app/home/widget-card";
import { fmtBRL, type HomeBudgetSector } from "@/lib/home/ctrl-widgets";

export function WidgetOrcamento({ data }: { data: HomeBudgetSector[] }) {
  return (
    <WidgetCard title="Orçamento do setor" icon={PiggyBank} href="/ctrl/orcamento">
      {data.length === 0 ? (
        <WidgetEmpty>Sem orçamento cadastrado para seus setores.</WidgetEmpty>
      ) : (
        <ul className="space-y-3">
          {data.map((s) => {
            const pct =
              s.orcadoAnual > 0
                ? Math.min(100, Math.round((s.consumido / s.orcadoAnual) * 100))
                : 0;
            const over = s.orcadoAnual > 0 && s.consumido > s.orcadoAnual;
            return (
              <li key={s.sectorId} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{s.sectorName}</span>
                  <span className="text-xs text-muted-foreground">
                    {fmtBRL.format(s.consumido)} / {fmtBRL.format(s.orcadoAnual)}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full ${over ? "bg-red-500" : "bg-violet-500"}`}
                    style={{ width: `${over ? 100 : pct}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </WidgetCard>
  );
}
