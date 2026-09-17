import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, AlertTriangle } from "lucide-react";

import { getCaseUser } from "@/lib/case/auth";
import { getClients, getBands, isOmieConfigured } from "@/lib/case/queries";
import { NovoContratoForm } from "@/components/case/novo-contrato-form";
import { BvArtisticoForm } from "@/components/case/bv-artistico-form";
import { isCaseContractApprover } from "@/lib/case/contract-config";

export const dynamic = "force-dynamic";

export default async function NovoContratoPage({ searchParams }: { searchParams: { tipo?: string } }) {
  const isBv = searchParams?.tipo === "bv";
  const ctx = await getCaseUser();
  if (!ctx) redirect("/login");

  const [clients, bands, omieOk] = await Promise.all([
    getClients(),
    getBands(),
    isOmieConfigured(),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link
          href="/case/contratos"
          className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          Contratos
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-ink-primary">{isBv ? "Novo BV artístico" : "Novo contrato"}</h1>
        <p className="text-sm text-ink-muted">
          {isBv
            ? "Comissão que a Case recebe do artista indicado — gera só a conta a receber no Omie, sem contrato de venda."
            : "Lançe o contrato do show vendido — gera contas a pagar (artista) e a receber (cliente) no Omie."}
        </p>
        <div className="mt-3 flex gap-1 rounded-md border border-border p-1 text-sm">
          <Link
            href="/case/contratos/novo"
            className={`rounded px-3 py-1.5 ${!isBv ? "bg-amber-600 font-medium text-white" : "text-ink-secondary hover:bg-surface-2"}`}
          >
            Contrato de show
          </Link>
          <Link
            href="/case/contratos/novo?tipo=bv"
            className={`rounded px-3 py-1.5 ${isBv ? "bg-amber-600 font-medium text-white" : "text-ink-secondary hover:bg-surface-2"}`}
          >
            BV artístico
          </Link>
        </div>
      </div>

      {!omieOk && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Configuração Omie incompleta — o contrato será salvo, mas os títulos ficarão pendentes
            até você mapear categorias e conta corrente em{" "}
            <Link href="/case/config" className="font-medium underline">
              Configuração Omie
            </Link>
            .
          </span>
        </div>
      )}

      {isBv ? (
        <BvArtisticoForm bands={bands} />
      ) : (
        <NovoContratoForm clients={clients} bands={bands} isApprover={isCaseContractApprover(ctx.email)} />
      )}
    </div>
  );
}
