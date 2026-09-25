"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import {
  getOrcamentoAdmin,
  getOrcamentoUser,
  podeVerEmpresa,
  SEM_ACESSO,
  SEM_ACESSO_ADMIN,
} from "@/lib/orcamento/auth";
import { friendlyGrupoError, isSchemaMissing } from "@/lib/orcamento/errors";
import { isValidBudgetYear } from "@/lib/orcamento/years";
import { orcaPorSetor } from "@/lib/orcamento/setor-gravacao";
import { getCategoriaMetodo } from "@/lib/orcamento/actions/categoria-metodo";
import { compararNomes, normalizarNomeGrupo, type EscopoGrupo } from "@/lib/orcamento/grupos";
import type { OrcamentoMetodo } from "@/lib/orcamento/metodos";

// =============================================================================
// Cadastro dos GRUPOS DE DESPESA em árvore: empresa → setor → categoria →
// grupos. Vive nas Configurações gerais do módulo, onde o admin escolhe a
// empresa — as configs por empresa ficam no workspace dela, mas esta é a única
// que se navega por setor E categoria ao mesmo tempo, e a árvore só faz sentido
// com a empresa como filtro de topo.
//
// O GRUPO continua sendo um registro por empresa (o nome, em
// `orcamento_grupos_despesa`); o que a árvore edita é ONDE ele vale
// (`orcamento_grupo_escopo`). Ver a migration 20260927120000: é isso que
// permite "Publicidade" servir a cinco setores e continuar UM grupo na hora de
// somar — a Prévia agrupa por id.
// =============================================================================

const PATH = "/orcamento";

export interface ArvoreGrupo {
  id: string;
  name: string;
  active: boolean;
}

/** Uma categoria dentro de um setor, com os grupos presos a ela. */
export interface ArvoreCategoria {
  categoryCode: string;
  categoryName: string;
  /**
   * Método de orçamento da categoria (null = nenhum escolhido). NÃO filtra a
   * árvore — é informação: só o Planejamento dos gestores usa grupo hoje, e sem
   * este rótulo o admin cadastraria grupos que nunca chegam à entrevista sem
   * entender por quê.
   */
  metodo: OrcamentoMetodo | null;
  grupos: ArvoreGrupo[];
}

export interface ArvoreSetor {
  /** Nulo = empresa que não orça por setor (nó único). */
  setorId: string | null;
  setorNome: string;
  categorias: ArvoreCategoria[];
}

export interface GruposArvore {
  orcaPorSetor: boolean;
  setores: ArvoreSetor[];
  /** Catálogo da empresa, para reaproveitar um nome já existente num nó novo. */
  catalogo: ArvoreGrupo[];
  /** Grupos do catálogo que não estão presos a lugar nenhum — valem em todos. */
  amplos: ArvoreGrupo[];
}

/**
 * Monta a árvore do cadastro.
 *
 * TODO setor recebe TODAS as categorias de despesa da empresa — sem filtrar por
 * método nem pela atribuição `orcamento_categoria_setores` (decisão do dono do
 * projeto em 24/09/2026). Os dois filtros existiam e foram tirados de
 * propósito: o cadastro de grupo é trabalho de estrutura, feito ANTES de se
 * decidir o método e a distribuição por setor, e a árvore incompleta obrigava a
 * voltar aqui a cada categoria que mudasse de método ou ganhasse um setor novo.
 *
 * Consequência: a árvore fica grande (todas as categorias × todos os setores).
 * A tela tem busca por isso — não a remova achando que é en+feite.
 */
