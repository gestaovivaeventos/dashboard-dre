"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { getOrcamentoAdmin } from "@/lib/orcamento/auth";
import { isSchemaMissing } from "@/lib/orcamento/errors";

export interface CompanyBudgetConfig {
  companyId: string;
  companyName: string;
  orcarPorSetor: boolean;
}

/**
 * Lista todas as empresas ativas com a flag "orçar por setor" de cada uma.
 * Empresas sem linha em orcamento_company_config assumem o padrão (false).
 */
export async function getCompaniesBudgetConfig(): Promise<{
  items?: CompanyBudgetConfig[];
  error?: string;
  needsMigration?: boolean;
}> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());

  const { data: companies, error: companiesError } = await supabase
    .from("companies")
    .select("id, name")
    .eq("active", true)
    .order("name");
  if (companiesError) return { error: companiesError.message };

  const { data: configs, error: configError } = await supabase
    .from("orcamento_company_config")
    .select("company_id, orcar_por_setor");
  if (configError) {
    if (isSchemaMissing(configError.message)) return { needsMigration: true };
    return { error: configError.message };
  }

  const flagByCompany = new Map(
    (configs ?? []).map((c) => [c.company_id as string, Boolean(c.orcar_por_setor)]),
  );

  const items: CompanyBudgetConfig[] = (companies ?? []).map((c) => ({
    companyId: c.id as string,
    companyName: c.name as string,
    orcarPorSetor: flagByCompany.get(c.id as string) ?? false,
  }));

  return { items };
}

/** Liga/desliga o detalhamento por setor no orçamento de uma empresa. */
export async function setOrcarPorSetor(companyId: string, value: boolean) {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!companyId) return { error: "Empresa inválida." };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());
  const { error } = await supabase.from("orcamento_company_config").upsert(
    {
      company_id: companyId,
      orcar_por_setor: value,
      updated_by: admin.userId,
    },
    { onConflict: "company_id" },
  );
  if (error) {
    if (isSchemaMissing(error.message)) {
      return { error: "Migration do módulo Orçamento ainda não aplicada." };
    }
    return { error: error.message };
  }

  revalidatePath("/orcamento/configuracoes/orcar-por-setor");
  revalidatePath("/orcamento/configuracoes/setores");
  return { ok: true as const };
}
