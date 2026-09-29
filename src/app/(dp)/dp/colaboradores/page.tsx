import { redirect } from "next/navigation";

import { DpColaboradoresClient } from "@/components/dp/colaboradores-client";
import { DpNaoInstalado } from "@/components/dp/nao-instalado";
import { getDpUser } from "@/lib/dp/auth";
import { DpNaoInstaladoError, listDpColaboradores } from "@/lib/dp/queries";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function DpColaboradoresPage() {
  const user = await getDpUser();
  if (!user) redirect("/");
  let rows;
  try {
    rows = await listDpColaboradores(createAdminClient());
  } catch (error) {
    if (error instanceof DpNaoInstaladoError) return <DpNaoInstalado />;
    throw error;
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-ink-primary">Colaboradores</h1>
        <p className="text-sm text-ink-muted">
          Cadastro espelhado da Sólides — correções são feitas lá e aparecem aqui na próxima sincronização.
        </p>
      </div>
      <DpColaboradoresClient rows={rows} />
    </div>
  );
}