export async function getGruposArvore(
  companyId: string,
  year: number,
): Promise<{ data?: GruposArvore; error?: string; needsMigration?: boolean }> {
  const user = await getOrcamentoUser();
  if (!user) return { error: SEM_ACESSO };
  if (!companyId) return { error: "Selecione uma empresa." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };
  if (!podeVerEmpresa(user, companyId)) return { error: SEM_ACESSO };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());

  const cats = await getCategoriaMetodo(companyId, year);
  if (cats.needsMigration) return { needsMigration: true };
  if (cats.error) return { error: cats.error };
  // Todas as categorias de despesa da empresa, em qualquer método.
  const todasCategorias = cats.items ?? [];

  const [{ data: catalogoRows, error: catErr }, { data: escopoRows, error: escErr }] =
    await Promise.all([
      supabase
        .from("orcamento_grupos_despesa")
        .select("id, name, active")
        .eq("company_id", companyId),
      supabase
        .from("orcamento_grupo_escopo")
        .select("grupo_id, setor_id, category_code")
        .eq("company_id", companyId)
        .eq("year", year),
    ]);
  if (catErr) {
    if (isSchemaMissing(catErr.message)) return { needsMigration: true };
    return { error: catErr.message };
  }
  if (escErr) {
    if (isSchemaMissing(escErr.message)) return { needsMigration: true };
    return { error: escErr.message };
  }

  const catalogo: ArvoreGrupo[] = (catalogoRows ?? [])
    .map((r) => ({ id: r.id as string, name: r.name as string, active: Boolean(r.active) }))
    .sort((a, b) => compararNomes(a.name, b.name));
  const porId = new Map(catalogo.map((g) => [g.id, g]));

  const escopos: EscopoGrupo[] = (escopoRows ?? []).map((r) => ({
    grupoId: r.grupo_id as string,
    setorId: (r.setor_id as string | null) ?? null,
    categoryCode: r.category_code as string,
  }));
  const comEscopo = new Set(escopos.map((e) => e.grupoId));
  const amplos = catalogo.filter((g) => !comEscopo.has(g.id));

  const porSetor = await orcaPorSetor(supabase, companyId, year);

  /** Categorias de um nó, com os grupos presos àquele (setor, categoria). */
  const categoriasDoSetor = (setorId: string | null): ArvoreCategoria[] =>
    todasCategorias.map((c) => ({
      categoryCode: c.categoryCode,
      categoryName: c.categoryName,
      metodo: c.metodo,
      grupos: escopos
        .filter((e) => e.categoryCode === c.categoryCode && e.setorId === setorId)
        .map((e) => porId.get(e.grupoId))
        .filter((g): g is ArvoreGrupo => Boolean(g))
        .sort((a, b) => compararNomes(a.name, b.name)),
    }));

  let nos: ArvoreSetor[] = [];
  if (porSetor) {
    const { data: setoresRows } = await supabase
      .from("orcamento_setores")
      .select("id, name")
      .eq("company_id", companyId)
      .eq("year", year)
      .eq("active", true)
      .order("name");
    nos = (setoresRows ?? []).map((sRow) => ({
      setorId: sRow.id as string,
      setorNome: sRow.name as string,
      categorias: categoriasDoSetor(sRow.id as string),
    }));
  } else {
    nos = [{ setorId: null, setorNome: "", categorias: categoriasDoSetor(null) }];
  }

  return { data: { orcaPorSetor: porSetor, setores: nos, catalogo, amplos } };
}

/**
 * Acrescenta um grupo a um nó da árvore (setor × categoria).
 *
 * O nome é procurado no catálogo da empresa antes de criar: reaproveitar o
 * MESMO registro é o que faz "Publicidade" continuar um só grupo quando vale em
 * vários setores — e é disso que depende a Prévia compilar em vez de mostrar o
 * subnível repetido.
 */
