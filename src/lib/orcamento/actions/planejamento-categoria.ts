"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import {
  autorizarEscrita,
  autorizarLeitura,
  getOrcamentoUser,
  podeEscreverNoSetor,
  SEM_ACESSO,
  SEM_ACESSO_ADMIN,
  SEM_ACESSO_SETOR,
} from "@/lib/orcamento/auth";
import { isSchemaMissing } from "@/lib/orcamento/errors";
import { isValidBudgetYear } from "@/lib/orcamento/years";
import { orcaPorSetor, setorParaGravar } from "@/lib/orcamento/setor-gravacao";
import { getCategoriaMetodo } from "@/lib/orcamento/actions/categoria-metodo";
import { registrarAlteracao } from "@/lib/orcamento/actions/trilha";
import { podeEscreverNoItem } from "@/lib/orcamento/validacao";
import {
  codigosIrmaos,
  normNomeCategoria,
  serieItem,
  toPeriodicidade,
  type Periodicidade,
  type PlanejamentoMensagem,
} from "@/lib/orcamento/planejamento-calc";
import {
  combinarRealizados,
  fetchRealizados,
  mesesFechados,
  totalGastoAno,
} from "@/lib/orcamento/media-realizado";
import { agruparPorGrupo } from "@/lib/orcamento/grupos";
import { getPreviaOrcamento } from "@/lib/orcamento/actions/previa-orcamento";
import { SETOR_TODOS } from "@/lib/orcamento/setor-filtro";

// =============================================================================
// Planejamento dos gestores — MONTAGEM de uma categoria.
//
// A tela tem três partes e elas têm donos diferentes:
//
//  1. BASE (admin)   — o que o setor gastou nesta categoria no ano anterior,
//                      semeado da Omie e curado à mão. O gestor só LÊ.
//  2. ENTREVISTA     — a conversa com a IA, por categoria × SETOR.
//  3. DESPESAS       — o orçamento em si. Cada despesa é uma linha, gravada
//                      quando o gestor confirma o cartão que a IA propôs.
//
// O escopo é sempre categoria × setor: a conversa, a base e as despesas são de
// UM setor. A tela escolhe o setor no topo quando há mais de um.
// =============================================================================

const PATH = "/orcamento";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Uma linha da base do ano anterior (curadoria do admin). */
export interface PlanejamentoBaseLinha {
  id: string;
  nome: string;
  valorAno: number;
  grupoId: string | null;
  grupoNome: string | null;
  fornecedor: string | null;
  lancamentos: number;
  incluir: boolean;
}

/** Uma despesa orçada. */
export interface PlanejamentoDespesaLinha {
  id: string;
  descricao: string;
  grupoId: string | null;
  grupoNome: string | null;
  valor: number;
  periodicidade: Periodicidade;
  mesInicio: number;
  mesFim: number | null;
  fornecedor: string | null;
  origem: "base" | "nova";
  /** Série de 12 meses (onde o pagamento cai, conforme a periodicidade). */
  meses: number[];
  totalAno: number;
  cancelado: boolean;
  canceladoMotivo: string | null;
  travado: boolean;
}

export interface PlanejamentoSetorDaCategoria {
  id: string | null;
  name: string;
  podeEscrever: boolean;
}

export interface PlanejamentoGrupoOption {
  id: string;
  name: string;
}

export interface PlanejamentoMontagemDetalhe {
  categoryCode: string;
  categoryName: string;
  dreLineCode: string;
  dreLineName: string;
  /** Setores desta categoria que o usuário alcança. Vazio = categoria fora do
   * alcance dele (ou não atribuída a setor nenhum). */
  setores: PlanejamentoSetorDaCategoria[];
  /** Setor efetivamente carregado (o escolhido, ou o único, ou null). */
  setorId: string | null;
  setorNome: string;
  /** Grupos ATIVOS da empresa, em ordem alfabética — a faixa do topo da tela. */
  grupos: PlanejamentoGrupoOption[];
  base: PlanejamentoBaseLinha[];
  baseSalva: boolean;
  contextoAdmin: string;
  conversa: PlanejamentoMensagem[];
  justificativa: string;
  despesas: PlanejamentoDespesaLinha[];
  /** Realizado do ano anterior da categoria (somando as irmãs "(*)"). */
  realizadoAnterior: { total: number; media: number | null; meses: (number | null)[] } | null;
  /** O usuário pode gravar NESTE setor, nesta fase do ciclo. */
  podeEscrever: boolean;
  isAdmin: boolean;
}

// ─── Helpers privados ────────────────────────────────────────────────────────

function linhaBase(r: Record<string, unknown>): PlanejamentoBaseLinha {
  const grupo = r.orcamento_grupos_despesa as { name?: string } | null | undefined;
  return {
    id: r.id as string,
    nome: (r.nome as string) ?? "",
    valorAno: Number(r.valor_ano) || 0,
    grupoId: (r.grupo_id as string | null) ?? null,
    grupoNome: grupo?.name ?? null,
    fornecedor: (r.fornecedor as string | null) ?? null,
    lancamentos: Number(r.lancamentos) || 0,
    incluir: r.incluir !== false,
  };
}

