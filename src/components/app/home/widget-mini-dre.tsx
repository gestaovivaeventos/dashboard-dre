"use client";

import { Building2 } from "lucide-react";

import { WidgetCard } from "@/components/app/home/widget-card";
import { fmtFin, type HomeMiniDre } from "@/lib/home/financeiro-widgets";

export function WidgetMiniDre({ data }: { data: HomeMiniDre }) {
  const positivo = data.resultado >= 0;
  return (
    <WidgetCard title={`Sua unidade — ${data.mesLabel}`} icon={Building2} href="/dashboard">
      <div className="grid grid-cols-2 gap-3 text-center">
        <div>
          <p className="text-xs text-muted-foreground">Receita líquida</p>
          <p className="mt-0.5 text-lg font-bold">{fmtFin.format(data.receita)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Resultado do mês</p>
          <p
            className={`mt-0.5 text-lg font-bold ${
              positivo ? "text-green-600" : "text-red-600"
            }`}
          >
            {fmtFin.format(data.resultado)}
          </p>
        </div>
      </div>
    </WidgetCard>
  );
}
