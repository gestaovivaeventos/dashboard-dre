import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, AlertTriangle, FileSignature } from "lucide-react";

import { getCaseUser } from "@/lib/case/auth";
import { getContracts, isOmieConfigured } from "@/lib/case/queries";
import { ContratosTable } from "@/components/case/contratos-table";
import { isCaseContractApprover } from "@/lib/case/contract-config";

export const dynamic = "force-dynamic";

export default async function CaseContratosPage() {
  const ctx = await getCaseUser();
  if (!ctx) redirect("/login");

  const [contracts, omieOk] = await Promise.all([getContracts(), isOmieConfigured()]);
  const awaitingApproval = isCaseContractApprover(ctx.email)
    ? contracts.filter((c) => c.status === "aguardando_aprovacao")
    : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-ink-primary">Contratos Case</h1>
          <p className="text-sm text-ink-muted">
            Contratos de shows vendidos — lançados no Omie da Case Shows.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/case/contratos/novo?tipo=bv"
            className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-ink-secondary transition-colors hover:bg-surface-2"
          >
            <Plus className="h-4 w-4" />
            BV artístico
          </Link>
          <Link
            href="/case/contratos/novo"
            className="inline-flex items-center gap-2 rounded-md bg-amber-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-700"
          >
            <Plus className="h-4 w-4" />
            Novo contrato
          </Link>
        </div>
      </div>

      {!omieOk && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            A configuração Omie do Case está incompleta. Os lançamentos não serão enviados até
            mapear as categorias e a conta corrente em{" "}
            <Link href="/case/config" className="font-medium underline">
              Configuração Omie
            </Link>
            .
          </span>
        </div>
      )}

      {awaitingApproval.length > 0 && (
        <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
          <div className="flex items-center gap-2 font-medium">
            <FileSignature className="h-4 w-4" />
            {awaitingApproval.length === 1 ? "1 contrato aguardando sua aprovação" : `${awaitingApproval.length} contratos aguardando sua aprovação`}
          </div>
          <ul className="mt-2 space-y-1">
            {awaitingApproval.map((c) => (
              <li key={c.id}>
                <Link href={`/case/contratos/${c.id}`} className="underline-offset-2 hover:underline">
                  #{c.contract_number} — {c.client_name}
                  {c.event_name ? ` · ${c.event_name}` : ""}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ContratosTable contracts={contracts} />
    </div>
  );
}