function linhaDespesa(r: Record<string, unknown>): PlanejamentoDespesaLinha {
  const grupo = r.orcamento_grupos_despesa as { name?: string } | null | undefined;
  const valor = Number(r.valor) || 0;
  const mesInicio = Math.min(12, Math.max(1, Number(r.mes_inicio) || 1));
  const mesFim = r.mes_fim == null ? null : Math.min(12, Math.max(1, Number(r.mes_fim)));
  const periodicidade = toPeriodicidade(r.periodicidade);
  const meses = serieItem(valor, mesInicio, periodicidade, mesFim);
  return {
    id: r.id as string,
    descricao: (r.descricao as string) ?? "",
    grupoId: (r.grupo_id as string | null) ?? null,
    grupoNome: grupo?.name ?? null,
    valor,
    periodicidade,
    mesInicio,
    mesFim,
    fornecedor: (r.fornecedor as string | null) ?? null,
    origem: r.origem === "base" ? "base" : "nova",
    meses,
    totalAno: meses.reduce((a, b) => a + b, 0),
    cancelado: r.cancelado === true,
    canceladoMotivo: (r.cancelado_motivo as string | null) ?? null,
    travado: r.diretoria_travado === true,
  };
}

/**
 * Setores desta categoria que o usuário alcança.
 *
 * Cruza `orcamento_categoria_setores` (quais setores orçam a categoria) com o
 * escopo do papel. Empresa sem "Orçar por setor" devolve um setor virtual nulo
 * — a tela não mostra seletor e tudo cai no balde "Não atribuído" na gravação.
 */
async function setoresDaCategoria(
  supabase: Supabase,
  companyId: string,
  year: number,
  categoryCode: string,
  escopoLeitura: string[] | null,
  escopoEscrita: string[] | null,
  porSetor: boolean,
): Promise<PlanejamentoSetorDaCategoria[]> {
  if (!porSetor) {
    return [{ id: null, name: "", podeEscrever: escopoEscrita === null || escopoEscrita.length > 0 }];
  }

  const { data: atrib } = await supabase
    .from("orcamento_categoria_setores")
    .select("setor_id")
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("category_code", categoryCode);
  const ids = (atrib ?? [])
    .map((r) => r.setor_id as string)
    .filter((id) => escopoLeitura === null || escopoLeitura.includes(id));
  if (ids.length === 0) return [];

  const { data: setores } = await supabase
    .from("orcamento_setores")
    .select("id, name")
    .in("id", ids);

  return (setores ?? [])
    .map((r) => ({
      id: r.id as string,
      name: r.name as string,
      podeEscrever: escopoEscrita === null || escopoEscrita.includes(r.id as string),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }));
}

/**
 * Filtro de setor numa consulta: setor nulo precisa de `.is`, não de `.eq` — no
 * PostgREST `eq.null` não casa com NADA, e a consulta voltaria vazia em silêncio
 * (é a mesma armadilha que `setorParaGravar` documenta do lado da gravação).
 *
 * O tipo do builder é apagado por dentro de propósito: com o genérico amarrado
 * à forma do query builder do supabase-js, o `select` com embed
 * (`orcamento_grupos_despesa(name)`) estoura o limite de profundidade do
 * TypeScript (TS2589).
 */
type FiltravelPorSetor = {
  eq(coluna: string, valor: string): FiltravelPorSetor;
  is(coluna: string, valor: null): FiltravelPorSetor;
};

function comSetor<Q>(q: Q, setorId: string | null): Q {
  const b = q as unknown as FiltravelPorSetor;
  const filtrado = setorId ? b.eq("setor_id", setorId) : b.is("setor_id", null);
  return filtrado as unknown as Q;
}

// ─── Leitura ─────────────────────────────────────────────────────────────────

