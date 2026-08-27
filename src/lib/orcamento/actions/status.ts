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

  // RPC agregado + status do planejamento dos sócios (categorias do método ×
  // propostas confirmadas). O planejamento vem de duas tabelas — busca junto.
  const [rpc, metodoRes, psRes] = await Promise.all([
    supabase.rpc("orcamento_status_por_empresa", { p_year: y }),
    supabase
      .from("orcamento_categoria_metodo")
      .select("company_id, category_code")
      .eq("year", y)
      .eq("metodo", "planejamento_socios"),
    supabase
      .from("orcamento_planejamento_socios")
      .select("company_id, category_code, proposta_confirmada")
      .eq("year", y),
  ]);
  if (rpc.error || !rpc.data) return { statuses: {} };

  // (company_id|category_code) das propostas CONFIRMADAS.
  const confirmadas = new Set<string>();
  for (const r of (psRes.data ?? []) as Array<{
    company_id: string;
    category_code: string;
    proposta_confirmada: boolean | null;
  }>) {
    if (r.proposta_confirmada === true) confirmadas.add(`${r.company_id}|${r.category_code}`);
  }
  // Por empresa: total de categorias do método e quantas estão confirmadas.
  const planTotal: Record<string, number> = {};
  const planConfirmado: Record<string, number> = {};
  for (const m of (metodoRes.data ?? []) as Array<{ company_id: string; category_code: string }>) {
    planTotal[m.company_id] = (planTotal[m.company_id] ?? 0) + 1;
    if (confirmadas.has(`${m.company_id}|${m.category_code}`)) {
      planConfirmado[m.company_id] = (planConfirmado[m.company_id] ?? 0) + 1;
    }
  }

  const statuses: Record<string, OrcamentoStatusRaw> = {};
  for (const row of rpc.data as Array<{
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
      planejamentoTotal: planTotal[row.company_id] ?? 0,
      planejamentoConfirmado: planConfirmado[row.company_id] ?? 0,
    };
  }
  return { statuses };
}
