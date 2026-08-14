"use client";

import Link from "next/link";

import { SectionHead, WidgetEmpty } from "@/components/app/home/widget-card";
import { formatDayBR } from "@/lib/ctrl/datetime";
import { fmtBRL, type HomeSuppliers } from "@/lib/home/ctrl-widgets";

/**
 * Fornecedores a homologar — perfil "Contas a Pagar" (dono da homologação) e
 * Admin, que vê a home completa (gate `caps.canHomologate`, ver deriveCtrlCaps).
 *
 * Junta as duas pontas da mesma pendência: o fornecedor recém-cadastrado que
 * ainda não foi homologado e a requisição em aberto que vai travar no envio
 * para pagamento por causa disso. Some sozinho conforme a homologação acontece.
 */
export function WidgetFornecedores({ data }: { data: HomeSuppliers }) {
  const nada = data.novosTotal === 0 && data.bloqueadasTotal === 0;

  return (
    <div>
      <SectionHead
        title="Fornecedores a homologar"
        href="/ctrl/admin/fornecedores"
        hrefLabel="Homologar"
      />

      {nada ? (
        <WidgetEmpty>Nenhum fornecedor aguardando homologação.</WidgetEmpty>
      ) : (
        <div className="space-y-5">
          {data.novosTotal > 0 && (
            <section>
              <p className="ch-kicker" style={{ marginBottom: 7 }}>
                Novos cadastros ({data.novosTotal})
              </p>
              {data.novos.map((s) => (
                <div key={s.id} className="ch-row ch-row--hover">
                  <span className="ch-row__title">{s.name}</span>
                  <span className="ch-row__meta">{formatDayBR(s.createdAt)}</span>
                </div>
              ))}
              {data.novosTotal > data.novos.length && (
                <p className="ch-empty" style={{ marginTop: 8 }}>
                  +{data.novosTotal - data.novos.length} cadastro(s) — veja em Fornecedores.
                </p>
              )}
            </section>
          )}

          {data.bloqueadasTotal > 0 && (
            <section>
              <p className="ch-kicker" style={{ marginBottom: 7 }}>
                Requisições que vão travar no pagamento ({data.bloqueadasTotal})
              </p>
              {data.bloqueadas.map((r) => (
                <div key={r.id} className="ch-row ch-row--hover">
                  <span style={{ minWidth: 0 }}>
                    <span className="ch-row__title" style={{ display: "block" }}>
                      {r.title}
                    </span>
                    <span className="ch-row__meta">
                      #{r.requestNumber} · {r.supplierName} · {fmtBRL.format(r.amount)}
                    </span>
                  </span>
                  <span className={`ch-tag ${r.supplierStatus === "rejeitado" ? "ch-tag--accent" : ""}`}>
                    {r.supplierStatus === "rejeitado" ? "Rejeitado" : "Não homologado"}
                  </span>
                </div>
              ))}
              {data.bloqueadasTotal > data.bloqueadas.length && (
                <p className="ch-empty" style={{ marginTop: 8 }}>
                  +{data.bloqueadasTotal - data.bloqueadas.length} requisição(ões) na mesma
                  situação.
                </p>
              )}
              <Link href="/ctrl/contas-a-pagar" className="ch-link" style={{ marginTop: 8, display: "inline-block" }}>
                Ver no Contas a Pagar →
              </Link>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