export async function adicionarGrupoNoNo(params: {
  companyId: string;
  year: number;
  setorId: string | null;
  categoryCode: string;
  nome: string;
}): Promise<{ ok?: true; error?: string; needsMigration?: boolean }> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: SEM_ACESSO_ADMIN };
  const { companyId, year, setorId, categoryCode } = params;
  if (!companyId || !categoryCode) return { error: "Categoria inválida." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };
  const nome = normalizarNomeGrupo(params.nome);
  if (!nome) return { error: "Informe o nome do grupo." };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());

  const { data: existente, error: buscaErr } = await supabase
    .from("orcamento_grupos_despesa")
    .select("id")
    .eq("company_id", companyId)
    .ilike("name", nome)
    .maybeSingle();
  if (buscaErr && !isSchemaMissing(buscaErr.message)) return { error: buscaErr.message };

  let grupoId = (existente?.id as string | undefined) ?? undefined;
  if (!grupoId) {
    const { data: criado, error: insErr } = await supabase
      .from("orcamento_grupos_despesa")
      .insert({ company_id: companyId, name: nome, updated_by: admin.userId })
      .select("id")
      .maybeSingle();
    if (insErr) {
      if (isSchemaMissing(insErr.message)) return { needsMigration: true };
      return { error: friendlyGrupoError(insErr.message) };
    }
    grupoId = criado?.id as string;
  }
  if (!grupoId) return { error: "Não consegui criar o grupo." };

  const { error: escErr } = await supabase.from("orcamento_grupo_escopo").insert({
    grupo_id: grupoId,
    company_id: companyId,
    year,
    setor_id: setorId,
    category_code: categoryCode,
    updated_by: admin.userId,
  });
  // 23505 = já estava neste nó. Não é erro para quem clicou: o estado desejado
  // já é o que está no banco.
  if (escErr && !/duplicate key|unique/i.test(escErr.message)) {
    if (isSchemaMissing(escErr.message)) return { needsMigration: true };
    return { error: escErr.message };
  }

  revalidatePath(PATH);
  return { ok: true };
}

/**
 * Tira o grupo de UM nó. O grupo em si continua no catálogo — ele pode estar
 * valendo em outros setores, e apagá-lo levaria junto as despesas que o
 * apontam (a FK é RESTRICT, então nem daria).
 */
export async function removerGrupoDoNo(params: {
  companyId: string;
  year: number;
  setorId: string | null;
  categoryCode: string;
  grupoId: string;
}): Promise<{ ok?: true; error?: string }> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: SEM_ACESSO_ADMIN };
  const { companyId, year, setorId, categoryCode, grupoId } = params;
  if (!grupoId) return { error: "Grupo inválido." };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());
  let q = supabase
    .from("orcamento_grupo_escopo")
    .delete()
    .eq("grupo_id", grupoId)
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("category_code", categoryCode);
  q = setorId ? q.eq("setor_id", setorId) : q.is("setor_id", null);
  const { error } = await q;
  if (error) return { error: error.message };

  revalidatePath(PATH);
  return { ok: true };
}

/**
 * Copia os grupos de um nó para outros setores, na MESMA categoria.
 *
 * Existe porque o caso comum é "Marketing tem os mesmos grupos em todos os
 * setores": sem isto, o admin repetiria o cadastro setor a setor. Reusa os
 * mesmos ids, então continua tudo compilando como um grupo só.
 */
export async function replicarGruposDoNo(params: {
  companyId: string;
  year: number;
  origemSetorId: string | null;
  categoryCode: string;
  destinoSetorIds: string[];
}): Promise<{ ok?: true; copiados?: number; error?: string }> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: SEM_ACESSO_ADMIN };
  const { companyId, year, origemSetorId, categoryCode, destinoSetorIds } = params;
  if (destinoSetorIds.length === 0) return { ok: true, copiados: 0 };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());
  let q = supabase
    .from("orcamento_grupo_escopo")
    .select("grupo_id")
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("category_code", categoryCode);
  q = origemSetorId ? q.eq("setor_id", origemSetorId) : q.is("setor_id", null);
  const { data: origem, error: lerErr } = await q;
  if (lerErr) return { error: lerErr.message };
  if (!origem || origem.length === 0) return { ok: true, copiados: 0 };

  const linhas = destinoSetorIds.flatMap((setorId) =>
    origem.map((o) => ({
      grupo_id: o.grupo_id as string,
      company_id: companyId,
      year,
      setor_id: setorId,
      category_code: categoryCode,
      updated_by: admin.userId,
    })),
  );
  // Ignora o que já existe no destino: replicar duas vezes não pode falhar.
  const { error } = await supabase
    .from("orcamento_grupo_escopo")
    .upsert(linhas, { ignoreDuplicates: true });
  if (error) return { error: error.message };

  revalidatePath(PATH);
  return { ok: true, copiados: linhas.length };
}
