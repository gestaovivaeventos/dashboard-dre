"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { getOrcamentoAdmin } from "@/lib/orcamento/auth";
import { isSchemaMissing } from "@/lib/orcamento/errors";
import { defaultBudgetYear, isValidBudgetYear } from "@/lib/orcamento/years";

export interface CompanyBudgetConfig {
  companyId: string;
  companyName: string;
  orcarPorSetor: boolean;
  /** Mostra a coluna "Empresa" no quadro de pessoal (regime dos encargos). */
  usarEmpresaEncargos: boolean;
}

/**
 * Lista todas as empresas ativas com a flag "orçar por setor" de cada uma NO
 * ANO informado. Empresas sem linha em orcamento_company_config para o ano
 * assumem o padrão (false).
 */
export async function getCompaniesBudgetConfig(year?: number): Promise<{
  items?: CompanyBudgetConfig[];
  year?: number;
  error?: string;
  needsMigration?: boolean;
}> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  const y = year && isValidBudgetYear(year) ? year : defaultBudgetYear();

  const supabase = createAdminClientIfAvailable() ?? (await createClient());

  const { data: companies, error: companiesError } = await supabase
    .from("companies")
    .select("id, name")
    .eq("active", true)
    .order("name");
  if (companiesError) return { error: companiesError.message };

  const { data: configs, error: configError } = await supabase
    .from("orcamento_company_config")
    .select("company_id, orcar_por_setor, usar_empresa_encargos")
    .eq("year", y);
  if (configError) {
    if (isSchemaMissing(configError.message)) return { needsMigration: true };
    return { error: configError.message };
  }

  const configByCompany = new Map(
    (configs ?? []).map((c) => [
      c.company_id as string,
      {
        orcarPorSetor: Boolean(c.orcar_por_setor),
        usarEmpresaEncargos: Boolean(c.usar_empresa_encargos),
      },
    ]),
  );

  const items: CompanyBudgetConfig[] = (companies ?? []).map((c) => {
    const cfg = configByCompany.get(c.id as string);
    return {
      companyId: c.id as string,
      companyName: c.name as string,
      orcarPorSetor: cfg?.orcarPorSetor ?? false,
      usarEmpresaEncargos: cfg?.usarEmpresaEncargos ?? false,
    };
  });

  return { items, year: y };
}

/** Liga/desliga o detalhamento por setor no orçamento de uma empresa, no ano. */
export async function setOrcarPorSetor(companyId: string, year: number, value: boolean) {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!companyId) return { error: "Empresa inválida." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());
  const { error } = await supabase.from("orcamento_company_config").upsert(
    {
      company_id: companyId,
      year,
      orcar_por_setor: value,
      updated_by: admin.userId,
    },
    { onConflict: "company_id,year" },
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

/**
 * Liga/desliga a coluna "Empresa" no quadro de pessoal da empresa, no ano.
 *
 * Desligado, a coluna some E os encargos de todo o quadro passam a seguir o
 * regime da própria empresa orçada — o toggle governa o comportamento, não só a
 * exibição, para não sobrar regra invisível mexendo em número de orçamento.
 */
export async function setUsarEmpresaEncargos(companyId: string, year: number, value: boolean) {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!companyId) return { error: "Empresa inválida." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());
  const { error } = await supabase.from("orcamento_company_config").upsert(
    {
      company_id: companyId,
      year,
      usar_empresa_encargos: value,
      updated_by: admin.userId,
    },
    { onConflict: "company_id,year" },
  );
  if (error) {
    if (isSchemaMissing(error.message)) return { needsMigration: true };
    return { error: error.message };
  }

  revalidatePath("/orcamento/configuracoes/empresa-encargos");
  revalidatePath("/orcamento/despesas/pessoal");
  return { ok: true as const };
}

/**
 * Copia a configuração "orçar por setor" de todas as empresas de um ano para
 * outro (ex.: começar 2028 a partir de 2027). Não sobrescreve empresas que já
 * tenham configuração no ano de destino. Retorna quantas foram copiadas.
 */
export async function cloneOrcarPorSetorFromYear(fromYear: number, toYear: number) {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!isValidBudgetYear(fromYear) || !isValidBudgetYear(toYear)) {
    return { error: "Ano do orçamento inválido." };
  }
  if (fromYear === toYear) return { error: "Escolha anos de origem e destino diferentes." };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());

  const { data: source, error: srcError } = await supabase
    .from("orcamento_company_config")
    .select("company_id, orcar_por_setor, regime_apuracao, usar_empresa_encargos")
    .eq("year", fromYear);
  if (srcError) {
    if (isSchemaMissing(srcError.message)) return { needsMigration: true };
    return { error: srcError.message };
  }
  if (!source || source.length === 0) return { ok: true as const, copied: 0 };

  const { data: existing, error: existError } = await supabase
    .from("orcamento_company_config")
    .select("company_id")
    .eq("year", toYear);
  if (existError) return { error: existError.message };
  const taken = new Set((existing ?? []).map((r) => r.company_id as string));

  const rows = source
    .filter((r) => !taken.has(r.company_id as string))
    .map((r) => ({
      company_id: r.company_id as string,
      year: toYear,
      orcar_por_setor: Boolean(r.orcar_por_setor),
      regime_apuracao: (r.regime_apuracao as string | null) ?? null,
      usar_empresa_encargos: Boolean(r.usar_empresa_encargos),
      updated_by: admin.userId,
    }));
  if (rows.length === 0) return { ok: true as const, copied: 0 };

  const { error: insError } = await supabase.from("orcamento_company_config").insert(rows);
  if (insError) return { error: insError.message };

  revalidatePath("/orcamento/configuracoes/orcar-por-setor");
  return { ok: true as const, copied: rows.length };
}
