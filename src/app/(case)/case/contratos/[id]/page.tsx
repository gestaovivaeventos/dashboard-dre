import { notFound, redirect } from "next/navigation";

import { getCaseUser } from "@/lib/case/auth";
import { getContractDetail, getBvDetail, getBands } from "@/lib/case/queries";
import { ContratoWorkspace } from "@/components/case/contrato-workspace";
import { BvWorkspace } from "@/components/case/bv-workspace";
import { isCaseContractApprover } from "@/lib/case/contract-config";

export const dynamic = "force-dynamic";

export default async function CaseContratoDetailPage({ params }: { params: { id: string } }) {
  const ctx = await getCaseUser();
  if (!ctx) redirect("/login");

  // BV artístico tem tela própria: sem cliente, sem atrações, sem assinatura.
  const bv = await getBvDetail(params.id);
  if (bv) {
    return (
      <div className="mx-auto max-w-4xl">
        <BvWorkspace detail={bv} />
      </div>
    );
  }

  const [detail, bands] = await Promise.all([getContractDetail(params.id), getBands()]);
  if (!detail) notFound();

  return (
    <div className="mx-auto max-w-4xl">
      <ContratoWorkspace detail={detail} bands={bands} fornecedorBands={bands} isApprover={isCaseContractApprover(ctx.email)} />
    </div>
  );
}
