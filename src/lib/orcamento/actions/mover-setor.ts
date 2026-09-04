"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { getOrcamentoAdmin } from "@/lib/orcamento/auth";
import { isSchemaMissing } from "@/lib/orcamento/errors";
import { isValidBudgetYear } from "@/lib/orcamento/years";

// =============================================================================
// Mover uma linha de orçamento de um SETOR para outro (só admin).
//
// Nasceu de duas necessidades reais: o orçamento migrado da Fase 1 caiu todo em
// "Não atribuído" e precisa ser distribuído, e o departamento do lançamento nem
// sempre reflete quem de fato vai gastar no ano que vem.
//
// Move só a LINHA (a despesa), nunca a categoria: o modelo é "a categoria tem
// N setores, cada despesa tem 1". Por isso a categoria é ATRIBUÍDA ao setor de
// destino junto, senão a linha pousaria num setor que não a lista.
// =============================================================================

export type MetodoComSetor = "media" | "valor_fixo" | "planejamento_socios";

const TABELA: Record<MetodoComSetor, string> = {
  media: "orcamento_media_categorias",
  valor_fixo: "orcamento_valor_fixo_categorias",
  planejamento_socios: "orcamento_planejamento_socios",
};

// As telas de método vivem no workspace (/orcamento/empresa/[id]/[ano]/[slug]),
// então revalidar a raiz do módulo cobre todas — é o que as próprias actions
// dos métodos já fazem.
const PATH = "/orcamento";

/**
 * Move para `destinoSetorId` as linhas de uma categoria num método.
 *
 * `linhaId` move UMA linha (o contrato específico do valor fixo); sem ele, move
 * a categoria inteira naquele setor de origem — que é o caso comum ao esvaziar
 * o "Não atribuído".
 */
export async function moverLinhaDeSetor(params: {
  companyId: string;
  year: number;
  metodo: MetodoComSetor;
  categoryCode: string;
  origemSetorId: string | null;
  destinoSetorId: string;
  /** Só para valor fixo, que tem N contratos por categoria. */
  linhaId?: string;
}) {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  const { companyId, year, metodo, categoryCode, origemSetorId, destinoSetorId, linhaId } = params;
  if (!companyId || !categoryCode) return { error: "Categoria inválida." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };
  if (!destinoSetorId) return { error: "Escolha o setor de destino." };
  if (destinoSetorId === origemSetorId) return { ok: true as const, movidas: 0 };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());

  // O setor de destino tem de ser da MESMA empresa e ano — senão a linha sairia
  // do orçamento sem deixar rastro.
  const { data: setor } = await supabase
    .from("orcamento_setores")
    .select("id")
    .eq("id", destinoSetorId)
    .eq("company_id", companyId)
    .eq("year", year)
    .maybeSingle();
  if (!setor) return { error: "Setor de destino não pertence a esta empresa/ano." };

  // A categoria precisa existir no setor de destino, senão a linha fica órfã:
  // no orçamento, mas fora de qualquer card.
  const { error: atribErr } = await supabase.from("orcamento_categoria_setores").upsert(
    {
      company_id: companyId,
      year,
      category_code: categoryCode,
      setor_id: destinoSetorId,
      updated_by: admin.userId,
    },
    { onConflict: "company_id,year,category_code,setor_id" },
  );
  if (atribErr) {
    if (isSchemaMissing(atribErr.message)) return { needsMigration: true };
    return { error: atribErr.message };
  }

  let query = supabase
    .from(TABELA[metodo])
    .update({ setor_id: destinoSetorId, updated_by: admin.userId })
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("category_code", categoryCode);
  query = linhaId ? query.eq("id", linhaId) : query.eq("setor_id", origemSetorId);

  const { data: movidas, error } = await query.select("company_id");
  if (error) {
    if (isSchemaMissing(error.message)) return { needsMigration: true };
    // Colisão com a chave única: a categoria já tem linha no setor de destino.
    if (/duplicate key|unique/i.test(error.message)) {
      return {
        error:
          "O setor de destino já tem orçamento desta categoria. Apague um dos dois antes de mover.",
      };
    }
    return { error: error.message };
  }

  // O planejamento guarda os ITENS numa tabela à parte — eles seguem a linha.
  if (metodo === "planejamento_socios" && !linhaId) {
    const { error: itensErr } = await supabase
      .from("orcamento_planejamento_socios_itens")
      .update({ setor_id: destinoSetorId, updated_by: admin.userId })
      .eq("company_id", companyId)
      .eq("year", year)
      .eq("category_code", categoryCode)
      .eq("setor_id", origemSetorId);
    if (itensErr) return { error: itensErr.message };
  }

  revalidatePath(PATH);
  return { ok: true as const, movidas: (movidas ?? []).length };
}
