import { redirect } from "next/navigation";

import { getCaseUser } from "@/lib/case/auth";
import { getAgendaContracts } from "@/lib/case/queries";
import { AgendaView } from "@/components/case/agenda-view";

export const dynamic = "force-dynamic";

export default async function CaseAgendaPage() {
  const ctx = await getCaseUser();
  if (!ctx) redirect("/login");

  const contracts = await getAgendaContracts();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink-primary">Agenda de Contratos</h1>
        <p className="text-sm text-ink-muted">
          Um card por contrato, agrupado por mês do evento — dados do contratante, valores, status de pagamento no Omie e download dos contratos.
        </p>
      </div>
      <AgendaView contracts={contracts} />
    </div>
  );
}