export async function getPlanejamentoMontagem(
  companyId: string,
  year: number,
  categoryCode: string,
  setorIdPedido: string | null,
): Promise<{ data?: PlanejamentoMontagemDetalhe; error?: string; needsMigration?: boolean }> {
  if (!companyId || !categoryCode) return { error: "Categoria inválida." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());
  const auth = await autorizarLeitura(supabase, companyId, year);
  if (!auth.ok) return { error: auth.error };

  // A ESCRITA é consultada aqui só para pintar a tela (botões desabilitados).
  // A trava de verdade é refeita em cada action — tela nunca é autorização.
  const escrita = await autorizarEscrita(supabase, companyId, year);
  const escopoEscrita = escrita.ok ? escrita.setores : [];

  const cats = await getCategoriaMetodo(companyId, year);
  if (cats.needsMigration) return { needsMigration: true };
  if (cats.error) return { error: cats.error };
  const cat = (cats.items ?? []).find((c) => c.categoryCode === categoryCode);
  if (!cat) return { error: "Categoria não encontrada nesta empresa." };
  if (cat.metodo !== "planejamento_socios") {
    return { error: "Esta categoria não é orçada pelo Planejamento dos gestores." };
  }

  const porSetor = await orcaPorSetor(supabase, companyId, year);
  const setores = await setoresDaCategoria(
    supabase,
    companyId,
    year,
    categoryCode,
    auth.setores,
    escopoEscrita,
    porSetor,
  );

  // Setor efetivo: o pedido (se estiver na lista), senão o único, senão nenhum.
  const escolhido =
    setores.find((s) => s.id === setorIdPedido) ?? (setores.length === 1 ? setores[0] : null);
  const setorId = escolhido?.id ?? null;

  const grupos = await (async () => {
    const { data } = await supabase
      .from("orcamento_grupos_despesa")
      .select("id, name")
      .eq("company_id", companyId)
      .eq("active", true);
    return (data ?? [])
      .map((r) => ({ id: r.id as string, name: r.name as string }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }));
  })();

  // Sem setor escolhido (a tela vai pedir), devolve só o cabeçalho.
  const vazio: PlanejamentoMontagemDetalhe = {
    categoryCode,
    categoryName: cat.categoryName,
    dreLineCode: cat.dreLineCode,
    dreLineName: cat.dreLineName,
    setores,
    setorId: null,
    setorNome: "",
    grupos,
    base: [],
    baseSalva: false,
    contextoAdmin: "",
    conversa: [],
    justificativa: "",
    despesas: [],
    realizadoAnterior: null,
    podeEscrever: false,
    isAdmin: auth.user.isAdmin,
  };
  if (porSetor && !escolhido) return { data: vazio };

  // ── Base, entrevista e despesas do setor escolhido ────────────────────────
  const baseQuery = comSetor(
    supabase
      .from("orcamento_planejamento_base")
      .select("id, nome, valor_ano, grupo_id, fornecedor, lancamentos, incluir, orcamento_grupos_despesa(name)")
      .eq("company_id", companyId)
      .eq("year", year)
      .eq("category_code", categoryCode),
    setorId,
  );
  const { data: baseRows, error: baseErr } = await baseQuery;
  if (baseErr) {
    if (isSchemaMissing(baseErr.message)) return { needsMigration: true };
    return { error: baseErr.message };
  }

  const { data: entrevRow } = await comSetor(
    supabase
      .from("orcamento_planejamento_entrevistas")
      .select("base_salva, contexto_admin, conversa, justificativa")
      .eq("company_id", companyId)
      .eq("year", year)
      .eq("category_code", categoryCode),
    setorId,
  ).maybeSingle();

  const { data: despRows, error: despErr } = await comSetor(
    supabase
      .from("orcamento_planejamento_despesas")
      .select(
        "id, descricao, grupo_id, valor, periodicidade, mes_inicio, mes_fim, fornecedor, origem, cancelado, cancelado_motivo, diretoria_travado, created_at, orcamento_grupos_despesa(name)",
      )
      .eq("company_id", companyId)
      .eq("year", year)
      .eq("category_code", categoryCode)
      .order("created_at"),
    setorId,
  );
  if (despErr) {
    if (isSchemaMissing(despErr.message)) return { needsMigration: true };
    return { error: despErr.message };
  }

  // Realizado do ano anterior (categoria + irmãs "(*)"), para a tela mostrar o
  // mês a mês e a IA enxergar sazonalidade.
  const irmaos = codigosIrmaos(cats.items ?? [], categoryCode, cat.categoryName);
  const realizados = await fetchRealizados(supabase, companyId, year - 1, irmaos);
  const combinado = combinarRealizados(realizados, irmaos, year - 1);
  const totalAnterior = totalGastoAno(realizados, irmaos);

  const conversa = Array.isArray(entrevRow?.conversa)
    ? (entrevRow!.conversa as unknown[]).filter(
        (m): m is PlanejamentoMensagem =>
          !!m &&
          typeof m === "object" &&
          ((m as { role?: unknown }).role === "user" ||
            (m as { role?: unknown }).role === "assistant") &&
          typeof (m as { content?: unknown }).content === "string",
      )
    : [];

  return {
    data: {
      ...vazio,
      setorId,
      setorNome: escolhido?.name ?? "",
      base: (baseRows ?? [])
        .map((r) => linhaBase(r as Record<string, unknown>))
        .sort((a, b) => b.valorAno - a.valorAno),
      baseSalva: entrevRow?.base_salva === true,
      contextoAdmin: (entrevRow?.contexto_admin as string | null) ?? "",
      conversa,
      justificativa: (entrevRow?.justificativa as string | null) ?? "",
      despesas: (despRows ?? []).map((r) => linhaDespesa(r as Record<string, unknown>)),
      realizadoAnterior:
        totalAnterior > 0 || combinado.media != null
          ? { total: totalAnterior, media: combinado.media, meses: combinado.meses }
          : null,
      podeEscrever: escolhido?.podeEscrever === true && escrita.ok,
    },
  };
}

