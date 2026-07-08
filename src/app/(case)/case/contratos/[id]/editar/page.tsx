import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { getCaseUser } from "@/lib/case/auth";
import { getClients, getContractForEdit } from "@/lib/case/queries";
import { NovoContratoForm } from "@/components/case/novo-contrato-form";

export const dynamic = "force-dynamic";

export default async function EditarContratoPage({ params }: { params: { id: string } }) {
  const ctx = await getCaseUser();
  if (!ctx) redirect("/login");

  const [edit, clients] = await Promise.all([getContractForEdit(params.id), getClients()]);
  if (!edit) notFound();
  // Contrato assinado não pode mais ser editado (o PDF assinado ficaria divergente).
  if (edit.signed_at) redirect(`/case/contratos/${params.id}`);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link
          href={`/case/contratos/${params.id}`}
          className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          Contrato #{edit.contract_number}
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-ink-primary">Editar contrato #{edit.contract_number}</h1>
        <p className="text-sm text-ink-muted">
          Corrija os dados do cliente, do evento e das testemunhas. Depois de salvar, gere e reenvie para assinatura.
        </p>
      </div>

      <NovoContratoForm clients={clients} bands={[]} edit={edit} />
    </div>
  );
}
