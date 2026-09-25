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
import { getCategoriasOrcamento } from "@/lib/orcamento/actions/categoria-metodo";
import { compararNomes, normalizarNomeGrupo, type EscopoGrupo } from "@/lib/orcamento/grupos";
import type { OrcamentoMetodo } from "@/lib/orcamento/metodos";
import { resolverGrupos } from "@/lib/orcamento/grupos-xlsx";

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

  const cats = await getCategoriasOrcamento(companyId, year);
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

/** Empresa oferecida como origem da cópia (tem algum grupo cadastrado). */
export interface OrigemCopia {
  companyId: string;
  companyName: string;
  grupos: number;
}

/**
 * Empresas que têm grupos cadastrados no ano — as candidatas a origem.
 *
 * Listar empresa vazia seria oferecer uma cópia que não copia nada. A empresa
 * de destino fica de fora da própria lista.
 */
export async function listarOrigensDeCopia(
  destinoCompanyId: string,
  year: number,
): Promise<{ items?: OrigemCopia[]; error?: string }> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: SEM_ACESSO_ADMIN };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());
  const { data, error } = await supabase
    .from("orcamento_grupo_escopo")
    .select("company_id, grupo_id, companies(name)")
    .eq("year", year)
    .neq("company_id", destinoCompanyId);
  if (error) {
    if (isSchemaMissing(error.message)) return { items: [] };
    return { error: error.message };
  }

  const porEmpresa = new Map<string, { nome: string; grupos: Set<string> }>();
  ((data ?? []) as Array<Record<string, unknown>>).forEach((r) => {
    const id = r.company_id as string;
    const nome = (r.companies as { name?: string } | null)?.name ?? "Empresa";
    const atual = porEmpresa.get(id) ?? { nome, grupos: new Set<string>() };
    atual.grupos.add(r.grupo_id as string);
    porEmpresa.set(id, atual);
  });

  return {
    items: Array.from(porEmpresa.entries())
      .map(([companyId, v]) => ({ companyId, companyName: v.nome, grupos: v.grupos.size }))
      .sort((a, b) => compararNomes(a.companyName, b.companyName)),
  };
}

export interface ResultadoCopia {
  /** Vínculos (setor × categoria × grupo) criados no destino. */
  escopos: number;
  /** Nomes de grupo que não existiam no destino e foram criados. */
  criados: number;
  /** O que não deu para copiar, já explicado. */
  problemas: string[];
}

/**
 * Copia os grupos de OUTRA empresa para esta.
 *
 * O que se copia é a ESTRUTURA — quais grupos valem em cada (setor, categoria)
 * —, não registros: o grupo é um nome por empresa, então o destino ganha os
 * seus próprios, reaproveitando os que já tiver com o mesmo nome.
 *
 * O casamento entre empresas é por NOME do setor e por CÓDIGO da categoria, e
 * reusa `resolverGrupos` — o mesmo resolvedor (testado) da importação por
 * planilha, porque o problema é idêntico: nomes de um lado, cadastro do outro.
 * Setor ou categoria que não existe aqui vira uma linha em `problemas`, não um
 * erro do lote: a maior parte costuma casar.
 *
 * ADITIVA: nada do que já existe no destino é apagado, e copiar duas vezes não
 * duplica.
 */
