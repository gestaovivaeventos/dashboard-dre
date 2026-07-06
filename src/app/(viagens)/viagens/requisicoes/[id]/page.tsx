import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { getViagensUser } from "@/lib/viagens/auth";
import { getViagemRequestDetail } from "@/lib/viagens/queries";
import { ViagemWorkspace } from "@/components/viagens/viagem-workspace";

export const dynamic = "force-dynamic";

export default async function ViagemDetailPage({ params }: { params: { id: string } }) {
  const ctx = await getViagensUser();
  if (!ctx) redirect("/login");

  const detail = await getViagemRequestDetail(params.id);
  if (!detail) notFound();

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <Link
        href="/viagens/requisicoes"
        className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink-primary"
      >
        <ArrowLeft className="h-4 w-4" />
        Viagens
      </Link>
      <ViagemWorkspace detail={detail} isAprovador={ctx.isAprovador} />
    </div>
  );
}
