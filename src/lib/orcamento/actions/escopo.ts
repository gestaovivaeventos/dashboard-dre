"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { getOrcamentoUser, podeVerEmpresa } from "@/lib/orcamento/auth";
import { orcaPorSetor } from "@/lib/orcamento/setor-gravacao";
import { isValidBudgetYear } from "@/lib/orcamento/years";
import { diagnosticarEscopo, type EscopoDiagnostico } from "@/lib/orcamento/escopo";

/**
 * Junta os fatos do escopo desta empresa × ano e devolve o diagnóstico.
 *
 * Duas consultas: os setores da empresa (que já trazem a ponte com o Compras) e
 * a chave "orçar por setor". Os setores do usuário já vieram na sessão.
 *
 * Roda com o ADMIN CLIENT de propósito, depois do gate de empresa: as policies
 * de `orcamento_setores` recortam pelo próprio acesso, e é justamente quando o
 * escopo está vazio que precisamos CONTAR o que existe para explicar por quê —
 * ler sob a RLS do usuário devolveria zero em todos os casos e o aviso não
 * saberia distinguir "a empresa não tem setor" de "os setores são de outro".
 * Só números saem daqui, nunca conteúdo de orçamento.
 */
export async function diagnosticarEscopoDaEmpresa(
  companyId: string,
  year: number,
): Promise<{ diagnostico?: EscopoDiagnostico; error?: string }> {
  if (!companyId || !isValidBudgetYear(year)) return {};

  const user = await getOrcamentoUser();
  if (!user) return {};
  if (!podeVerEmpresa(user, companyId)) return {};
  // O admin não é recortado em lugar nenhum: nem vale o custo das consultas.
  if (user.isAdmin) return {};

  const supabase = createAdminClientIfAvailable() ?? (await createClient());

  const [{ data: setores }, porSetor] = await Promise.all([
    supabase
      .from("orcamento_setores")
      .select("id, ctrl_sector_id, active")
      .eq("company_id", companyId)
      .eq("year", year),
    orcaPorSetor(supabase, companyId, year),
  ]);

  const ativos = ((setores ?? []) as Array<Record<string, unknown>>).filter(
    (s) => s.active !== false,
  );
  const doUsuario = new Set(user.ctrlSectorIds);

  return {
    diagnostico: diagnosticarEscopo({
      papel: user.papel,
      orcaPorSetor: porSetor,
      ctrlSetoresDoUsuario: user.ctrlSectorIds.length,
      setoresDaEmpresa: ativos.length,
      setoresComPonte: ativos.filter((s) => s.ctrl_sector_id != null).length,
      setoresAlcancados: ativos.filter(
        (s) => s.ctrl_sector_id != null && doUsuario.has(s.ctrl_sector_id as string),
      ).length,
    }),
  };
}
