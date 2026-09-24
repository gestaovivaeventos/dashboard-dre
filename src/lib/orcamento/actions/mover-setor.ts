"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { registrarAlteracao } from "@/lib/orcamento/actions/trilha";
import {
  autorizarEscrita,
  podeEscreverNoSetor,
  SEM_ACESSO_SETOR,
} from "@/lib/orcamento/auth";
import { isSchemaMissing } from "@/lib/orcamento/errors";
import { isValidBudgetYear } from "@/lib/orcamento/years";
import { isTodosSetores } from "@/lib/orcamento/setor-filtro";

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
  // Modelo novo (23/09/2026): a despesa do Planejamento é linha própria.
  planejamento_socios: "orcamento_planejamento_despesas",
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
  const { companyId, year, metodo, categoryCode, origemSetorId, destinoSetorId, linhaId } = params;
  if (!companyId || !categoryCode) return { error: "Categoria inválida." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };
  if (!destinoSetorId) return { error: "Escolha o setor de destino." };
  if (!origemSetorId || isTodosSetores(origemSetorId)) {
    return {
      error:
        "Não dá para mover a partir de \"Todos os setores\" — abra o setor de origem e mova de lá.",
    };
  }
  if (destinoSetorId === origemSetorId) return { ok: true as const, movidas: 0 };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());
  const auth = await autorizarEscrita(supabase, companyId, year);
  if (!auth.ok) return { error: auth.error };
  const admin = { userId: auth.user.userId };
  // Mover é escrita nos DOIS lados: tirar da origem e pôr no destino. Conferir
  // só um deles deixaria um gerente empurrar despesa para o setor do colega —
  // ou puxar a dele para si.
  if (
    !podeEscreverNoSetor(auth.setores, origemSetorId) ||
    !podeEscreverNoSetor(auth.setores, destinoSetorId)
  ) {
    return { error: SEM_ACESSO_SETOR };
  }

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

  // O Planejamento tem duas tabelas satélites por categoria × setor: a BASE do
  // ano anterior e a ENTREVISTA (conversa + justificativa). Elas seguem as
  // despesas, senão o setor de destino fica com orçamento sem o histórico que o
  // explica, e a origem guarda uma conversa órfã.
  if (metodo === "planejamento_socios" && !linhaId) {
    const { error: baseErr } = await supabase
      .from("orcamento_planejamento_base")
      .update({ setor_id: destinoSetorId, updated_by: admin.userId })
      .eq("company_id", companyId)
      .eq("year", year)
      .eq("category_code", categoryCode)
      .eq("setor_id", origemSetorId);
    if (baseErr) return { error: baseErr.message };

    // A entrevista é UMA por categoria × setor (índice único). Se o destino já
    // tem a dele, a da origem fica onde está: sobrescrever apagaria uma
    // conversa real, e duas linhas dariam 23505 no meio da movimentação.
    const { data: destinoJaTem } = await supabase
      .from("orcamento_planejamento_entrevistas")
      .select("id")
      .eq("company_id", companyId)
      .eq("year", year)
      .eq("category_code", categoryCode)
      .eq("setor_id", destinoSetorId)
      .maybeSingle();
    if (!destinoJaTem) {
      const { error: entrevErr } = await supabase
        .from("orcamento_planejamento_entrevistas")
        .update({ setor_id: destinoSetorId, updated_by: admin.userId })
        .eq("company_id", companyId)
        .eq("year", year)
        .eq("category_code", categoryCode)
        .eq("setor_id", origemSetorId);
      if (entrevErr) return { error: entrevErr.message };
    }
  }

  // Se não sobrou NENHUMA linha da categoria no setor de origem, a atribuição
  // dele também sai. Sem isso a categoria continua listada na origem — e como
  // a tela mostra a sugestão viva do realizado quando não há valor salvo, a
  // despesa parece continuar lá, agora nos dois setores.
  if (origemSetorId) {
    let sobrou = false;
    for (const tabela of Object.values(TABELA)) {
      const { count } = await supabase
        .from(tabela)
        .select("company_id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .eq("year", year)
        .eq("category_code", categoryCode)
        .eq("setor_id", origemSetorId);
      if ((count ?? 0) > 0) {
        sobrou = true;
        break;
      }
    }
    if (!sobrou) {
      const { error: limpaErr } = await supabase
        .from("orcamento_categoria_setores")
        .delete()
        .eq("company_id", companyId)
        .eq("year", year)
        .eq("category_code", categoryCode)
        .eq("setor_id", origemSetorId);
      if (limpaErr) return { error: limpaErr.message };
    }
  }

  revalidatePath(PATH);
  return { ok: true as const, movidas: (movidas ?? []).length };
}

