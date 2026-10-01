"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import {
  SEM_ACESSO_ADMIN,
  autorizarLeitura,
  getOrcamentoAdmin,
} from "@/lib/orcamento/auth";
import { isSchemaMissing } from "@/lib/orcamento/errors";
import { isValidBudgetYear } from "@/lib/orcamento/years";
import { metodoLabel, type OrcamentoMetodo } from "@/lib/orcamento/metodos";
import { getCategoriasOrcamento } from "@/lib/orcamento/actions/categoria-metodo";
import { textoDaLinha as texto } from "@/lib/viagens/colunas";
import { desalinhadas, tiposQueDobram, type TipoViagem } from "@/lib/viagens/tipos";

// =============================================================================
// O de-para TIPO DE VIAGEM → categoria da DRE.
//
// Cadastro do ADMIN, por empresa × ano — mesmo enquadramento dos parâmetros de
// viagem, dos encargos e do plano de cargos: quem pede a viagem fala em
// "implantação numa unidade nova"; qual conta da DRE isso é não é decisão dele.
//
// ── Ler é de todo mundo, escrever é do admin ──────────────────────────────
// O cadastro da viagem precisa LER os tipos para oferecê-los, então a leitura
// segue o alcance de empresa do módulo. A escrita é admin-only.
// =============================================================================

const PATH = "/orcamento";

type Supa = Awaited<ReturnType<typeof createClient>>;

function db() {
  return createAdminClientIfAvailable();
}

export interface TipoViagemLinha extends TipoViagem {
  /** Nome da categoria no cadastro, para a tela não mostrar só o código. */
  categoryName: string | null;
  /**
   * Método declarado da categoria apontada, se houver. Viagens é ADITIVA: ela
   * soma na conta onde cai. Com `planejamento_socios` os dois somam (pedido); com
   * `media`/`valor_fixo` dobraria, e a tela avisa.
   */
  metodoDaCategoria: string | null;
  /** Quantas viagens deste tipo já foram orçadas (em qualquer categoria). */
  viagens: number;
}

export interface TiposViagemSetup {
  items: TipoViagemLinha[];
  /** Categorias de despesa da empresa, para o seletor do de-para. */
  categorias: Array<{ categoryCode: string; categoryName: string; metodo: string | null }>;
  /** Tipos cuja categoria já é PROJETADA por outro método — somar ali dobraria. */
  conflitos: Array<{ tipo: string; metodo: string }>;
  /** Viagens que ficaram com o mapeamento ANTIGO (ver `desalinhadas`). */
  desalinhadas: Array<{ id: string; titulo: string; tipoNome: string }>;
  isAdmin: boolean;
  error?: string;
  needsMigration?: boolean;
}

const VAZIO: TiposViagemSetup = {
  items: [],
  categorias: [],
  conflitos: [],
  desalinhadas: [],
  isAdmin: false,
};

function linhaParaTipo(r: Record<string, unknown>): TipoViagem {
  return {
    id: r.id as string,
    nome: texto(r.nome),
    categoryCode: texto(r.category_code) || null,
    ativo: r.ativo !== false,
  };
}

/** Os tipos da empresa × ano, com o diagnóstico que a tela de de-para mostra. */
export async function getTiposViagem(
  companyId: string,
  year: number,
): Promise<TiposViagemSetup> {
  if (!companyId) return VAZIO;
  if (!isValidBudgetYear(year)) return { ...VAZIO, error: "Ano do orçamento inválido." };

  const supabase = (db() ?? (await createClient())) as Supa;
  const auth = await autorizarLeitura(supabase, companyId, year);
  if (!auth.ok) return { ...VAZIO, error: auth.error };

  const { data, error } = await supabase
    .from("orcamento_viagem_tipos")
    .select("id, nome, category_code, ativo")
    .eq("company_id", companyId)
    .eq("year", year);
  if (error) {
    if (isSchemaMissing(error.message)) return { ...VAZIO, needsMigration: true };
    return { ...VAZIO, error: error.message };
  }
  const tipos = ((data ?? []) as Array<Record<string, unknown>>).map(linhaParaTipo);

  const [cats, metodoRes, viagensRes] = await Promise.all([
    getCategoriasOrcamento(companyId, year),
    supabase
      .from("orcamento_categoria_metodo")
      .select("category_code, metodo")
      .eq("company_id", companyId)
      .eq("year", year),
    supabase
      .from("orcamento_viagens")
      .select("id, titulo, tipo_id, category_code")
      .eq("company_id", companyId)
      .eq("year", year),
  ]);

  const metodoPorCodigo = new Map(
    ((metodoRes.data ?? []) as Array<Record<string, unknown>>).map(
      (r) => [r.category_code as string, r.metodo as string] as const,
    ),
  );
  const nomePorCodigo = new Map(
    (cats.items ?? []).map((c) => [c.categoryCode, c.categoryName] as const),
  );

  const viagens = ((viagensRes.data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    titulo: texto(r.titulo) || "Viagem sem título",
    tipoId: (r.tipo_id as string | null) ?? null,
    categoryCode: texto(r.category_code) || null,
  }));
  const porTipo = new Map<string, number>();
  for (const v of viagens) {
    if (!v.tipoId) continue;
    porTipo.set(v.tipoId, (porTipo.get(v.tipoId) ?? 0) + 1);
  }

  const items: TipoViagemLinha[] = tipos.map((t) => ({
    ...t,
    categoryName: t.categoryCode ? nomePorCodigo.get(t.categoryCode) ?? null : null,
    metodoDaCategoria: t.categoryCode ? metodoPorCodigo.get(t.categoryCode) ?? null : null,
    viagens: porTipo.get(t.id) ?? 0,
  }));

  return {
    items,
    categorias: (cats.items ?? []).map((c) => ({
      categoryCode: c.categoryCode,
      categoryName: c.categoryName,
      metodo: metodoPorCodigo.get(c.categoryCode) ?? null,
    })),
    conflitos: tiposQueDobram(tipos, metodoPorCodigo).map((c) => ({
      tipo: c.tipo.nome,
      metodo: metodoLabel(c.metodo as OrcamentoMetodo),
    })),
    desalinhadas: desalinhadas(viagens, tipos).map((d) => ({
      id: d.id,
      titulo: d.titulo,
      tipoNome: d.tipoNome,
    })),
    isAdmin: auth.user.isAdmin,
  };
}

