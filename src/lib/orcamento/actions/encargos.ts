"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { getOrcamentoAdmin } from "@/lib/orcamento/auth";
import { isSchemaMissing } from "@/lib/orcamento/errors";
import { isValidBudgetYear } from "@/lib/orcamento/years";
import { ENCARGOS, encargosPadrao, type EncargoValues } from "@/lib/orcamento/encargos";

const PATH = "/orcamento/configuracoes/encargos";

export interface CompanyEncargos {
  companyId: string;
  companyName: string;
  /** Regime tributário cadastral da empresa (null = não definido). */
  regimeTributario: string | null;
  values: EncargoValues;
  /** true quando a empresa ainda não tem linha própria no ano e está exibindo
   * o padrão do regime — nada foi gravado ainda. */
  usandoPadrao: boolean;
}

function db() {
  return createAdminClientIfAvailable();
}

const ENCARGO_COLS = "company_id, inss_patronal, rat_fap, terceiros, fgts";

/** Lê a linha de encargos de uma empresa/ano, caindo no padrão do regime. */
function readValues(
  row: Record<string, unknown> | undefined,
  regimeTributario: string | null,
): { values: EncargoValues; usandoPadrao: boolean } {
  const padrao = encargosPadrao(regimeTributario);
  if (!row) return { values: padrao, usandoPadrao: true };

  const values = { ...padrao };
  for (const meta of ENCARGOS) {
    const raw = row[meta.key];
    // Coluna nula (encargo nunca preenchido) mantém o padrão do regime.
    if (raw != null) values[meta.key] = Number(raw);
  }
  return { values, usandoPadrao: false };
}

/** Alíquotas de todas as empresas ativas no ano, já resolvidas contra o padrão
 * do regime tributário de cada uma. */
export async function getEncargosCompanies(year: number): Promise<{
  items?: CompanyEncargos[];
  error?: string;
  needsMigration?: boolean;
}> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const supabase = db() ?? (await createClient());

  const { data: companies, error: compErr } = await supabase
    .from("companies")
    .select("id, name, regime_tributario")
    .eq("active", true)
    .order("name");
  if (compErr) return { error: compErr.message };

  const { data: rows, error: rowsErr } = await supabase
    .from("orcamento_encargos")
    .select(ENCARGO_COLS)
    .eq("year", year);
  if (rowsErr) {
    if (isSchemaMissing(rowsErr.message)) return { needsMigration: true };
    return { error: rowsErr.message };
  }

  const byCompany = new Map(
    (rows ?? []).map((r) => [r.company_id as string, r as Record<string, unknown>]),
  );

  const items: CompanyEncargos[] = (companies ?? []).map((c) => {
    const regimeTributario = (c.regime_tributario as string | null) ?? null;
    const { values, usandoPadrao } = readValues(byCompany.get(c.id as string), regimeTributario);
    return {
      companyId: c.id as string,
      companyName: c.name as string,
      regimeTributario,
      values,
      usandoPadrao,
    };
  });

  return { items };
}

/** Alíquotas de UMA empresa no ano — usado pelo motor da prévia. */
export async function getEncargos(
  companyId: string,
  year: number,
): Promise<{ values?: EncargoValues; error?: string; needsMigration?: boolean }> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!companyId) return { error: "Selecione uma empresa." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const supabase = db() ?? (await createClient());

  const { data: company, error: compErr } = await supabase
    .from("companies")
    .select("regime_tributario")
    .eq("id", companyId)
    .maybeSingle();
  if (compErr) return { error: compErr.message };

  const { data: row, error: rowErr } = await supabase
    .from("orcamento_encargos")
    .select(ENCARGO_COLS)
    .eq("company_id", companyId)
    .eq("year", year)
    .maybeSingle();
  if (rowErr) {
    if (isSchemaMissing(rowErr.message)) return { needsMigration: true };
    return { error: rowErr.message };
  }

  const { values } = readValues(
    (row as Record<string, unknown> | null) ?? undefined,
    (company?.regime_tributario as string | null) ?? null,
  );
  return { values };
}

/** Grava as alíquotas de uma empresa no ano. */
export async function setEncargos(companyId: string, year: number, values: EncargoValues) {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!companyId) return { error: "Empresa inválida." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const row: Record<string, number> = {};
  for (const meta of ENCARGOS) {
    const v = values[meta.key];
    if (!Number.isFinite(v) || v < 0 || v > 100) {
      return { error: `Alíquota inválida em ${meta.label} (use de 0 a 100).` };
    }
    row[meta.key] = v;
  }

  const supabase = db() ?? (await createClient());
  const { error } = await supabase.from("orcamento_encargos").upsert(
    { company_id: companyId, year, ...row, updated_by: admin.userId },
    { onConflict: "company_id,year" },
  );
  if (error) {
    if (isSchemaMissing(error.message)) return { needsMigration: true };
    return { error: error.message };
  }
  revalidatePath(PATH);
  revalidatePath("/orcamento/despesas/pessoal");
  return { ok: true as const };
}

/** Volta a empresa ao padrão do regime tributário (remove a linha do ano). */
export async function resetEncargos(companyId: string, year: number) {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!companyId) return { error: "Empresa inválida." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const supabase = db() ?? (await createClient());
  const { error } = await supabase
    .from("orcamento_encargos")
    .delete()
    .eq("company_id", companyId)
    .eq("year", year);
  if (error) return { error: error.message };
  revalidatePath(PATH);
  revalidatePath("/orcamento/despesas/pessoal");
  return { ok: true as const };
}
