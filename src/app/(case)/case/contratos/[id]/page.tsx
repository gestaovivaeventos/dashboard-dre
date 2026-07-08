import { notFound, redirect } from "next/navigation";

import { getCaseUser } from "@/lib/case/auth";
import { getContractDetail, getBands } from "@/lib/case/queries";
import { ContratoWorkspace } from "@/components/case/contrato-workspace";

export const dynamic = "force-dynamic";

export default async function CaseContratoDetailPage({ params }: { params: { id: string } }) {
  const ctx = await getCaseUser();
  if (!ctx) redirect("/login");

  const [detail, bands] = await Promise.all([getContractDetail(params.id), getBands()]);
  if (!detail) notFound();

  return (
    <div className="mx-auto max-w-4xl">
      <ContratoWorkspace detail={detail} bands={bands} fornecedorBands={bands} />
    </div>
  );
}