/**
 * Tira uma categoria de um setor: apaga a linha de orçamento e a atribuição.
 *
 * Serve para o resíduo da migração — a categoria ficou atribuída a dois setores
 * e ganhou linha nos dois, mostrando o mesmo valor duas vezes. Também é a saída
 * quando "Mover" recusa porque o destino já tem orçamento daquela categoria.
 *
 * Apaga DADO de orçamento, então a tela confirma antes.
 */
export async function removerLinhaDoSetor(params: {
  companyId: string;
  year: number;
  metodo: MetodoComSetor;
  categoryCode: string;
  setorId: string;
}) {
  const { companyId, year, metodo, categoryCode, setorId } = params;
  if (!companyId || !categoryCode || !setorId) return { error: "Dados inválidos." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());
  const auth = await autorizarEscrita(supabase, companyId, year);
  if (!auth.ok) return { error: auth.error };
  if (!podeEscreverNoSetor(auth.setores, setorId)) return { error: SEM_ACESSO_SETOR };

  const { error } = await supabase
    .from(TABELA[metodo])
    .delete()
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("category_code", categoryCode)
    .eq("setor_id", setorId);
  if (error) {
    if (isSchemaMissing(error.message)) return { needsMigration: true };
    return { error: error.message };
  }

  // A base e a entrevista daquela categoria × setor vão junto: sem a despesa
  // elas não descrevem orçamento nenhum, e a base reaparecendo numa semeadura
  // futura confundiria a curadoria.
  if (metodo === "planejamento_socios") {
    for (const satelite of [
      "orcamento_planejamento_base",
      "orcamento_planejamento_entrevistas",
    ] as const) {
      const { error: satErr } = await supabase
        .from(satelite)
        .delete()
        .eq("company_id", companyId)
        .eq("year", year)
        .eq("category_code", categoryCode)
        .eq("setor_id", setorId);
      if (satErr) return { error: satErr.message };
    }
  }

  // Sem linha em nenhum método, a categoria sai do setor — senão ela continua
  // listada e a próxima recalculada recria a linha.
  let sobrou = false;
  for (const tabela of Object.values(TABELA)) {
    const { count } = await supabase
      .from(tabela)
      .select("company_id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("year", year)
      .eq("category_code", categoryCode)
      .eq("setor_id", setorId);
    if ((count ?? 0) > 0) {
      sobrou = true;
      break;
    }
  }
  if (!sobrou) {
    const { error: limpaErr } = await supabase
      .from("orcamento_categoria_setores")
      .delete()
      .eq("company_id", companyId)
      .eq("year", year)
      .eq("category_code", categoryCode)
      .eq("setor_id", setorId);
    if (limpaErr) return { error: limpaErr.message };
  }

  await registrarAlteracao({
    companyId,
    year,
    cicloId: auth.cicloId,
    categoryCode,
    setorId,
    metodo,
    alvoTipo: "categoria_setor",
    alvoRotulo: categoryCode,
    acao: "excluiu",
    fase: auth.fase,
    autorId: auth.user.userId,
    autorPapel: auth.user.papel,
  });
  revalidatePath(PATH);
  return { ok: true as const };
}