/** Cria um tipo. A categoria pode vir vazia — mapear depois é caminho legítimo. */
export async function criarTipoViagem(
  companyId: string,
  year: number,
  input: { nome: string; categoryCode?: string | null },
): Promise<{ id?: string; error?: string; needsMigration?: boolean }> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: SEM_ACESSO_ADMIN };
  if (!companyId) return { error: "Empresa inválida." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };
  if (!texto(input.nome)) return { error: "Dê um nome ao tipo de viagem." };

  const supabase = (db() ?? (await createClient())) as Supa;
  const { data, error } = await supabase
    .from("orcamento_viagem_tipos")
    .insert({
      company_id: companyId,
      year,
      nome: texto(input.nome),
      category_code: texto(input.categoryCode) || null,
      updated_by: admin.userId,
    })
    .select("id")
    .maybeSingle();
  if (error) {
    if (isSchemaMissing(error.message)) return { needsMigration: true };
    // O índice único é por EXPRESSÃO (lower(btrim(nome))): 23505 aqui é nome
    // repetido, inclusive com outra caixa ou espaço sobrando.
    if (error.code === "23505") return { error: "Já existe um tipo com esse nome." };
    return { error: error.message };
  }
  revalidatePath(PATH);
  return { id: (data?.id as string) ?? undefined };
}

/**
 * Altera nome, categoria e ativo.
 *
 * Remapear a categoria NÃO reclassifica as viagens já orçadas: elas carregam o
 * retrato da categoria em que foram orçadas (ver a migration e `desalinhadas`).
 * A tela mostra quantas ficaram atrás; passar a usar o mapeamento novo é abrir a
 * viagem e salvar.
 */
export async function salvarTipoViagem(
  companyId: string,
  year: number,
  tipoId: string,
  input: { nome?: string; categoryCode?: string | null; ativo?: boolean },
): Promise<{ ok?: true; error?: string }> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: SEM_ACESSO_ADMIN };
  if (!tipoId) return { error: "Tipo inválido." };

  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    updated_by: admin.userId,
  };
  if (input.nome !== undefined) {
    if (!texto(input.nome)) return { error: "O nome do tipo não pode ficar vazio." };
    patch.nome = texto(input.nome);
  }
  // `null` explícito DESMAPEIA (o tipo deixa de ser oferecido). Diferente de
  // `undefined`, que é "não mexi neste campo".
  if (input.categoryCode !== undefined) {
    patch.category_code = texto(input.categoryCode) || null;
  }
  if (input.ativo !== undefined) patch.ativo = input.ativo;

  const supabase = (db() ?? (await createClient())) as Supa;
  const { error } = await supabase
    .from("orcamento_viagem_tipos")
    .update(patch)
    .eq("id", tipoId)
    .eq("company_id", companyId)
    .eq("year", year);
  if (error) {
    if (error.code === "23505") return { error: "Já existe um tipo com esse nome." };
    return { error: error.message };
  }
  revalidatePath(PATH);
  return { ok: true };
}

/**
 * Exclui um tipo.
 *
 * Com viagem apontando para ele, recusa e manda DESATIVAR: a exclusão deixaria a
 * viagem sem tipo (`ON DELETE SET NULL`) conservando a categoria, e ninguém
 * conseguiria mais dizer de que tipo ela era. Desativar para de oferecer sem
 * apagar história — a mesma escolha de "cancelar é marca, nunca exclusão".
 */
export async function removerTipoViagem(
  companyId: string,
  year: number,
  tipoId: string,
): Promise<{ ok?: true; error?: string }> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: SEM_ACESSO_ADMIN };
  if (!tipoId) return { error: "Tipo inválido." };

  const supabase = (db() ?? (await createClient())) as Supa;
  const { count } = await supabase
    .from("orcamento_viagens")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("tipo_id", tipoId);
  if ((count ?? 0) > 0) {
    return {
      error: `Há ${count} viagem(ns) deste tipo. Desative-o em vez de excluir — assim ele para de ser oferecido sem apagar de que tipo essas viagens eram.`,
    };
  }

  const { error } = await supabase
    .from("orcamento_viagem_tipos")
    .delete()
    .eq("id", tipoId)
    .eq("company_id", companyId)
    .eq("year", year);
  if (error) return { error: error.message };
  revalidatePath(PATH);
  return { ok: true };
}
