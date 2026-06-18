"use client";

import { Wallet } from "lucide-react";

import { WidgetCard } from "@/components/app/home/widget-card";
import type { HomePayments } from "@/lib/home/ctrl-widgets";

export function WidgetFilaPagamento({ data }: { data: HomePayments }) {
  return (
    <WidgetCard title="Fila de pagamento" icon={Wallet} href="/ctrl/contas-a-pagar">
      <div className="grid grid-cols-3 gap-3 text-center">
        <div>
          <p className="text-2xl font-bold">{data.toSend}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">A enviar</p>
        </div>
        <div>
          <p className="text-2xl font-bold text-amber-600">{data.dueThisWeek}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Vencendo (7 dias)</p>
        </div>
        <div>
          <p className={`text-2xl font-bold ${data.omieErrors > 0 ? "text-red-600" : ""}`}>
            {data.omieErrors}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">Falhas Omie</p>
        </div>
      </div>
    </WidgetCard>
  );
}
