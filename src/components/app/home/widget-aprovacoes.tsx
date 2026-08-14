"use client";

import { SectionHead } from "@/components/app/home/widget-card";
import { fmtBRL, type HomeApprovals } from "@/lib/home/ctrl-widgets";

/**
 * Aprovações pendentes — quadro de LEITURA.
 *
 * Nada é decidido aqui: aprovar/recusar em um clique na tela inicial abre
 * espaço para o clique sem querer, e recusa ainda exige motivo. A decisão
 * acontece em /ctrl/aprovacoes, para onde o "Ver tudo" leva.
 */
export function WidgetAprovacoes({ data }: { data: HomeApprovals }) {
  return (
    <>
      <SectionHead title="Aprovações pendentes" href="/ctrl/aprovacoes" />

      {data.items.length === 0 ? (
        <p className="ch-empty">Fila limpa — nenhuma aprovação pendente.</p>
      ) : (
        <>
          <div className="ch-approvals__head">
            <span className="ch-kicker">Nº</span>
            <span className="ch-kicker">Requisição</span>
            <span className="ch-kicker" style={{ textAlign: "right" }}>
              Valor
            </span>
          </div>
          {data.items.map((r) => (
            <div key={r.id} className="ch-approval">
              <span className="ch-approval__num">{r.requestNumber}</span>
              <span style={{ minWidth: 0 }}>
                <span className="ch-approval__title" style={{ display: "block" }}>
                  {r.title}
                </span>
                <span className="ch-approval__meta" style={{ display: "block" }}>
                  {r.supplierName ?? "Sem fornecedor"}
                </span>
              </span>
              <span className="ch-approval__value">{fmtBRL.format(r.amount)}</span>
            </div>
          ))}
          {data.total > data.items.length && (
            <p className="ch-empty" style={{ marginTop: 12 }}>
              +{data.total - data.items.length} aguardando — veja todas em Aprovações.
            </p>
          )}
        </>
      )}
    </>
  );
}
