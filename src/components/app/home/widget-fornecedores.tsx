"use client";

import Link from "next/link";

import { SectionHead, WidgetEmpty } from "@/components/app/home/widget-card";
import { formatDayBR } from "@/lib/ctrl/datetime";
import { FORNECEDORES_NOVOS_HREF, fmtBRL, type HomeSuppliers } from "@/lib/home/ctrl-widgets";

/**
 * Fornecedores a homologar — perfil "Contas a Pagar" (dono da homologação) e
 * Admin, que vê a home completa (gate `caps.canHomologate`, ver deriveCtrlCaps).
 *
 * Junta as duas pontas da mesma pendência: o fornecedor recém-cadastrado que
 * ainda não foi homologado e a requisição em aberto que vai travar no envio
 * para pagamento por causa disso. Some sozinho conforme a homologação acontece.
 *
 * Cada nome é um link para a própria linha na listagem (recorte + `fornecedor=`
 * destacando a linha), e não só para a tela: o quadro nomeia os fornecedores,
 * então o clique deve continuar de onde a leitura parou.
 */
export function WidgetFornecedores({ data }: { data: HomeSuppliers }) {
  const nada = data.novosTotal === 0 && data.bloqueadasTotal === 0;

  return (
    <div>
      <SectionHead
        title="Fornecedores a homologar"
        href={FORNECEDORES_NOVOS_HREF}
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
                <Link
                  key={s.id}
                  href={`${FORNECEDORES_NOVOS_HREF}&fornecedor=${s.id}`}
                  className="ch-row"
                >
                  <span className="ch-row__title">{s.name}</span>
                  <span className="ch-row__meta">{formatDayBR(s.createdAt)}</span>
                </Link>
              ))}
              {data.novosTotal > data.novos.length && (
                <p className="ch-empty" style={{ marginTop: 8 }}>
                  +{data.novosTotal - data.novos.length} cadastro(s) —{" "}
                  <Link href={FORNECEDORES_NOVOS_HREF} className="ch-link">
                    ver os {data.novosTotal}
                  </Link>
                  .
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
