import { redirect } from "next/navigation";

import { getCtrlUser, hasCtrlRole } from "@/lib/ctrl/auth";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { OmieMapeamentoClient } from "@/components/ctrl/omie-mapeamento-client";

async function getOmieCompanies() {
  const adminClient = createAdminClientIfAvailable();
  const supabase = adminClient ?? (await createClient());

  const { data } = await supabase
    .from("companies")
    .select("id, name")
    .eq("active", true)
    .not("omie_app_key", "is", null)
    .not("omie_app_secret", "is", null)
    .order("name");

  return data ?? [];
}

export default async function OmieMapeamentoPage() {
  const ctx = await getCtrlUser();
  if (!ctx) redirect("/login");

  if (!hasCtrlRole(ctx, "admin", "csc")) {
    redirect("/ctrl/requisicoes");
  }

  const companies = await getOmieCompanies();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Mapeamento Omie</h1>
        <p className="text-muted-foreground">
          Vincule tipo de despesa→categoria, setor→departamento e a conta OmieCash de cada empresa
        </p>
      </div>

      <OmieMapeamentoClient companies={companies} />
    </div>
  );
}
