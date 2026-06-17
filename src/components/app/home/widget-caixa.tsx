"use client";

import { Banknote } from "lucide-react";

import { WidgetCard } from "@/components/app/home/widget-card";
import { fmtFin, type HomeCaixa } from "@/lib/home/financeiro-widgets";

export function WidgetCaixa({ data }: { data: HomeCaixa }) {
  const positivo = data.caixaGeradoMes >= 0;
  return (
    <WidgetCard title={`Caixa — ${data.mesLabel}`} icon={Banknote} href="/fluxo-de-caixa">
      <div className="text-center">
        <p className="text-xs text-muted-foreground">Caixa gerado no mês (entradas − saídas)</p>
        <p
          className={`mt-1 text-2xl font-bold ${
            positivo ? "text-green-600" : "text-red-600"
          }`}
        >
          {fmtFin.format(data.caixaGeradoMes)}
        </p>
      </div>
    </WidgetCard>
  );
}