// ─── Base: semeadura a partir da Omie (admin) ────────────────────────────────

/**
 * Resolve o SETOR do orçamento até o departamento da Omie, para filtrar os
 * fornecedores do ano anterior. A corrente é:
 *   orcamento_setores.ctrl_sector_id → ctrl_sector_omie_departamento
 *     → codigo_departamento (o mesmo de financial_entries.department_code)
 */
async function departamentoDoSetor(
  supabase: Supabase,
  companyId: string,
  setorId: string | null,
): Promise<{ departamento: string | null; ehNaoAtribuido: boolean; temVinculo: boolean }> {
  if (!setorId) return { departamento: null, ehNaoAtribuido: false, temVinculo: false };

  const { data: setor } = await supabase
    .from("orcamento_setores")
    .select("name, ctrl_sector_id")
    .eq("id", setorId)
    .maybeSingle();
  if (!setor) return { departamento: null, ehNaoAtribuido: false, temVinculo: false };

  const ehNaoAtribuido = normNomeCategoria(String(setor.name ?? "")) === "não atribuído";
  const ctrlId = (setor.ctrl_sector_id as string | null) ?? null;
  if (!ctrlId) return { departamento: null, ehNaoAtribuido, temVinculo: false };

  const { data: dep } = await supabase
    .from("ctrl_sector_omie_departamento")
    .select("codigo_departamento")
    .eq("sector_id", ctrlId)
    .eq("company_id", companyId)
    .maybeSingle();
  const departamento = (dep?.codigo_departamento as string | null) ?? null;
  return { departamento, ehNaoAtribuido, temVinculo: departamento != null };
}

interface FornecedorAno {
  fornecedor: string;
  total: number;
  lancamentos: number;
  departamento: string | null;
}

/** Fornecedores do ano anterior nesta categoria (somando as irmãs "(*)"). */
async function fornecedoresDoAnoAnterior(
  supabase: Supabase,
  companyId: string,
  baseYear: number,
  codes: string[],
): Promise<FornecedorAno[]> {
  const fechados = mesesFechados(baseYear);
  const listas = await Promise.all(
    codes.map(async (code) => {
      const { data, error } = await supabase.rpc("orcamento_planejamento_realizado_itens", {
        p_company_id: companyId,
        p_base_year: baseYear,
        p_category_code: code,
        p_meses_fechados: fechados,
      });
      if (error) return [] as FornecedorAno[];
      return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
        fornecedor: String(r.fornecedor ?? ""),
        total: Math.abs(Number(r.total) || 0),
        lancamentos: Number(r.lancamentos) || 0,
        departamento: r.departamento == null ? null : String(r.departamento),
      }));
    }),
  );

  // Merge por nome do fornecedor entre as irmãs. Departamentos divergentes
  // tornam o fornecedor ambíguo — vira null, e ele cai no "Não atribuído".
  const porNome = new Map<string, FornecedorAno>();
  listas.flat().forEach((it) => {
    if (!it.fornecedor) return;
    const chave = it.fornecedor.toLocaleLowerCase("pt-BR");
    const atual = porNome.get(chave);
    if (!atual) {
      porNome.set(chave, { ...it });
      return;
    }
    atual.total += it.total;
    atual.lancamentos += it.lancamentos;
    if (atual.departamento !== it.departamento) atual.departamento = null;
  });
  return Array.from(porNome.values()).sort((a, b) => b.total - a.total);
}

/**
 * Semeia a base com o que saiu na Omie no ano anterior, agrupado POR
 * FORNECEDOR (uma linha por fornecedor, com o total do ano e a contagem de
 * lançamentos). Decisão do dono do projeto em 23/09/2026: lançamento a
 * lançamento daria centenas de linhas numa categoria como Marketing, e a
 * curadoria do admin ficaria impraticável.
 *
 * Reexecutar é seguro: o que já existe (casado pelo nome do FORNECEDOR, não
 * pelo nome de exibição) é preservado com a curadoria feita — inclusive o
 * "desconsiderado", que por isso não volta a ser sugerido. Só entram
 * fornecedores novos.
 */
