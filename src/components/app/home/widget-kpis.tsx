"use client";

import { TrendingUp, TrendingDown } from "lucide-react";

import { WidgetCard } from "@/components/app/home/widget-card";
import { fmtFin, type HomeKpis } from "@/lib/home/financeiro-widgets";

export function WidgetKpis({ data }: { data: HomeKpis }) {
  const resultadoPositivo = data.resultado >= 0;
  return (
    <WidgetCard title={`Resultado — ${data.mesLabel}`} icon={TrendingUp} href="/dashboard">
      <div className="grid grid-cols-3 gap-3 text-center">
        <div>
          <p className="text-xs text-muted-foreground">Receita líquida</p>
          <p className="mt-0.5 text-lg font-bold">{fmtFin.format(data.receita)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Despesas</p>
          <p className="mt-0.5 text-lg font-bold">{fmtFin.format(data.despesa)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Resultado</p>
          <p
            className={`mt-0.5 text-lg font-bold ${
              resultadoPositivo ? "text-green-600" : "text-red-600"
            }`}
          >
            {fmtFin.format(data.resultado)}
          </p>
        </div>
      </div>
      {data.resultadoVariacaoPct !== null && (
        <div className="mt-3 flex items-center justify-center gap-1 text-xs">
          {data.resultadoVariacaoPct >= 0 ? (
            <TrendingUp className="h-3.5 w-3.5 text-green-600" />
          ) : (
            <TrendingDown className="h-3.5 w-3.5 text-red-600" />
          )}
          <span
            className={data.resultadoVariacaoPct >= 0 ? "text-green-600" : "text-red-600"}
          >
            {data.resultadoVariacaoPct >= 0 ? "+" : ""}
            {data.resultadoVariacaoPct.toFixed(1)}% vs mês anterior
          </span>
        </div>
      )}
    </WidgetCard>
  );
}