export async function copiarGruposDeEmpresa(params: {
  origemCompanyId: string;
  destinoCompanyId: string;
  year: number;
}): Promise<{ resultado?: ResultadoCopia; error?: string; needsMigration?: boolean }> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: SEM_ACESSO_ADMIN };
  const { origemCompanyId, destinoCompanyId, year } = params;
  if (!origemCompanyId || !destinoCompanyId) return { error: "Escolha a empresa de origem." };
  if (origemCompanyId === destinoCompanyId) {
    return { error: "A origem e o destino são a mesma empresa." };
  }
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());

  // ── O que a origem tem, em NOMES (é o que atravessa a fronteira) ─────────
  const { data: origemRows, error: origemErr } = await supabase
    .from("orcamento_grupo_escopo")
    .select("category_code, orcamento_grupos_despesa(name), orcamento_setores(name)")
    .eq("company_id", origemCompanyId)
    .eq("year", year);
  if (origemErr) {
    if (isSchemaMissing(origemErr.message)) return { needsMigration: true };
    return { error: origemErr.message };
  }
  const linhas = ((origemRows ?? []) as Array<Record<string, unknown>>)
    .map((r, i) => ({
      linha: i + 1,
      setor: (r.orcamento_setores as { name?: string } | null)?.name ?? "",
      categoria: r.category_code as string,
      grupo: (r.orcamento_grupos_despesa as { name?: string } | null)?.name ?? "",
    }))
    .filter((r) => r.grupo);
  if (linhas.length === 0) {
    return {
      resultado: {
        escopos: 0,
        criados: 0,
        problemas: ["A empresa de origem não tem grupos cadastrados neste ano."],
      },
    };
  }

  // ── Cadastro do DESTINO, para casar ──────────────────────────────────────
  const cats = await getCategoriasOrcamento(destinoCompanyId, year);
  if (cats.error) return { error: cats.error };
  const { data: setoresDestino } = await supabase
    .from("orcamento_setores")
    .select("id, name")
    .eq("company_id", destinoCompanyId)
    .eq("year", year)
    .eq("active", true);

  const resolucao = resolverGrupos(
    linhas,
    (setoresDestino ?? []).map((r) => ({ id: r.id as string, name: r.name as string })),
    cats.items ?? [],
  );
  // A mensagem do resolvedor fala em "linha", que aqui não quer dizer nada: a
  // origem é uma tabela, não uma planilha. E o mesmo setor ausente aparece uma
  // vez por escopo — repetir 40 vezes "setor X não existe" não informa mais.
  const problemas = Array.from(
    new Set(resolucao.problemas.map((p) => p.replace(/^Linha \d+: /, ""))),
  );

  if (resolucao.resolvidas.length === 0) {
    return { resultado: { escopos: 0, criados: 0, problemas } };
  }

  // ── Catálogo do destino: reaproveita o nome, cria o que falta ────────────
  const { data: catalogoDestino } = await supabase
    .from("orcamento_grupos_despesa")
    .select("id, name")
    .eq("company_id", destinoCompanyId);
  const chaveNome = (nome: string) =>
    normalizarNomeGrupo(nome).toLocaleLowerCase("pt-BR");
  const porNome = new Map(
    (catalogoDestino ?? []).map((r) => [chaveNome(r.name as string), r.id as string]),
  );

  const novos = new Map<string, string>();
  resolucao.resolvidas.forEach((r) => {
    const nome = normalizarNomeGrupo(r.grupo);
    if (!porNome.has(chaveNome(nome)) && !novos.has(chaveNome(nome))) {
      novos.set(chaveNome(nome), nome);
    }
  });

  let criados = 0;
  if (novos.size > 0) {
    const { data: inseridos, error } = await supabase
      .from("orcamento_grupos_despesa")
      .insert(
        Array.from(novos.values()).map((name) => ({
          company_id: destinoCompanyId,
          name,
          updated_by: admin.userId,
        })),
      )
      .select("id, name");
    if (error) return { error: friendlyGrupoError(error.message) };
    (inseridos ?? []).forEach((r) => porNome.set(chaveNome(r.name as string), r.id as string));
    criados = inseridos?.length ?? 0;
  }

  const escopos = resolucao.resolvidas
    .map((r) => {
      const grupoId = porNome.get(chaveNome(r.grupo));
      if (!grupoId) return null;
      return {
        grupo_id: grupoId,
        company_id: destinoCompanyId,
        year,
        setor_id: r.setorId,
        category_code: r.categoryCode,
        updated_by: admin.userId,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const { error: escErr } = await supabase
    .from("orcamento_grupo_escopo")
    .upsert(escopos, { ignoreDuplicates: true });
  if (escErr) return { error: escErr.message };

  revalidatePath(PATH);
  return { resultado: { escopos: escopos.length, criados, problemas } };
}
