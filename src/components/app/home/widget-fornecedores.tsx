"use client";

import Link from "next/link";
import { BadgeCheck } from "lucide-react";

import { WidgetCard, WidgetEmpty } from "@/components/app/home/widget-card";
import { formatDayBR } from "@/lib/ctrl/datetime";
import { fmtBRL, type HomeSuppliers } from "@/lib/home/ctrl-widgets";

/**
 * Fornecedores a homologar — exclusivo do perfil "Contas a Pagar"
 * (gate `caps.canHomologate`, ver deriveCtrlCaps).
 *
 * Junta as duas pontas da mesma pendência: o fornecedor recém-cadastrado que
 * ainda não foi homologado e a requisição em aberto que vai travar no envio
 * para pagamento por causa disso. Some sozinho conforme a homologação acontece.
 */
export function WidgetFornecedores({ data }: { data: HomeSuppliers }) {
  const nada = data.novosTotal === 0 && data.bloqueadasTotal === 0;

  return (
    <WidgetCard
      title="Fornecedores a homologar"
      icon={BadgeCheck}
      href="/ctrl/admin/fornecedores"
      hrefLabel="Homologar"
    >
      {nada ? (
        <WidgetEmpty>Nenhum fornecedor aguardando homologação.</WidgetEmpty>
      ) : (
        <div className="space-y-4">
          {data.novosTotal > 0 && (
            <section>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Novos cadastros ({data.novosTotal})
              </p>
              <ul className="divide-y">
                {data.novos.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3 py-2">
                    <p className="truncate text-sm font-medium">{s.name}</p>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatDayBR(s.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
              {data.novosTotal > data.novos.length && (
                <p className="mt-1 text-xs text-muted-foreground">
                  +{data.novosTotal - data.novos.length} cadastro(s) — veja em Fornecedores.
                </p>
              )}
            </section>
          )}

          {data.bloqueadasTotal > 0 && (
            <section>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Requisições que vão travar no pagamento ({data.bloqueadasTotal})
              </p>
              <ul className="divide-y">
                {data.bloqueadas.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{r.title}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        #{r.requestNumber} · {r.supplierName} · {fmtBRL.format(r.amount)}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                        r.supplierStatus === "rejeitado"
                          ? "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300"
                          : "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                      }`}
                    >
                      {r.supplierStatus === "rejeitado" ? "Rejeitado" : "Não homologado"}
                    </span>
                  </li>
                ))}
              </ul>
              {data.bloqueadasTotal > data.bloqueadas.length && (
                <p className="mt-1 text-xs text-muted-foreground">
                  +{data.bloqueadasTotal - data.bloqueadas.length} requisição(ões) na mesma
                  situação.
                </p>
              )}
              <Link
                href="/ctrl/contas-a-pagar"
                className="mt-2 inline-block text-xs font-medium text-primary hover:underline"
              >
                Ver no Contas a Pagar
              </Link>
            </section>
          )}
        </div>
      )}
    </WidgetCard>
  );
}