export async function semearBasePlanejamento(
  companyId: string,
  year: number,
  categoryCode: string,
  setorId: string | null,
): Promise<{ inseridos?: number; error?: string; needsMigration?: boolean; aviso?: string }> {
  const user = await getOrcamentoUser();
  if (!user) return { error: SEM_ACESSO };
  // A base é curadoria de ADMIN — o gestor entra pela entrevista.
  if (!user.isAdmin) return { error: SEM_ACESSO_ADMIN };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());

  const cats = await getCategoriaMetodo(companyId, year);
  if (cats.needsMigration) return { needsMigration: true };
  const cat = (cats.items ?? []).find((c) => c.categoryCode === categoryCode);
  if (!cat) return { error: "Categoria não encontrada." };
  const irmaos = codigosIrmaos(cats.items ?? [], categoryCode, cat.categoryName);

  const todos = await fornecedoresDoAnoAnterior(supabase, companyId, year - 1, irmaos);

  // Recorte por setor: o setor com departamento vinculado leva os fornecedores
  // DAQUELE departamento; o "Não atribuído" recolhe o que não tem dono. Setor
  // sem vínculo com o Compras não tem como filtrar e recebe a lista inteira —
  // falha mostrando demais, não escondendo.
  const ctx = await departamentoDoSetor(supabase, companyId, setorId);
  const doSetor = ctx.ehNaoAtribuido
    ? todos.filter((i) => !i.departamento)
    : ctx.temVinculo
      ? todos.filter((i) => i.departamento === ctx.departamento)
      : todos;

  const { data: existentes, error: exErr } = await comSetor(
    supabase
      .from("orcamento_planejamento_base")
      .select("fornecedor")
      .eq("company_id", companyId)
      .eq("year", year)
      .eq("category_code", categoryCode),
    setorId,
  );
  if (exErr) {
    if (isSchemaMissing(exErr.message)) return { needsMigration: true };
    return { error: exErr.message };
  }
  const jaTem = new Set(
    (existentes ?? [])
      .map((r) => (r.fornecedor as string | null) ?? "")
      .filter(Boolean)
      .map((f) => f.toLocaleLowerCase("pt-BR")),
  );

  const novos = doSetor.filter((i) => !jaTem.has(i.fornecedor.toLocaleLowerCase("pt-BR")));
  if (novos.length === 0) {
    return {
      inseridos: 0,
      aviso: ctx.temVinculo || ctx.ehNaoAtribuido
        ? undefined
        : "Este setor não tem departamento vinculado no módulo Compras, então a base mostra os fornecedores de toda a categoria.",
    };
  }

  const { error: insErr } = await supabase.from("orcamento_planejamento_base").insert(
    novos.map((i) => ({
      company_id: companyId,
      year,
      category_code: categoryCode,
      setor_id: setorId,
      nome: i.fornecedor,
      valor_ano: i.total,
      fornecedor: i.fornecedor,
      lancamentos: i.lancamentos,
      updated_by: user.userId,
    })),
  );
  if (insErr) {
    if (isSchemaMissing(insErr.message)) return { needsMigration: true };
    return { error: insErr.message };
  }

  revalidatePath(PATH);
  return {
    inseridos: novos.length,
    aviso:
      ctx.temVinculo || ctx.ehNaoAtribuido
        ? undefined
        : "Este setor não tem departamento vinculado no módulo Compras, então a base trouxe os fornecedores de toda a categoria.",
  };
}

// ─── Base: edição (admin) ────────────────────────────────────────────────────

export async function salvarLinhaBase(
  id: string,
  campos: { nome?: string; valorAno?: number; grupoId?: string | null; incluir?: boolean },
): Promise<{ ok?: true; error?: string }> {
  const user = await getOrcamentoUser();
  if (!user) return { error: SEM_ACESSO };
  if (!user.isAdmin) return { error: SEM_ACESSO_ADMIN };
  if (!id) return { error: "Linha inválida." };

  const patch: Record<string, unknown> = { updated_by: user.userId };
  if (campos.nome !== undefined) {
    const nome = campos.nome.trim();
    if (!nome) return { error: "Informe o nome da despesa." };
    patch.nome = nome;
  }
  if (campos.valorAno !== undefined) {
    if (!Number.isFinite(campos.valorAno) || campos.valorAno < 0) {
      return { error: "Valor inválido." };
    }
    patch.valor_ano = campos.valorAno;
  }
  if (campos.grupoId !== undefined) patch.grupo_id = campos.grupoId;
  if (campos.incluir !== undefined) patch.incluir = campos.incluir;

  const supabase = createAdminClientIfAvailable() ?? (await createClient());
  const { error } = await supabase.from("orcamento_planejamento_base").update(patch).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(PATH);
  return { ok: true };
}

/** Linha que o admin acrescenta à mão (algo que a Omie não trouxe). */
export async function adicionarLinhaBase(
  companyId: string,
  year: number,
  categoryCode: string,
  setorId: string | null,
  nome: string,
  valorAno: number,
): Promise<{ ok?: true; error?: string; needsMigration?: boolean }> {
  const user = await getOrcamentoUser();
  if (!user) return { error: SEM_ACESSO };
  if (!user.isAdmin) return { error: SEM_ACESSO_ADMIN };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };
  const limpo = nome.trim();
  if (!limpo) return { error: "Informe o nome da despesa." };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());
  const { error } = await supabase.from("orcamento_planejamento_base").insert({
    company_id: companyId,
    year,
    category_code: categoryCode,
    setor_id: setorId,
    nome: limpo,
    valor_ano: Number.isFinite(valorAno) && valorAno > 0 ? valorAno : 0,
    updated_by: user.userId,
  });
  if (error) {
    if (isSchemaMissing(error.message)) return { needsMigration: true };
    return { error: error.message };
  }
  revalidatePath(PATH);
  return { ok: true };
}

