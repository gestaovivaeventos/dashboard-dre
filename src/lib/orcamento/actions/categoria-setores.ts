"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { getOrcamentoAdmin } from "@/lib/orcamento/auth";
import { isSchemaMissing } from "@/lib/orcamento/errors";
import { isValidBudgetYear } from "@/lib/orcamento/years";

// =============================================================================
// Quais SETORES participam de cada categoria (Fase 1 do orçamento por setor).
//
// O modelo é: a CATEGORIA tem N setores; cada DESPESA tem UM setor. "Marketing"
// pode ser orçado pelo Comercial e pelo Produto, mas cada item dentro dela
// pertence a um setor só.
//
// Sem esta atribuição, toda categoria × todo setor viraria uma linha de
// orçamento (20 categorias × 8 setores = 160 cards vazios). Aqui o admin diz
// quais combinações existem de verdade, e só elas aparecem nas telas de método.
// =============================================================================

const PATH = "/orcamento/configuracoes/categoria-metodo";

const ERRO_MEDIA_UM_SETOR =
  "Categoria orçada por média pertence a um setor só — a média sai do realizado da " +
  "categoria inteira, e dois setores contariam a mesma despesa duas vezes.";

/** Setores atribuídos a cada categoria, indexado pelo código da categoria. */
export type SetoresPorCategoria = Record<string, string[]>;

function db() {
  return createAdminClientIfAvailable();
}

/** Lê a atribuição inteira da empresa/ano de uma vez (a tela mostra todas as
 * categorias juntas, então N consultas não fariam sentido). */
export async function getCategoriaSetores(
  companyId: string,
  year: number,
): Promise<{ mapa?: SetoresPorCategoria; error?: string; needsMigration?: boolean }> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!companyId) return { mapa: {} };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const supabase = db() ?? (await createClient());
  const { data, error } = await supabase
    .from("orcamento_categoria_setores")
    .select("category_code, setor_id")
    .eq("company_id", companyId)
    .eq("year", year);
  if (error) {
    if (isSchemaMissing(error.message)) return { needsMigration: true };
    return { error: error.message };
  }

  const mapa: SetoresPorCategoria = {};
  for (const r of data ?? []) {
    const code = r.category_code as string;
    (mapa[code] ??= []).push(r.setor_id as string);
  }
  return { mapa };
}

/**
 * Define os setores de UMA categoria (substitui a lista inteira).
 *
 * Tirar um setor que já tem orçamento gravado deixaria a linha órfã — visível
 * na Prévia mas sem card onde editar. Por isso a remoção é BLOQUEADA quando há
 * valor lançado: a mensagem diz qual método segura, e o admin decide se apaga o
 * orçamento antes ou mantém o setor.
 */
export async function setCategoriaSetores(
  companyId: string,
  year: number,
  categoryCode: string,
  setorIds: string[],
) {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!companyId) return { error: "Selecione uma empresa." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };
  if (!categoryCode) return { error: "Categoria inválida." };

  const supabase = db() ?? (await createClient());
  const desejados = Array.from(new Set(setorIds.filter(Boolean)));

  // MEDIA aceita UM setor so. O valor dela vem do realizado da categoria
  // inteira - dois setores calculariam a mesma media e o orcamento contaria a
  // despesa duas vezes. Planejamento e valor fixo nao tem esse problema: la
  // cada item/contrato e uma despesa distinta, com o seu proprio setor.
  if (desejados.length > 1) {
    const { data: metodoRow } = await supabase
      .from("orcamento_categoria_metodo")
      .select("metodo")
      .eq("company_id", companyId)
      .eq("year", year)
      .eq("category_code", categoryCode)
      .maybeSingle();
    if (metodoRow?.metodo === "media") {
      return {
        error: ERRO_MEDIA_UM_SETOR,
      };
    }
  }

  const { data: atuaisRows, error: atuaisErr } = await supabase
    .from("orcamento_categoria_setores")
    .select("setor_id")
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("category_code", categoryCode);
  if (atuaisErr) {
    if (isSchemaMissing(atuaisErr.message)) return { needsMigration: true };
    return { error: atuaisErr.message };
  }
  const atuais = (atuaisRows ?? []).map((r) => r.setor_id as string);
  const remover = atuais.filter((id) => !desejados.includes(id));
  const incluir = desejados.filter((id) => !atuais.includes(id));

  // Trava: setor com orçamento lançado não pode ser desatribuído.
  if (remover.length > 0) {
    const emUso: string[] = [];
    for (const [tabela, rotulo] of [
      ["orcamento_media_categorias", "Média com correção"],
      ["orcamento_valor_fixo_categorias", "Valor fixo com correção"],
      ["orcamento_planejamento_socios", "Planejamento dos gestores"],
    ] as const) {
      const { data: usados } = await supabase
        .from(tabela)
        .select("setor_id")
        .eq("company_id", companyId)
        .eq("year", year)
        .eq("category_code", categoryCode)
        .in("setor_id", remover);
      if ((usados ?? []).length > 0 && !emUso.includes(rotulo)) emUso.push(rotulo);
    }
    if (emUso.length > 0) {
      return {
        error:
          `Este setor já tem orçamento lançado nesta categoria (${emUso.join(", ")}). ` +
          "Apague o valor antes de tirar o setor da categoria.",
      };
    }

    const { error: delErr } = await supabase
      .from("orcamento_categoria_setores")
      .delete()
      .eq("company_id", companyId)
      .eq("year", year)
      .eq("category_code", categoryCode)
      .in("setor_id", remover);
    if (delErr) return { error: delErr.message };
  }

  if (incluir.length > 0) {
    const { error: insErr } = await supabase.from("orcamento_categoria_setores").insert(
      incluir.map((setorId) => ({
        company_id: companyId,
        year,
        category_code: categoryCode,
        setor_id: setorId,
        updated_by: admin.userId,
      })),
    );
    if (insErr) return { error: insErr.message };
  }

  revalidatePath(PATH);
  return { ok: true as const };
}

/** Quantas linhas de orçamento ainda estão no setor "Não atribuído" — a dívida
 * deixada pela migração da Fase 1, que a tela mostra até zerar. */
export async function contarNaoAtribuido(
  companyId: string,
  year: number,
): Promise<{ total?: number; setorId?: string | null; error?: string }> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!companyId || !isValidBudgetYear(year)) return { total: 0, setorId: null };

  const supabase = db() ?? (await createClient());
  const { data: setor } = await supabase
    .from("orcamento_setores")
    .select("id")
    .eq("company_id", companyId)
    .eq("year", year)
    .ilike("name", "Não atribuído")
    .maybeSingle();
  if (!setor) return { total: 0, setorId: null };

  const setorId = setor.id as string;
  let total = 0;
  for (const tabela of [
    "orcamento_media_categorias",
    "orcamento_valor_fixo_categorias",
    "orcamento_planejamento_socios",
  ] as const) {
    const { count } = await supabase
      .from(tabela)
      .select("company_id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("year", year)
      .eq("setor_id", setorId);
    total += count ?? 0;
  }
  return { total, setorId };
}
