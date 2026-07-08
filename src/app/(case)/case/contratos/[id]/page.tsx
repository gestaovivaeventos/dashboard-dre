import { notFound, redirect } from "next/navigation";

import { getCaseUser } from "@/lib/case/auth";
import { getContractDetail, getBands } from "@/lib/case/queries";
import { ContratoWorkspace } from "@/components/case/contrato-workspace";

export const dynamic = "force-dynamic";

export default async function CaseContratoDetailPage({ params }: { params: { id: string } }) {
  const ctx = await getCaseUser();
  if (!ctx) redirect("/login");

  const [detail, bands, fornecedorBands] = await Promise.all([
    getContractDetail(params.id),
    getBands("atracao"),
    getBands("fornecedor"),
  ]);
  if (!detail) notFound();

  return (
    <div className="mx-auto max-w-4xl">
      <ContratoWorkspace detail={detail} bands={bands} fornecedorBands={fornecedorBands} />
    </div>
  );
}