export async function removerLinhaBase(id: string): Promise<{ ok?: true; error?: string }> {
  const user = await getOrcamentoUser();
  if (!user) return { error: SEM_ACESSO };
  if (!user.isAdmin) return { error: SEM_ACESSO_ADMIN };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());
  const { error } = await supabase.from("orcamento_planejamento_base").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(PATH);
  return { ok: true };
}

/**
 * Finaliza (ou reabre) a base. Finalizada é o que destrava a entrevista para o
 * gestor: sem ela, a IA conversaria sem saber o que o setor já gasta.
 */
export async function finalizarBase(
  companyId: string,
  year: number,
  categoryCode: string,
  setorId: string | null,
  categoryName: string,
  finalizada: boolean,
): Promise<{ ok?: true; error?: string; needsMigration?: boolean }> {
  const user = await getOrcamentoUser();
  if (!user) return { error: SEM_ACESSO };
  if (!user.isAdmin) return { error: SEM_ACESSO_ADMIN };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());
  const res = await upsertEntrevista(supabase, companyId, year, categoryCode, setorId, categoryName, {
    base_salva: finalizada,
    updated_by: user.userId,
  });
  if (res.error) return res;
  revalidatePath(PATH);
  return { ok: true };
}

/** Contexto livre que o admin escreve para orientar a IA desta categoria × setor. */
export async function salvarContextoAdmin(
  companyId: string,
  year: number,
  categoryCode: string,
  setorId: string | null,
  categoryName: string,
  contexto: string,
): Promise<{ ok?: true; error?: string; needsMigration?: boolean }> {
  const user = await getOrcamentoUser();
  if (!user) return { error: SEM_ACESSO };
  if (!user.isAdmin) return { error: SEM_ACESSO_ADMIN };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());
  const res = await upsertEntrevista(supabase, companyId, year, categoryCode, setorId, categoryName, {
    contexto_admin: contexto.trim() || null,
    updated_by: user.userId,
  });
  if (res.error) return res;
  revalidatePath(PATH);
  return { ok: true };
}

/**
 * Cria ou atualiza a linha da entrevista (categoria × setor).
 *
 * Não usa `upsert` com `onConflict`: a chave do escopo é um índice único com
 * `COALESCE(setor_id, …)` — expressão, não coluna —, e o PostgREST não sabe
 * apontar para ela. Busca-e-decide é explícito e funciona com setor nulo.
 */
async function upsertEntrevista(
  supabase: Supabase,
  companyId: string,
  year: number,
  categoryCode: string,
  setorId: string | null,
  categoryName: string,
  patch: Record<string, unknown>,
): Promise<{ ok?: true; error?: string; needsMigration?: boolean }> {
  const { data: existente, error: buscaErr } = await comSetor(
    supabase
      .from("orcamento_planejamento_entrevistas")
      .select("id")
      .eq("company_id", companyId)
      .eq("year", year)
      .eq("category_code", categoryCode),
    setorId,
  ).maybeSingle();
  if (buscaErr) {
    if (isSchemaMissing(buscaErr.message)) return { needsMigration: true };
    return { error: buscaErr.message };
  }

  if (existente?.id) {
    const { error } = await supabase
      .from("orcamento_planejamento_entrevistas")
      .update(patch)
      .eq("id", existente.id as string);
    if (error) return { error: error.message };
    return { ok: true };
  }

  const { error } = await supabase.from("orcamento_planejamento_entrevistas").insert({
    company_id: companyId,
    year,
    category_code: categoryCode,
    setor_id: setorId,
    category_name: categoryName,
    ...patch,
  });
  if (error) {
    if (isSchemaMissing(error.message)) return { needsMigration: true };
    return { error: error.message };
  }
  return { ok: true };
}

// ─── Despesas (o orçamento) ──────────────────────────────────────────────────

export interface DespesaInput {
  descricao: string;
  grupoId: string | null;
  valor: number;
  periodicidade: Periodicidade;
  mesInicio: number;
  mesFim: number | null;
  fornecedor: string | null;
  origem: "base" | "nova";
  baseId: string | null;
}

function validarDespesa(input: DespesaInput): string | null {
  if (!input.descricao.trim()) return "Informe o nome da despesa.";
  if (!Number.isFinite(input.valor) || input.valor < 0) return "Valor inválido.";
  if (!(input.mesInicio >= 1 && input.mesInicio <= 12)) return "Mês de início inválido.";
  if (input.mesFim != null && (input.mesFim < 1 || input.mesFim > 12)) {
    return "Mês de término inválido.";
  }
  if (input.mesFim != null && input.mesFim < input.mesInicio) {
    return "O mês de término não pode ser anterior ao de início.";
  }
  return null;
}

/**
 * Grava uma despesa. É chamada quando o gestor CONFIRMA o cartão que a IA
 * propôs (decisão de 23/09/2026): a IA sugere, o gestor revisa e clica — assim
 * nenhuma leitura errada da IA entra no orçamento sozinha.
 */
