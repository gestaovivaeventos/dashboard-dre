"use client";

import { SectionHead } from "@/components/app/home/widget-card";
import type { HomePayments } from "@/lib/home/ctrl-widgets";

/**
 * Três métricas em colunas separadas por linha vertical. Vermelho só nos
 * números críticos — vencimento em 7 dias e falhas no envio ao Omie (esta
 * só quando existe alguma).
 */
export function WidgetFilaPagamento({ data }: { data: HomePayments }) {
  return (
    <>
      <SectionHead title="Fila de pagamento" href="/ctrl/contas-a-pagar" />
      <div className="ch-cols">
        <div>
          <p className="ch-metric">{data.toSend}</p>
          <p className="ch-kicker ch-kicker--accent" style={{ marginTop: 8 }}>
            A enviar
          </p>
        </div>
        <div>
          <p className="ch-metric ch-metric--accent">{data.dueThisWeek}</p>
          <p className="ch-kicker ch-kicker--accent" style={{ marginTop: 8 }}>
            Vencendo em 7 dias
          </p>
        </div>
        <div>
          <p className={`ch-metric ${data.omieErrors > 0 ? "ch-metric--accent" : ""}`}>
            {data.omieErrors}
          </p>
          <p className="ch-kicker ch-kicker--accent" style={{ marginTop: 8 }}>
            Falhas no envio ao Omie
          </p>
        </div>
      </div>
    </>
  );
}
