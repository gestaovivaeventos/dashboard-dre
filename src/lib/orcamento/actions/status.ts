"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { getOrcamentoAdmin } from "@/lib/orcamento/auth";
import { isValidBudgetYear, defaultBudgetYear } from "@/lib/orcamento/years";
import type { OrcamentoStatusRaw } from "@/lib/orcamento/status";

/**
 * Status de andamento por empresa para um ano (Fase 3). Uma chamada ao RPC
 * agregado, devolvendo um mapa companyId → contagens. O status é ACESSÓRIO: se o
 * RPC ainda não existe (migration não aplicada) ou qualquer erro ocorrer,
 * devolve mapa vazio — a tela só não mostra os selos, sem quebrar.
 */
export async function getOrcamentoStatus(
  year?: number,
): Promise<{ statuses: Record<string, OrcamentoStatusRaw> }> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { statuses: {} };
  const y = year && isValidBudgetYear(year) ? year : defaultBudgetYear();

  const supabase = createAdminClientIfAvailable() ?? (await createClient());

  const { data, error } = await supabase.rpc("orcamento_status_por_empresa", { p_year: y });
  if (error || !data) return { statuses: {} };

  const statuses: Record<string, OrcamentoStatusRaw> = {};
  for (const row of data as Array<{
    company_id: string;
    colaboradores: number | null;
    media_total: number | null;
    media_com_valor: number | null;
    metodo_count: number | null;
  }>) {
    statuses[row.company_id] = {
      colaboradores: Number(row.colaboradores ?? 0),
      mediaTotal: Number(row.media_total ?? 0),
      mediaComValor: Number(row.media_com_valor ?? 0),
      metodoCount: Number(row.metodo_count ?? 0),
    };
  }
  return { statuses };
}