export async function adicionarDespesa(
  companyId: string,
  year: number,
  categoryCode: string,
  setorId: string | null,
  input: DespesaInput,
): Promise<{ id?: string; error?: string; needsMigration?: boolean }> {
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };
  const invalido = validarDespesa(input);
  if (invalido) return { error: invalido };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());
  const auth = await autorizarEscrita(supabase, companyId, year);
  if (!auth.ok) return { error: auth.error };

  const alvo = await setorParaGravar(supabase, companyId, year, setorId, auth.user.userId);
  if (!podeEscreverNoSetor(auth.setores, alvo.id)) return { error: SEM_ACESSO_SETOR };

  const { data, error } = await supabase
    .from("orcamento_planejamento_despesas")
    .insert({
      company_id: companyId,
      year,
      category_code: categoryCode,
      setor_id: alvo.id,
      grupo_id: input.grupoId,
      descricao: input.descricao.trim(),
      valor: input.valor,
      periodicidade: input.periodicidade,
      mes_inicio: input.mesInicio,
      mes_fim: input.mesFim,
      fornecedor: input.fornecedor?.trim() || null,
      origem: input.origem,
      base_id: input.baseId,
      created_by: auth.user.userId,
      updated_by: auth.user.userId,
    })
    .select("id")
    .maybeSingle();
  if (error) {
    if (isSchemaMissing(error.message)) return { needsMigration: true };
    return { error: error.message };
  }

  await registrarAlteracao({
    companyId,
    year,
    cicloId: auth.cicloId,
    categoryCode,
    setorId: alvo.id,
    metodo: "planejamento_socios",
    alvoTipo: "planejamento_item",
    alvoId: (data?.id as string) ?? null,
    alvoRotulo: input.descricao.trim(),
    acao: "criou",
    fase: auth.fase,
    depois: { valor: input.valor, periodicidade: input.periodicidade, mesInicio: input.mesInicio },
    autorId: auth.user.userId,
    autorPapel: auth.user.papel,
  });

  revalidatePath(PATH);
  return { id: (data?.id as string) ?? undefined };
}

export async function editarDespesa(
  companyId: string,
  year: number,
  despesaId: string,
  input: DespesaInput,
): Promise<{ ok?: true; error?: string }> {
  if (!despesaId) return { error: "Despesa inválida." };
  const invalido = validarDespesa(input);
  if (invalido) return { error: invalido };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());
  const auth = await autorizarEscrita(supabase, companyId, year);
  if (!auth.ok) return { error: auth.error };

  const { data: atual } = await supabase
    .from("orcamento_planejamento_despesas")
    .select("setor_id, category_code, descricao, valor, diretoria_travado")
    .eq("id", despesaId)
    .maybeSingle();
  if (!atual) return { error: "Despesa não encontrada." };
  if (!podeEscreverNoSetor(auth.setores, (atual.setor_id as string | null) ?? null)) {
    return { error: SEM_ACESSO_SETOR };
  }
  // Trava da diretoria: agora por DESPESA, porque a despesa virou linha. No
  // modelo antigo ela morava na categoria × setor por falta de linha própria.
  const trava = podeEscreverNoItem(auth.user.papel, atual as { diretoria_travado?: boolean | null });
  if (!trava.pode) return { error: trava.motivo ?? "Item travado pela diretoria." };

  const { error } = await supabase
    .from("orcamento_planejamento_despesas")
    .update({
      grupo_id: input.grupoId,
      descricao: input.descricao.trim(),
      valor: input.valor,
      periodicidade: input.periodicidade,
      mes_inicio: input.mesInicio,
      mes_fim: input.mesFim,
      fornecedor: input.fornecedor?.trim() || null,
      updated_by: auth.user.userId,
    })
    .eq("id", despesaId);
  if (error) return { error: error.message };

  await registrarAlteracao({
    companyId,
    year,
    cicloId: auth.cicloId,
    categoryCode: (atual.category_code as string | null) ?? null,
    setorId: (atual.setor_id as string | null) ?? null,
    metodo: "planejamento_socios",
    alvoTipo: "planejamento_item",
    alvoId: despesaId,
    alvoRotulo: input.descricao.trim(),
    acao: "alterou",
    fase: auth.fase,
    antes: { descricao: atual.descricao as string, valor: Number(atual.valor) },
    depois: { descricao: input.descricao.trim(), valor: input.valor },
    autorId: auth.user.userId,
    autorPapel: auth.user.papel,
  });

  revalidatePath(PATH);
  return { ok: true };
}

