"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { getOrcamentoUser, podeVerEmpresa } from "@/lib/orcamento/auth";
import { orcaPorSetor } from "@/lib/orcamento/setor-gravacao";
import { isValidBudgetYear } from "@/lib/orcamento/years";
import { diagnosticarEscopo, type EscopoDiagnostico } from "@/lib/orcamento/escopo";
import { setoresDoAnoAtribuidos } from "@/lib/orcamento/setor-atribuicao";

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

  const [{ data: setores }, { data: atribuidos }, porSetor] = await Promise.all([
    supabase
      .from("orcamento_setores")
      .select("id, name, ctrl_sector_id, active")
      .eq("company_id", companyId)
      .eq("year", year),
    // A atribuição é POR EMPRESA: ter o setor em outra não conta aqui, e é
    // justamente essa diferença que o aviso precisa saber explicar.
    supabase
      .from("orcamento_user_setores")
      .select("setor_nome")
      .eq("user_id", user.userId)
      .eq("company_id", companyId),
    orcaPorSetor(supabase, companyId, year),
  ]);

  const ativos = ((setores ?? []) as Array<Record<string, unknown>>).filter(
    (s) => s.active !== false,
  );
  const nomesAtribuidos = ((atribuidos ?? []) as Array<Record<string, unknown>>).map(
    (r) => r.setor_nome as string,
  );
  const alcancados = setoresDoAnoAtribuidos(
    nomesAtribuidos,
    ativos.map((s) => ({ id: s.id as string, name: (s.name as string) ?? "" })),
  );

  return {
    diagnostico: diagnosticarEscopo({
      papel: user.papel,
      orcaPorSetor: porSetor,
      setoresAtribuidos: nomesAtribuidos.length,
      setoresDaEmpresa: ativos.length,
      setoresAlcancados: alcancados.length,
    }),
  };
}
