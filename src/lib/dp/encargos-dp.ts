import "server-only";

import { resolverEncargos, type EncargoValues } from "@/lib/orcamento/encargos";
import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

export interface DpEncargosEmpresa {
  values: EncargoValues;
  /** De onde vieram as alíquotas — a tela diz isso ao lado do custo. */
  origem: { tipo: "cadastro"; ano: number } | { tipo: "padrao"; regime: string | null };
}

/**
 * Alíquotas de encargos de uma empresa para as simulações do DP.
 *
 * Lê o MESMO cadastro do Orçamento (`orcamento_encargos`, empresa × ano) e
 * resolve com a MESMA regra (`resolverEncargos`), mas com o acesso do DP — os
 * leitores do Orçamento exigem o módulo Orçamento, que quem tem o DP pode não
 * ter. Ano: o pedido, senão o mais recente cadastrado (o Orçamento costuma
 * estar montando o ano que vem), senão o padrão do regime tributário.
 */
export async function lerEncargosDaEmpresa(db: AdminClient, companyId: string, ano: number): Promise<DpEncargosEmpresa> {
  const [{ data: company }, { data: rows, error }] = await Promise.all([
    db.from("companies").select("regime_tributario").eq("id", companyId).maybeSingle(),
    db
      .from("orcamento_encargos")
      .select("year, inss_patronal, rat_fap, terceiros, fgts")
      .eq("company_id", companyId)
      .order("year", { ascending: false }),
  ]);
  const regime = (company?.regime_tributario as string | null) ?? null;
  // Tabela do Orçamento ausente ou ilegível não derruba a simulação: cai no padrão, dito na tela.
  if (error || !rows || rows.length === 0) {
    return { values: resolverEncargos(null, regime).values, origem: { tipo: "padrao", regime } };
  }
  const row = rows.find((r) => Number(r.year) === ano) ?? rows[0];
  return {
    values: resolverEncargos(row as Record<string, unknown>, regime).values,
    origem: { tipo: "cadastro", ano: Number(row.year) },
  };
}