export async function removerDespesa(
  companyId: string,
  year: number,
  despesaId: string,
): Promise<{ ok?: true; error?: string }> {
  if (!despesaId) return { error: "Despesa inválida." };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());
  const auth = await autorizarEscrita(supabase, companyId, year);
  if (!auth.ok) return { error: auth.error };

  const { data: atual } = await supabase
    .from("orcamento_planejamento_despesas")
    .select("setor_id, descricao, valor, diretoria_travado")
    .eq("id", despesaId)
    .maybeSingle();
  if (!atual) return { error: "Despesa não encontrada." };
  if (!podeEscreverNoSetor(auth.setores, (atual.setor_id as string | null) ?? null)) {
    return { error: SEM_ACESSO_SETOR };
  }
  const trava = podeEscreverNoItem(auth.user.papel, atual as { diretoria_travado?: boolean | null });
  if (!trava.pode) return { error: trava.motivo ?? "Item travado pela diretoria." };

  const { error } = await supabase
    .from("orcamento_planejamento_despesas")
    .delete()
    .eq("id", despesaId);
  if (error) return { error: error.message };

  await registrarAlteracao({
    companyId,
    year,
    cicloId: auth.cicloId,
    setorId: (atual.setor_id as string | null) ?? null,
    metodo: "planejamento_socios",
    alvoTipo: "planejamento_item",
    alvoId: despesaId,
    alvoRotulo: atual.descricao as string,
    acao: "excluiu",
    fase: auth.fase,
    antes: { descricao: atual.descricao as string, valor: Number(atual.valor) },
    autorId: auth.user.userId,
    autorPapel: auth.user.papel,
  });

  revalidatePath(PATH);
  return { ok: true };
}

// ─── Prévia do setor (a faixa que se preenche durante a entrevista) ──────────

export interface PreviaSetorGrupo {
  /** Nome do grupo, ou "Sem grupo" no balde. */
  nome: string;
  grupoId: string | null;
  total: number;
  itens: { nome: string; detalhe: string | null; total: number }[];
}

export interface PreviaSetorCategoria {
  categoria: string;
  metodo: string;
  metodoLabel: string;
  total: number;
  /** Vazio quando o método não tem despesa item a item (ex.: média). */
  grupos: PreviaSetorGrupo[];
  /** A categoria da tela aberta — a tela a destaca. */
  atual: boolean;
}

export interface PreviaSetorResumo {
  categorias: PreviaSetorCategoria[];
  total: number;
}

/**
 * Resumo do orçamento do SETOR, com todas as categorias já orçadas (qualquer
 * método), para a faixa que fica embaixo da entrevista.
 *
 * Reusa `getPreviaOrcamento` — a MESMA prévia da tela de Prévia, com o filtro
 * de setor que ela já aceita. Era o pedido explícito ("pega como base a prévia
 * que já existe hoje"), e evita uma segunda soma do orçamento que divergiria da
 * primeira no dia em que uma regra mudasse.
 *
 * O achatamento aqui é só de APRESENTAÇÃO: linha da DRE → fonte (método ×
 * categoria) → grupo → despesa. O grupo só existe no Planejamento; nos demais
 * métodos a categoria aparece sem subnível.
 */
export async function getPreviaSetor(
  companyId: string,
  year: number,
  setorId: string | null,
  categoriaAtual: string,
): Promise<{ data?: PreviaSetorResumo; error?: string; needsMigration?: boolean }> {
  if (!companyId) return { error: "Empresa inválida." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const res = await getPreviaOrcamento(companyId, year, setorId ?? SETOR_TODOS);
  if (res.needsMigration) return { needsMigration: true };
  if (res.error || !res.data) return { error: res.error ?? "Não consegui calcular a prévia." };

  const categorias: PreviaSetorCategoria[] = [];
  for (const linha of res.data.linhas) {
    for (const fonte of linha.fontes) {
      if (fonte.totalAno === 0 && fonte.itens.length === 0) continue;
      const grupos = agruparPorGrupo(
        fonte.itens.map((i) => ({
          grupoId: i.grupo ?? null,
          grupoNome: i.grupo ?? null,
          nome: i.nome,
          detalhe: i.detalhe ?? null,
          total: i.totalAno,
        })),
      ).map((g) => ({
        // `agruparPorGrupo` chaveia por id; aqui o "id" é o próprio nome do
        // grupo (a prévia não carrega o uuid), o que basta para agrupar e
        // ordenar. Dois grupos homônimos cairiam juntos — impossível, porque o
        // cadastro tem nome único por empresa.
        nome: g.nome,
        grupoId: g.grupoId,
        total: g.itens.reduce((a, i) => a + i.total, 0),
        itens: g.itens.map((i) => ({ nome: i.nome, detalhe: i.detalhe, total: i.total })),
      }));

      categorias.push({
        categoria: fonte.chave,
        metodo: fonte.metodo,
        metodoLabel: fonte.metodoLabel,
        total: fonte.totalAno,
        grupos,
        atual: fonte.metodo === "planejamento_socios" && fonte.chave === categoriaAtual,
      });
    }
  }

  categorias.sort((a, b) => {
    // A categoria aberta primeiro: é a que o gestor está mexendo agora.
    if (a.atual !== b.atual) return a.atual ? -1 : 1;
    return b.total - a.total;
  });

  return {
    data: { categorias, total: categorias.reduce((a, c) => a + c.total, 0) },
  };
}
