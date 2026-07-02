import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, AlertTriangle } from "lucide-react";

import { getCaseUser } from "@/lib/case/auth";
import { getClients, getBands, isOmieConfigured } from "@/lib/case/queries";
import { NovoContratoForm } from "@/components/case/novo-contrato-form";

export const dynamic = "force-dynamic";

export default async function NovoContratoPage() {
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
        <h1 className="mt-2 text-xl font-semibold text-ink-primary">Novo contrato</h1>
        <p className="text-sm text-ink-muted">
          Lançe o contrato do show vendido — gera contas a pagar (artista) e a receber (cliente) no Omie.
        </p>
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

      <NovoContratoForm clients={clients} bands={bands} />
    </div>
  );
}
