"use client";

import { SectionHead, WidgetEmpty } from "@/components/app/home/widget-card";
import { fmtBRL, type HomeBudget } from "@/lib/home/ctrl-widgets";

export function WidgetOrcamento({ data }: { data: HomeBudget }) {
  return (
    <>
      <SectionHead title="Orçamento do setor" href="/ctrl/orcamento" />

      {data.sectors.length === 0 ? (
        <WidgetEmpty>Sem orçamento cadastrado para seus setores.</WidgetEmpty>
      ) : (
        <div className="ch-2col">
          {data.sectors.map((s) => {
            const pct =
              s.orcadoAnual > 0
                ? Math.min(100, Math.round((s.consumido / s.orcadoAnual) * 100))
                : 0;
            const over = s.orcadoAnual > 0 && s.consumido > s.orcadoAnual;
            return (
              <div key={s.sectorId}>
                <div className="ch-row" style={{ padding: 0, margin: 0 }}>
                  <span className="ch-row__title">{s.sectorName}</span>
                  <span className="ch-row__meta">
                    {fmtBRL.format(s.consumido)} / {fmtBRL.format(s.orcadoAnual)}
                  </span>
                </div>
                <span className="ch-bar">
                  <span className="ch-bar__fill" style={{ width: `${over ? 100 : pct}%` }} />
                </span>
              </div>
            );
          })}
        </div>
      )}

      {data.hidden > 0 && (
        <p className="ch-empty" style={{ marginTop: 14 }}>
          +{data.hidden} setor(es) — veja todos em Orçamento.
        </p>
      )}
    </>
  );
}
