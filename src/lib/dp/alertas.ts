import "server-only";

import { todayBR } from "@/lib/ctrl/datetime";
import { indexarRegras, resolverEmpresa } from "@/lib/dp/empresa";
import { listDpRegras } from "@/lib/dp/queries";
import { alertasExperiencia, type DpAlertaExperiencia } from "@/lib/dp/vinculo";
import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

export interface DpAlertaExperienciaComEmpresa extends DpAlertaExperiencia {
  empresa: string | null;
}

/**
 * Períodos de experiência vencendo nos próximos 15 dias, do grupo inteiro.
 * Uma leitura só para a Visão geral do DP e para a tela inicial — e a tela
 * inicial só chama isto para quem TEM o módulo (sigilo: nome de colaborador e
 * situação contratual não aparecem para mais ninguém).
 */
export async function listarAlertasExperiencia(db: AdminClient): Promise<DpAlertaExperienciaComEmpresa[]> {
  const [regras, companies, colabs] = await Promise.all([
    listDpRegras(db),
    db.from("companies").select("id, name"),
    db
      .from("dp_colaboradores")
      .select("id, nome, ativo, tipo_contrato, data_admissao, experiencia_fim, experiencia_duracao, unidade_id, departamento_id")
      .eq("ativo", true),
  ]);
  if (colabs.error) throw new Error(`dp_colaboradores: ${colabs.error.message}`);
  const idx = indexarRegras(regras);
  const nomes = new Map((companies.data ?? []).map((c) => [c.id as string, c.name as string]));
  const empresaDe = new Map<string, string | null>();
  const pessoas = (colabs.data ?? []).map((r) => {
    const e = resolverEmpresa(
      {
        unidadeId: r.unidade_id === null ? null : Number(r.unidade_id),
        departamentoId: r.departamento_id === null ? null : Number(r.departamento_id),
      },
      idx,
    );
    empresaDe.set(r.id as string, e.companyId ? nomes.get(e.companyId) ?? null : null);
    return {
      id: r.id as string,
      nome: r.nome as string,
      ativo: Boolean(r.ativo),
      tipoContrato: r.tipo_contrato as string | null,
      admissao: r.data_admissao as string | null,
      experienciaFim: r.experiencia_fim as string | null,
      duracao: r.experiencia_duracao as string | null,
    };
  });
  return alertasExperiencia(pessoas, todayBR()).map((a) => ({ ...a, empresa: empresaDe.get(a.id) ?? null }));
}
