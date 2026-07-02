import { redirect } from "next/navigation";

import { getCaseUser } from "@/lib/case/auth";
import { getOmieConfigData } from "@/lib/case/actions/omie-config";
import { OmieConfigForm } from "@/components/case/omie-config-form";

export const dynamic = "force-dynamic";

export default async function CaseConfigPage() {
  const ctx = await getCaseUser();
  if (!ctx) redirect("/login");
  if (!ctx.isAdmin) redirect("/case/contratos");

  const data = await getOmieConfigData();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink-primary">Configuração Omie — Case Shows</h1>
        <p className="text-sm text-ink-muted">
          Mapeie as categorias financeiras e a conta corrente usadas no lançamento dos contratos.
        </p>
      </div>
      <OmieConfigForm initial={data} />
    </div>
  );
}
