"use server";

import { revalidatePath } from "next/cache";
import { generateText, type ModelMessage } from "ai";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { registrarAlteracao } from "@/lib/orcamento/actions/trilha";
import { podeEscreverNoItem } from "@/lib/orcamento/validacao";
import type { OrcamentoPapel } from "@/lib/supabase/types";
import {
  autorizarEscrita,
  autorizarLeitura,
  podeEscreverNoSetor,
  SEM_ACESSO_SETOR,
} from "@/lib/orcamento/auth";
import { isSchemaMissing } from "@/lib/orcamento/errors";
import { isValidBudgetYear } from "@/lib/orcamento/years";
import { isTodosSetores, setorEspecifico } from "@/lib/orcamento/setor-filtro";
import { orcaPorSetor, setorParaGravar } from "@/lib/orcamento/setor-gravacao";
import { getCategoriaMetodo } from "@/lib/orcamento/actions/categoria-metodo";
import {
  fetchRealizados,
  mesesFechados,
  resumirRealizado,
  REALIZADO_VAZIO,
  type MediaRealizado,
} from "@/lib/orcamento/media-realizado";
import { buildSystemPrompt } from "@/lib/orcamento/entrevista-prompt";
import { resolveAiProvider, logResolvedUsage } from "@/lib/ai/provider";
import {
  categoriaTotal,
  type Periodicidade,
  type PlanejamentoItem,
  type PlanejamentoItemProposto,
  type PlanejamentoMensagem,
  type PlanejamentoProposta,
  type PlanejamentoRealizadoItem,
  apenasCanonicas,
  codigosIrmaos,
  normNomeCategoria,
  periodicidadeLabel,
  serieItem,
  toPeriodicidade,
} from "@/lib/orcamento/planejamento-calc";

const PATH = "/orcamento";

// ─── Tipos de retorno ──────────────────────────────────────────────────────────

export interface PlanejamentoListItem {
  categoryCode: string;
  categoryName: string;
  dreLineCode: string;
  dreLineName: string;
  /** Etapa 1 (base) finalizada pelo admin. */
  baseSalva: boolean;
  /** Existe proposta da entrevista (Etapa 3). */
  temProposta: boolean;
  /** Proposta confirmada (congelada, vai para a Prévia). */
  propostaConfirmada: boolean;
  itemCount: number;
  /** Total da PROPOSTA (0 se ainda não há proposta). */
  totalOrcado: number;
  realizadoAnterior: { total: number; media: number | null; meses: (number | null)[] } | null;
  /**
   * Itens da proposta confirmada, para a diretoria aprovar UM A UM sem entrar
   * na entrevista. A validação é por despesa, não pelo conjunto da categoria:
   * uma categoria reúne contratações e assinaturas distintas, e aprovar o bloco
   * esconderia exatamente o que ela precisa olhar.
   */
  itensProposta: Array<{
    indice: number;
    descricao: string;
    valorMensal: number;
    /** Chave da periodicidade (para editar), não o rótulo. */
    periodicidade: Periodicidade;
    periodicidadeLabel: string;
    mesInicio: number;
    mesFim: number | null;
    /**
     * Série de 12 meses da despesa. É o que mostra a FREQUÊNCIA: onde o
     * pagamento cai e onde não cai. Sem ela, "R$ 1.000 trimestral" não diz em
     * quais meses o dinheiro sai.
     */
    meses: number[];
    totalAno: number;
    cancelado: boolean;
    canceladoMotivo: string | null;
  }>;
  setorId: string | null;
}

export interface PlanejamentoCategoriaDetalhe {
  categoryCode: string;
  categoryName: string;
  dreLineCode: string;
  dreLineName: string;
  /** ETAPA 1 — itens da BASE (o que a IA considera). */
  itens: PlanejamentoItem[];
  /** Etapa 1 finalizada (habilita a entrevista). */
  baseSalva: boolean;
  /** ETAPA 1 — contexto livre que o admin escreve para orientar a IA. */
  contextoAdmin: string;
  /** ETAPA 2 — transcript da entrevista. */
  conversa: PlanejamentoMensagem[];
  /** ETAPA 3 — proposta final vinda da entrevista (null enquanto não existe). */
  proposta: PlanejamentoProposta | null;
  /** Proposta confirmada pelo gestor (congelada). */
  propostaConfirmada: boolean;
  realizadoAnterior: { total: number; media: number | null; meses: (number | null)[] } | null;
  /** Pagamentos do ano anterior por fornecedor (para semear/mostrar a referência). */
  realizadoItens: PlanejamentoRealizadoItem[];
}

/** Item enxuto que o cliente manda como contexto vivo para a IA. */
export interface PlanejamentoContextoItem {
  descricao: string;
  valorMensal: number;
  periodicidade: Periodicidade;
  mesInicio: number;
  mesFim: number | null;
}

/**
 * Contexto FIXO do prompt (linha da DRE + realizado do ano anterior) que o
 * cliente já tem em `detalhe` e NÃO muda durante a conversa. Quando enviado,
 * a entrevista pula as duas queries pesadas por turno (catálogo de categorias
 * + realizado da Omie), que só existiam para remontar esta mesma informação.
 */
export interface PlanejamentoPromptContexto {
  dreLineCode: string;
  dreLineName: string;
  realizadoTotal: number;
  realizadoMedia: number | null;
  /** Mês a mês do ano anterior (12 posições; null = sem pagamento). Sem ele a
   * IA não enxerga sazonalidade nem mês fora da curva. */
  realizadoMeses?: (number | null)[] | null;
}

interface CategoriaRow {
  category_code: string;
  category_name: string | null;
  justificativa: string | null;
  conversa: unknown;
  status: string | null;
  base_salva: boolean | null;
  contexto_admin: string | null;
  proposta: unknown;
  proposta_confirmada: boolean | null;
}
interface ItemRow {
  id: string;
  category_code: string;
  descricao: string;
  valor_mensal: number | string | null;
  mes_inicio: number | string | null;
  mes_fim: number | string | null;
  periodicidade: string | null;
  origem: string | null;
  fornecedor: string | null;
  incluir: boolean | null;
}

/** Mês opcional (1..12) ou null quando ausente/inválido. */
function optMes(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 && n <= 12 ? Math.round(n) : null;
}

// ─── Helpers puros ─────────────────────────────────────────────────────────────

function sanitizeConversa(raw: unknown): PlanejamentoMensagem[] {
  if (!Array.isArray(raw)) return [];
  const out: PlanejamentoMensagem[] = [];
  raw.forEach((m) => {
    if (m && typeof m === "object") {
      const role = (m as { role?: unknown }).role;
      const content = (m as { content?: unknown }).content;
      if ((role === "user" || role === "assistant") && typeof content === "string") {
        out.push({ role, content });
      }
    }
  });
  return out;
}

function rowToItem(r: ItemRow): PlanejamentoItem {
  const valor = Number(r.valor_mensal);
  const mes = Number(r.mes_inicio);
  return {
    id: r.id,
    descricao: r.descricao,
    valorMensal: Number.isFinite(valor) && valor > 0 ? valor : 0,
    mesInicio: Number.isFinite(mes) ? Math.min(12, Math.max(1, Math.round(mes))) : 1,
    mesFim: optMes(r.mes_fim),
    periodicidade: toPeriodicidade(r.periodicidade),
    origem: r.origem === "mantido" ? "mantido" : "novo",
    fornecedor: r.fornecedor ?? null,
    incluir: r.incluir !== false,
  };
}

function sanitizeItensProposta(raw: unknown): PlanejamentoItemProposto[] {
  if (!Array.isArray(raw)) return [];
  const out: PlanejamentoItemProposto[] = [];
  raw.forEach((it) => {
    if (!it || typeof it !== "object") return;
    const o = it as Record<string, unknown>;
    const descricao = String(o.descricao ?? "").trim();
    if (!descricao) return;
    const valor = Number(o.valorMensal ?? o.valor_mensal ?? o.valor ?? 0);
    const mes = Number(o.mesInicio ?? o.mes_inicio ?? 1);
    out.push({
      descricao,
      valorMensal: Number.isFinite(valor) && valor > 0 ? valor : 0,
      mesInicio: Number.isFinite(mes) ? Math.min(12, Math.max(1, Math.round(mes))) : 1,
      mesFim: optMes(o.mesFim ?? o.mes_fim),
      periodicidade: toPeriodicidade(o.periodicidade),
      origem: o.origem === "mantido" ? "mantido" : "novo",
      fornecedor: typeof o.fornecedor === "string" ? o.fornecedor : null,
      incluir: o.incluir !== false,
      // PRESERVA o cancelamento da diretoria. O sanitizador reconstrói o item
      // campo a campo, então tudo o que não for copiado aqui é DESCARTADO em
      // silêncio — e uma edição da proposta "descancelaria" o que a diretoria
      // cortou, sem erro e sem ninguém notar.
      ...(o.cancelado === true
        ? {
            cancelado: true as const,
            cancelado_motivo:
              typeof o.cancelado_motivo === "string" ? o.cancelado_motivo : null,
            cancelado_por: typeof o.cancelado_por === "string" ? o.cancelado_por : null,
          }
        : {}),
    });
  });
  return out;
}

/** Lê a proposta persistida (jsonb) da coluna `proposta`. Uma proposta com
 * `itens: []` (categoria ZERADA — ex.: Bônus sem sócio mantido) é VÁLIDA e deve
 * ser retornada (resultado zero), NÃO tratada como "sem proposta". Só devolve
 * null quando a coluna não é uma proposta (null/sem `itens` array). */
function parsePropostaColumn(raw: unknown): PlanejamentoProposta | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as { itens?: unknown; justificativa?: unknown };
  if (!Array.isArray(o.itens)) return null;
  return {
    itens: sanitizeItensProposta(o.itens),
    justificativa: typeof o.justificativa === "string" ? o.justificativa : "",
  };
}

/** Total anual de uma proposta (soma das séries de cada item). */
function propostaTotal(p: PlanejamentoProposta | null): number {
  if (!p) return 0;
  return categoriaTotal(
    p.itens.map((i) => ({
      valorMensal: i.valorMensal,
      mesInicio: i.mesInicio,
      periodicidade: i.periodicidade,
      mesFim: i.mesFim ?? null,
    })),
  );
}

function parseAiReply(text: string): {
  reply: string;
  proposta: PlanejamentoProposta | null;
  podeFechar: boolean;
} {
  let t = (text ?? "").trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) t = t.slice(start, end + 1);

  let obj: unknown;
  try {
    obj = JSON.parse(t);
  } catch {
    return {
      reply: (text ?? "").trim() || "Pode me contar um pouco mais sobre essa despesa?",
      proposta: null,
      podeFechar: false,
    };
  }

  const reply =
    obj && typeof obj === "object" && typeof (obj as { reply?: unknown }).reply === "string"
      ? ((obj as { reply: string }).reply as string)
      : "";

  const rawProposta = obj && typeof obj === "object" ? (obj as { proposta?: unknown }).proposta : null;
  let proposta: PlanejamentoProposta | null = null;
  // A proposta é aceita quando vem um OBJETO com `itens` array — MESMO vazio.
  // itens:[] = categoria ZERADA (ex.: Bônus sem sócio mantido), que é um
  // resultado LEGÍTIMO e precisa fechar a Etapa 3. Só `proposta: null` (ainda
  // perguntando / falta dado) NÃO gera proposta.
  if (rawProposta && typeof rawProposta === "object" && Array.isArray((rawProposta as { itens?: unknown }).itens)) {
    const itens = sanitizeItensProposta((rawProposta as { itens?: unknown }).itens);
    const justificativa = (rawProposta as { justificativa?: unknown }).justificativa;
    proposta = { itens, justificativa: typeof justificativa === "string" ? justificativa : "" };
  }

  const flagFechar =
    typeof obj === "object" && obj !== null && (obj as { podeFechar?: unknown }).podeFechar === true;
  const podeFechar = flagFechar || proposta != null;

  return { reply: reply || "…", proposta, podeFechar };
}

async function resolvePlanejamentoProvider() {
  try {
    return await resolveAiProvider({ forceProvider: "gemini", capability: "text" });
  } catch {
    return await resolveAiProvider({ capability: "text" });
  }
}

/**
 * Resolve o SETOR do orçamento até o departamento da Omie, para filtrar os
 * fornecedores do ano anterior. A corrente é:
 *   orcamento_setores.ctrl_sector_id -> ctrl_sector_omie_departamento
 *     -> codigo_departamento (o mesmo de financial_entries.department_code)
 *
 * Devolve também se o setor é o "Não atribuído", que é onde caem os
 * fornecedores sem departamento ou espalhados por vários.
 */
async function resolverDepartamentoDoSetor(
  supabase: Awaited<ReturnType<typeof createClient>>,
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

/**
 * Mantém só os fornecedores que pertencem ao setor.
 *
 * Setor com departamento vinculado leva os fornecedores DAQUELE departamento.
 * O "Não atribuído" recolhe o resto: fornecedor sem departamento no
 * lançamento e fornecedor com lançamentos em vários departamentos (a função
 * do banco devolve `departamento: null` nos dois casos).
 *
 * Setor sem vínculo com o Compras não tem como filtrar — recebe a lista
 * inteira, que é o comportamento anterior à Fase 1 e falha para o lado de
 * mostrar demais, não de esconder.
 */
function filtrarPorSetor(
  itens: PlanejamentoRealizadoItem[],
  ctx: { departamento: string | null; ehNaoAtribuido: boolean; temVinculo: boolean },
): PlanejamentoRealizadoItem[] {
  if (ctx.ehNaoAtribuido) return itens.filter((i) => !i.departamento);
  if (!ctx.temVinculo) return itens;
  return itens.filter((i) => i.departamento === ctx.departamento);
}

async function fetchRealizadoItens(
  supabase: Awaited<ReturnType<typeof createClient>>,
  companyId: string,
  baseYear: number,
  categoryCode: string,
): Promise<PlanejamentoRealizadoItem[]> {
  const fechados = mesesFechados(baseYear);
  const { data, error } = await supabase.rpc("orcamento_planejamento_realizado_itens", {
    p_company_id: companyId,
    p_base_year: baseYear,
    p_category_code: categoryCode,
    p_meses_fechados: fechados,
  });
  if (error) return [];
  return ((data ?? []) as Array<{
    fornecedor: string;
    total: number | string;
    total_fechado: number | string | null;
    lancamentos: number | string;
    departamento: string | null;
  }>).map((r) => {
    const total = Number(r.total) || 0;
    const totalFechado = Number(r.total_fechado) || 0;
    return {
      fornecedor: String(r.fornecedor),
      total,
      media: fechados > 0 && totalFechado > 0 ? totalFechado / fechados : null,
      lancamentos: Number(r.lancamentos) || 0,
      // null = lançamento sem departamento OU fornecedor espalhado por
      // vários; nos dois casos vai para "Não atribuído".
      departamento: r.departamento == null ? null : String(r.departamento),
    };
  });
}

/**
 * TOTAL gasto no ano inteiro (todos os meses com dado, não só os fechados)
 * somando os códigos irmãos. É o "total gasto no ano anterior" que o gestor
 * espera — diferente do total de MESES FECHADOS usado pela Média. `abs` porque
 * despesa pode vir com sinal negativo em financial_entries.
 */
function totalGastoAno(map: Map<string, MediaRealizado>, codes: string[]): number {
  let soma = 0;
  for (const code of codes) {
    const r = map.get(code);
    if (!r) continue;
    for (let i = 0; i < 12; i += 1) soma += r.meses[i] ?? 0;
  }
  return Math.round(Math.abs(soma) * 100) / 100;
}

/** Soma o realizado (mês a mês) de vários códigos num único MediaRealizado. */
function combinarRealizados(
  map: Map<string, MediaRealizado>,
  codes: string[],
  baseYear: number,
): MediaRealizado {
  const meses = Array<number | null>(12).fill(null);
  let algum = false;
  for (const code of codes) {
    const r = map.get(code);
    if (!r) continue;
    algum = true;
    for (let i = 0; i < 12; i += 1) {
      const v = r.meses[i];
      if (v != null) meses[i] = (meses[i] ?? 0) + v;
    }
  }
  if (!algum) return REALIZADO_VAZIO;
  return resumirRealizado(meses, mesesFechados(baseYear));
}

/** Fornecedores do ano anterior somando TODOS os códigos irmãos (merge por nome). */
async function fetchRealizadoItensIrmaos(
  supabase: Awaited<ReturnType<typeof createClient>>,
  companyId: string,
  baseYear: number,
  codes: string[],
): Promise<PlanejamentoRealizadoItem[]> {
  const listas = await Promise.all(codes.map((c) => fetchRealizadoItens(supabase, companyId, baseYear, c)));
  const byForn = new Map<string, PlanejamentoRealizadoItem>();
  for (const lista of listas) {
    for (const it of lista) {
      const key = it.fornecedor.toLocaleLowerCase("pt-BR");
      const cur = byForn.get(key);
      if (!cur) {
        byForn.set(key, { ...it });
      } else {
        cur.total += it.total;
        cur.lancamentos += it.lancamentos;
        if (it.media != null) cur.media = (cur.media ?? 0) + it.media;
        // Departamentos divergentes entre as irmãs: o fornecedor deixa de
        // pertencer a um setor com segurança.
        if (cur.departamento !== it.departamento) cur.departamento = null;
      }
    }
  }
  return Array.from(byForn.values()).sort((a, b) => b.total - a.total);
}

// ─── Leitura: lista (landing) ───────────────────────────────────────────────────

/**
 * A linha (categoria × setor) está travada pela diretoria?
 *
 * O item do planejamento não tem linha própria — vive no jsonb `proposta` —,
 * então a trava mora na categoria × setor, que é justamente o que o construtor
 * edita. Sem esta checagem, ele reescreveria a proposta inteira e desfaria a
 * decisão da diretoria em silêncio.
 */
async function travaDaDiretoria(
  supabase: Awaited<ReturnType<typeof createClient>>,
  papel: OrcamentoPapel,
  companyId: string,
  year: number,
  categoryCode: string,
  setorId: string | null,
): Promise<string | null> {
  let q = supabase
    .from("orcamento_planejamento_socios")
    .select("diretoria_travado")
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("category_code", categoryCode);
  q = setorId ? q.eq("setor_id", setorId) : q.is("setor_id", null);
  const { data } = await q.maybeSingle();
  if (!data) return null; // linha nova: nada a travar
  const r = podeEscreverNoItem(papel, data as { diretoria_travado?: boolean | null });
  return r.pode ? null : r.motivo ?? "Item travado pela diretoria.";
}

export async function getPlanejamentoSocios(
  companyId: string,
  year: number,
  /** Setor da tela: cada categoria é planejada por setor. */
  setorId: string | null = null,
): Promise<{ items?: PlanejamentoListItem[]; error?: string; needsMigration?: boolean }> {
  if (!companyId) return { items: [] };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const supabaseAuth = createAdminClientIfAvailable() ?? (await createClient());
  const authLeitura = await autorizarLeitura(supabaseAuth, companyId, year);
  if (!authLeitura.ok) return { error: authLeitura.error };

  const cats = await getCategoriaMetodo(companyId, year);
  if (cats.needsMigration) return { needsMigration: true };
  if (cats.error) return { error: cats.error };
  const doMetodoTodos = (cats.items ?? []).filter((c) => c.metodo === "planejamento_socios");
  // Salvaguarda: a regra é marcar só a categoria canônica (sem "(*)"); o gasto da
  // gêmea "(*)" já é somado no card dela (codigosIrmaos). Se por engano a "(*)"
  // também foi marcada com o método E a canônica está presente, NÃO gera um card
  // duplicado para a "(*)" — evitaria dupla contagem no total/progresso. Se só a
  // "(*)" tiver o método (sem a canônica), o card dela é mantido.
  const canonicas = apenasCanonicas(doMetodoTodos);

  // Só as categorias atribuídas a ESTE setor (tela Método por categoria).
  // Empresa sem "Orçar por setor": as linhas existem num setor-balde, mas a
  // tela manda setor nulo — e `.eq("setor_id", null)` vira `eq.null` no
  // PostgREST, que não casa com NADA. Filtrar aí esvaziaria a tela inteira.
  const porSetorLista = await orcaPorSetor(
    createAdminClientIfAvailable() ?? (await createClient()),
    companyId,
    year,
  );
  let doMetodo = canonicas;
  if (porSetorLista && setorId) {
    const { data: atrib, error: atribErr } = await (createAdminClientIfAvailable() ??
      (await createClient()))
      .from("orcamento_categoria_setores")
      .select("category_code")
      .eq("company_id", companyId)
      .eq("year", year)
      .eq("setor_id", setorEspecifico(setorId));
    if (atribErr && !isSchemaMissing(atribErr.message)) return { error: atribErr.message };
    const permitidas = new Set((atrib ?? []).map((r) => r.category_code as string));
    doMetodo = canonicas.filter((c) => permitidas.has(c.categoryCode));
  }

  const supabase = createAdminClientIfAvailable() ?? (await createClient());

  let catQuery = supabase
    .from("orcamento_planejamento_socios")
    .select("category_code, base_salva, proposta, proposta_confirmada, setor_id")
    .eq("company_id", companyId)
    .eq("year", year);
  if (porSetorLista) catQuery = catQuery.eq("setor_id", setorEspecifico(setorId));
  const { data: catRows, error: catErr } = await catQuery;
  if (catErr) {
    if (isSchemaMissing(catErr.message)) return { needsMigration: true };
    return { error: catErr.message };
  }
  const byCode = new Map<
    string,
    {
      baseSalva: boolean;
      proposta: PlanejamentoProposta | null;
      confirmada: boolean;
      setorId: string | null;
    }
  >();
  ((catRows ?? []) as {
    category_code: string;
    base_salva: boolean | null;
    proposta: unknown;
    proposta_confirmada: boolean | null;
    setor_id: string | null;
  }[]).forEach((r) =>
    byCode.set(r.category_code, {
      baseSalva: r.base_salva === true,
      proposta: parsePropostaColumn(r.proposta),
      confirmada: r.proposta_confirmada === true,
      setorId: r.setor_id ?? null,
    }),
  );

  // Realizado por categoria já somando as irmãs "(*)" — busca a UNIÃO dos códigos
  // irmãos de todas as categorias do método e combina por categoria.
  const irmaosPorCat = new Map<string, string[]>();
  const todosCodigos = new Set<string>();
  doMetodo.forEach((c) => {
    const irmaos = codigosIrmaos(cats.items ?? [], c.categoryCode, c.categoryName);
    irmaosPorCat.set(c.categoryCode, irmaos);
    irmaos.forEach((code) => todosCodigos.add(code));
  });
  const realizados = await fetchRealizados(supabase, companyId, year - 1, Array.from(todosCodigos));

  const items: PlanejamentoListItem[] = doMetodo.map((c) => {
    const st = byCode.get(c.categoryCode);
    const codigos = irmaosPorCat.get(c.categoryCode) ?? [c.categoryCode];
    const r = combinarRealizados(realizados, codigos, year - 1);
    const totalAno = totalGastoAno(realizados, codigos);
    return {
      categoryCode: c.categoryCode,
      categoryName: c.categoryName,
      dreLineCode: c.dreLineCode,
      dreLineName: c.dreLineName,
      baseSalva: st?.baseSalva ?? false,
      temProposta: !!st?.proposta,
      propostaConfirmada: st?.confirmada ?? false,
      itemCount: st?.proposta?.itens.length ?? 0,
      totalOrcado: propostaTotal(st?.proposta ?? null),
      realizadoAnterior: totalAno > 0 || r.media != null ? { total: totalAno, media: r.media, meses: r.meses } : null,
      // Itens da proposta CONFIRMADA: é o que vira orçamento, e é o que a
      // diretoria aprova um a um. Proposta não confirmada não é orçamento.
      itensProposta:
        st?.confirmada && st.proposta
          ? st.proposta.itens.map((it, indice) => {
              const meses = serieItem(
                it.valorMensal,
                it.mesInicio,
                it.periodicidade,
                it.mesFim ?? null,
              );
              return {
                indice,
                descricao: it.descricao,
                valorMensal: it.valorMensal,
                periodicidade: it.periodicidade,
                periodicidadeLabel: periodicidadeLabel(it.periodicidade),
                mesInicio: it.mesInicio,
                mesFim: it.mesFim ?? null,
                meses,
                totalAno: meses.reduce((a, b) => a + b, 0),
                cancelado: it.cancelado === true,
                canceladoMotivo: it.cancelado_motivo ?? null,
              };
            })
          : [],
      setorId: st?.setorId ?? null,
    };
  });

  return { items };
}

// ─── Leitura: detalhe de uma categoria ──────────────────────────────────────────

export async function getPlanejamentoCategoria(
  companyId: string,
  year: number,
  categoryCode: string,
  /** Setor da tela — a linha de planejamento pertence a ele. */
  setorId: string | null = null,
): Promise<{ detalhe?: PlanejamentoCategoriaDetalhe; error?: string; needsMigration?: boolean }> {
  if (!companyId || !categoryCode) return { error: "Categoria inválida." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const supabaseAuth = createAdminClientIfAvailable() ?? (await createClient());
  const authLeitura = await autorizarLeitura(supabaseAuth, companyId, year);
  if (!authLeitura.ok) return { error: authLeitura.error };

  const cats = await getCategoriaMetodo(companyId, year);
  if (cats.needsMigration) return { needsMigration: true };
  if (cats.error) return { error: cats.error };
  const cat = (cats.items ?? []).find((c) => c.categoryCode === categoryCode);
  if (!cat) return { error: "Categoria não encontrada para este método." };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());

  // Ver getPlanejamentoSocios: sem orçar por setor a tela manda setor nulo, e
  // filtrar por ele não traria linha nenhuma. A empresa tem uma linha só por
  // categoria nesse caso, então o maybeSingle continua válido.
  const porSetorDetalhe = await orcaPorSetor(supabase, companyId, year);
  let catQ = supabase
    .from("orcamento_planejamento_socios")
    .select(
      "category_code, category_name, justificativa, conversa, status, base_salva, contexto_admin, proposta, proposta_confirmada",
    )
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("category_code", categoryCode);
  if (porSetorDetalhe) catQ = catQ.eq("setor_id", setorEspecifico(setorId));
  const { data: catRow, error: catErr } = await catQ.maybeSingle<CategoriaRow>();
  if (catErr) {
    if (isSchemaMissing(catErr.message)) return { needsMigration: true };
    return { error: catErr.message };
  }

  let itensQ = supabase
    .from("orcamento_planejamento_socios_itens")
    .select("id, category_code, descricao, valor_mensal, mes_inicio, mes_fim, periodicidade, origem, fornecedor, incluir")
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("category_code", categoryCode);
  if (porSetorDetalhe) itensQ = itensQ.eq("setor_id", setorEspecifico(setorId));
  const { data: itemRows, error: itemErr } = await itensQ
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (itemErr) {
    if (isSchemaMissing(itemErr.message)) return { needsMigration: true };
    return { error: itemErr.message };
  }

  // Realizado do ano anterior somando a categoria + suas irmãs "(*)" (divisão
  // interna da contabilidade) — total e fornecedores completos.
  const irmaos = codigosIrmaos(cats.items ?? [], categoryCode, cat.categoryName);
  const [realizados, realizadoItensTodos, ctxSetor] = await Promise.all([
    fetchRealizados(supabase, companyId, year - 1, irmaos),
    fetchRealizadoItensIrmaos(supabase, companyId, year - 1, irmaos),
    resolverDepartamentoDoSetor(supabase, companyId, setorId),
  ]);
  // A base semeada é só dos fornecedores DESTE setor: o gestor do Comercial
  // não valida o que só o Produto usou.
  const realizadoItens = filtrarPorSetor(realizadoItensTodos, ctxSetor);
  const r = combinarRealizados(realizados, irmaos, year - 1);
  const totalAno = totalGastoAno(realizados, irmaos); // ano inteiro, não só meses fechados

  return {
    detalhe: {
      categoryCode,
      categoryName: cat.categoryName,
      dreLineCode: cat.dreLineCode,
      dreLineName: cat.dreLineName,
      itens: ((itemRows ?? []) as ItemRow[]).map(rowToItem),
      baseSalva: catRow?.base_salva === true,
      contextoAdmin: catRow?.contexto_admin ?? "",
      conversa: sanitizeConversa(catRow?.conversa),
      proposta: parsePropostaColumn(catRow?.proposta),
      propostaConfirmada: catRow?.proposta_confirmada === true,
      realizadoAnterior: totalAno > 0 || r.media != null ? { total: totalAno, media: r.media, meses: r.meses } : null,
      realizadoItens,
    },
  };
}

// ─── Entrevista (chat) ─────────────────────────────────────────────────────────

/**
 * Preparo COMPARTILHADO do turno de entrevista: monta o system prompt + o
 * histórico, resolvendo o contexto (linha DRE + realizado ano-1) pelo FAST PATH
 * (cliente manda `promptCtx`) ou pelo fallback server-side. `streaming` escolhe
 * o rabo do prompt (texto+marcador vs JSON). Usado pelo encerramento (JSON) e
 * pela rota de streaming.
 */
async function montarSistemaEntrevista(params: {
  companyId: string;
  year: number;
  categoryCode: string;
  categoryName: string;
  conversaAtual: PlanejamentoMensagem[];
  itensContexto: PlanejamentoContextoItem[];
  promptCtx?: PlanejamentoPromptContexto;
  streaming: boolean;
  /** Setor da linha de planejamento. */
  setorId: string | null;
}): Promise<
  | { system: string; historico: PlanejamentoMensagem[]; semBase: boolean }
  | { needsMigration: true }
  | { error: string }
> {
  const { companyId, year, categoryCode, categoryName, promptCtx, streaming, setorId } = params;
  const supabase = createAdminClientIfAvailable() ?? (await createClient());

  const contexto = (params.itensContexto ?? []).filter((i) => i.descricao.trim() !== "");
  // BASE VAZIA = admin validou a categoria sem itens → entrevista ABERTA.
  const semBase = contexto.length === 0;

  let ctxQ = supabase
    .from("orcamento_planejamento_socios")
    .select("contexto_admin")
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("category_code", categoryCode);
  if (await orcaPorSetor(supabase, companyId, year)) {
    ctxQ = ctxQ.eq("setor_id", setorEspecifico(setorId));
  }
  const ctxQuery = ctxQ.maybeSingle<{ contexto_admin: string | null }>();
  const companyQuery = supabase
    .from("companies")
    .select("name")
    .eq("id", companyId)
    .maybeSingle<{ name: string }>();

  let companyName: string;
  let nomeCategoria: string;
  let dreLineCode: string;
  let dreLineName: string;
  let realizadoCat: MediaRealizado;
  let contextoAdmin: string;

  // FAST PATH — o cliente já mandou a linha da DRE + o realizado do ano anterior
  // (constantes na conversa). Pulamos o catálogo de categorias e o realizado da
  // Omie, que antes rodavam a CADA mensagem só para remontar a mesma informação.
  if (promptCtx && Number.isFinite(promptCtx.realizadoTotal)) {
    const [companyRes, ctxRes] = await Promise.all([companyQuery, ctxQuery]);
    companyName = companyRes.data?.name ?? "Empresa";
    nomeCategoria = categoryName;
    dreLineCode = promptCtx.dreLineCode;
    dreLineName = promptCtx.dreLineName;
    const meses =
      Array.isArray(promptCtx.realizadoMeses) && promptCtx.realizadoMeses.length === 12
        ? promptCtx.realizadoMeses.map((v) => (typeof v === "number" && Number.isFinite(v) ? v : null))
        : REALIZADO_VAZIO.meses;
    realizadoCat = {
      ...REALIZADO_VAZIO,
      meses,
      mesesConsiderados: meses.filter((v) => v != null).length,
      total: promptCtx.realizadoTotal,
      media: promptCtx.realizadoMedia,
    };
    contextoAdmin = (ctxRes.data?.contexto_admin ?? "").trim();
  } else {
    // FALLBACK — computa tudo no servidor (catálogo + realizado da Omie).
    const [companyRes, cats, ctxRes] = await Promise.all([companyQuery, getCategoriaMetodo(companyId, year), ctxQuery]);
    companyName = companyRes.data?.name ?? "Empresa";
    const cat = (cats.items ?? []).find((c) => c.categoryCode === categoryCode);
    nomeCategoria = cat?.categoryName ?? categoryName;
    dreLineCode = cat?.dreLineCode ?? "";
    dreLineName = cat?.dreLineName ?? "";
    contextoAdmin = (ctxRes.data?.contexto_admin ?? "").trim();
    const irmaos = codigosIrmaos(cats.items ?? [], categoryCode, nomeCategoria);
    const realizados = await fetchRealizados(supabase, companyId, year - 1, irmaos);
    realizadoCat = { ...combinarRealizados(realizados, irmaos, year - 1), total: totalGastoAno(realizados, irmaos) };
  }

  const system = buildSystemPrompt({
    companyName,
    categoryName: nomeCategoria,
    dreLineCode,
    dreLineName,
    year,
    realizado: realizadoCat,
    itens: contexto,
    contextoAdmin,
    streaming,
  });

  return { system, historico: sanitizeConversa(params.conversaAtual), semBase };
}

export async function enviarMensagemPlanejamento(
  companyId: string,
  year: number,
  categoryCode: string,
  categoryName: string,
  conversaAtual: PlanejamentoMensagem[],
  textoUsuario: string,
  itensContexto: PlanejamentoContextoItem[] = [],
  finalizar = false,
  promptCtx?: PlanejamentoPromptContexto,
  /** Setor da tela — a linha de planejamento pertence a ele. */
  setorId: string | null = null,
): Promise<{
  reply?: string;
  proposta?: PlanejamentoProposta | null;
  podeFechar?: boolean;
  conversa?: PlanejamentoMensagem[];
  error?: string;
  needsMigration?: boolean;
}> {
  const supabaseAuth = createAdminClientIfAvailable() ?? (await createClient());
  const auth = await autorizarEscrita(supabaseAuth, companyId, year);
  if (!auth.ok) return { error: auth.error };
  const admin = { userId: auth.user.userId };
  if (!companyId || !categoryCode) return { error: "Categoria inválida." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  // Provedor resolve em paralelo com o preparo do prompt (não depende dele).
  const resolvedPromise = resolvePlanejamentoProvider();

  // Este caminho é o de ENCERRAR (finalizar=true), que produz a proposta em JSON.
  const prep = await montarSistemaEntrevista({
    setorId,
    companyId,
    year,
    categoryCode,
    categoryName,
    conversaAtual,
    itensContexto,
    promptCtx,
    streaming: false,
  });
  if ("needsMigration" in prep) return { needsMigration: true };
  if ("error" in prep) return { error: prep.error };
  const { system, historico } = prep;
  const texto = (textoUsuario ?? "").trim();
  const supabase = createAdminClientIfAvailable() ?? (await createClient());

  const messages: ModelMessage[] = historico.map((m) =>
    m.role === "user" ? { role: "user", content: m.content } : { role: "assistant", content: m.content },
  );
  if (texto) {
    messages.push({ role: "user", content: texto });
  } else if (messages.length === 0 && !finalizar) {
    messages.push({ role: "user", content: "Inicie a entrevista fazendo a primeira pergunta." });
  }
  // O gestor clicou "Concluir entrevista e gerar proposta": mande a IA FECHAR a
  // proposta agora com tudo que já foi dito. Só se faltar dado OBRIGATÓRIO de um
  // item NOVO ela pode perguntar em vez de propor.
  if (finalizar) {
    messages.push({
      role: "user",
      content:
        "Encerrar a entrevista AGORA. Com base em TUDO que já foi respondido, monte a proposta " +
        "final (campo 'proposta' PREENCHIDO no JSON): todos os itens mantidos com o valor/mês " +
        "confirmados, mais os itens novos completos, sem os que eu disse não manter. Se NÃO houver " +
        "nenhum item (categoria zerada), devolva 'proposta' com \"itens\": [] (lista vazia) e uma " +
        "justificativa — NÃO devolva proposta null. Só devolva proposta null se faltar algum dado " +
        "OBRIGATÓRIO (nome, valor, mensal/anual, mês, justificativa) de um item NOVO — nesse caso " +
        "pergunte apenas o que falta.",
    });
  }

  const resolved = await resolvedPromise; // já resolvendo em paralelo desde o início
  let replyText: string;
  let usageOk: Awaited<ReturnType<typeof generateText>>["usage"] | null = null;
  try {
    const { text, usage } = await generateText({
      model: resolved.provider.chat(resolved.modelName),
      system,
      messages,
      temperature: 0.4,
    });
    replyText = text;
    usageOk = usage;
  } catch (e) {
    await logResolvedUsage(resolved, "orcamento", null, {
      companyId,
      userId: admin.userId,
      success: false,
      errorMessage: e instanceof Error ? e.message : String(e),
    });
    return { error: `Falha ao consultar a IA: ${e instanceof Error ? e.message : String(e)}` };
  }

  const parsed = parseAiReply(replyText);
  const reply = parsed.reply;
  const podeFechar = parsed.podeFechar;
  // A proposta (Etapa 3) SÓ é aceita quando o gestor ENCERRA a entrevista
  // (finalizar). Durante o chat, mesmo que a IA escorregue e mande uma proposta,
  // ela é ignorada — quem destrava a Etapa 3 é o botão "Concluir".
  const proposta = finalizar ? parsed.proposta : null;

  const novaConversa: PlanejamentoMensagem[] = [
    ...historico,
    ...(texto ? [{ role: "user" as const, content: texto }] : []),
    { role: "assistant" as const, content: reply },
  ];

  // Persiste a conversa sempre; e, quando a proposta é fechada (Etapa 3), grava-a
  // na coluna jsonb e DESCONGELA (proposta_confirmada=false) — proposta nova pede
  // nova confirmação. A BASE (itens) NÃO é tocada aqui.
  // A chave do upsert inclui o setor, e NULL nunca casa com a linha anterior —
  // gravaria uma conversa nova a cada turno. Ver setor-gravacao.ts.
  const alvo = await setorParaGravar(supabase, companyId, year, setorId, admin.userId);
  // O destino só é conhecido aqui ("Todos os setores" cai no balde "Não
  // atribuído", que não pertence a gerente nenhum).
  if (!podeEscreverNoSetor(auth.setores, alvo.id)) return { error: SEM_ACESSO_SETOR };
  const travado = await travaDaDiretoria(
    supabase,
    auth.user.papel,
    companyId,
    year,
    categoryCode,
    alvo.id,
  );
  if (travado) return { error: travado };
  if (alvo.error) return { error: alvo.error };

  const payload: Record<string, unknown> = {
    company_id: companyId,
    year,
    category_code: categoryCode,
    setor_id: alvo.id,
    category_name: categoryName,
    conversa: novaConversa,
    updated_by: admin.userId,
  };
  if (proposta) {
    payload.proposta = proposta;
    payload.proposta_confirmada = false;
    payload.status = "rascunho";
  }

  // Grava a conversa e registra o uso da IA em PARALELO.
  const [upsertRes] = await Promise.all([
    supabase.from("orcamento_planejamento_socios").upsert(payload, { onConflict: "company_id,year,category_code,setor_id" }),
    logResolvedUsage(resolved, "orcamento", usageOk, { companyId, userId: admin.userId }),
  ]);
  const upErr = upsertRes.error;
  if (upErr) {
    if (isSchemaMissing(upErr.message)) return { needsMigration: true };
    return { reply, proposta, podeFechar, conversa: novaConversa, error: upErr.message };
  }

  revalidatePath(PATH);
  return { reply, proposta, podeFechar, conversa: novaConversa };
}

/**
 * STREAMING (turno de entrevista) — monta o `system` + `messages` (serializáveis)
 * para a ROTA `/api/orcamento/planejamento/chat` fazer o `streamText`. NÃO chama
 * a IA nem persiste aqui: a rota resolve o provedor, faz o streaming e persiste
 * a conversa no `onFinish` via `persistirConversaEntrevista`. A resposta é TEXTO
 * corrido; o fim da entrevista vem do marcador [[FECHAR]] (ver planejamento-calc).
 */
export async function montarPromptEntrevista(
  companyId: string,
  year: number,
  categoryCode: string,
  categoryName: string,
  conversaAtual: PlanejamentoMensagem[],
  textoUsuario: string,
  itensContexto: PlanejamentoContextoItem[] = [],
  promptCtx?: PlanejamentoPromptContexto,
  /** Setor da tela — a linha de planejamento pertence a ele. */
  setorId: string | null = null,
): Promise<{
  system?: string;
  messages?: Array<{ role: "user" | "assistant"; content: string }>;
  error?: string;
  needsMigration?: boolean;
}> {
  // Monta o prompt da entrevista — não grava nada, mas exige permissão de
  // ESCRITA: conduzir a entrevista é construir o orçamento daquele setor.
  const supabaseAuth = createAdminClientIfAvailable() ?? (await createClient());
  const auth = await autorizarEscrita(supabaseAuth, companyId, year);
  if (!auth.ok) return { error: auth.error };
  if (!companyId || !categoryCode) return { error: "Categoria inválida." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const prep = await montarSistemaEntrevista({
    setorId,
    companyId,
    year,
    categoryCode,
    categoryName,
    conversaAtual,
    itensContexto,
    promptCtx,
    streaming: true,
  });
  if ("needsMigration" in prep) return { needsMigration: true };
  if ("error" in prep) return { error: prep.error };

  const texto = (textoUsuario ?? "").trim();
  const messages: Array<{ role: "user" | "assistant"; content: string }> = prep.historico.map((m) =>
    m.role === "user" ? { role: "user", content: m.content } : { role: "assistant", content: m.content },
  );
  if (texto) {
    messages.push({ role: "user", content: texto });
  } else if (messages.length === 0) {
    messages.push({ role: "user", content: "Inicie a entrevista fazendo a primeira pergunta." });
  }

  return { system: prep.system, messages };
}

/**
 * Persiste a conversa da entrevista (SEM tocar em proposta/base/status).
 * Chamado pelo `onFinish` do streaming, com a conversa completa já montada
 * (a resposta da IA já sem o marcador [[FECHAR]]).
 */
export async function persistirConversaEntrevista(
  companyId: string,
  year: number,
  categoryCode: string,
  categoryName: string,
  conversa: PlanejamentoMensagem[],
  /** Setor da tela — a linha de planejamento pertence a ele. */
  setorId: string | null = null,
): Promise<{ ok?: true; error?: string; needsMigration?: boolean }> {
  const supabaseAuth = createAdminClientIfAvailable() ?? (await createClient());
  const auth = await autorizarEscrita(supabaseAuth, companyId, year);
  if (!auth.ok) return { error: auth.error };
  const admin = { userId: auth.user.userId };
  // "Todos os setores" é só leitura: sem setor de destino a linha nasceria órfã.
  if (isTodosSetores(setorId)) {
    return { error: "Escolha um setor para editar — \"Todos os setores\" é só leitura." };
  }
  if (!companyId || !categoryCode) return { error: "Categoria inválida." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());
  const alvo = await setorParaGravar(supabase, companyId, year, setorId, admin.userId);
  // O destino só é conhecido aqui ("Todos os setores" cai no balde "Não
  // atribuído", que não pertence a gerente nenhum).
  if (!podeEscreverNoSetor(auth.setores, alvo.id)) return { error: SEM_ACESSO_SETOR };
  const travado = await travaDaDiretoria(
    supabase,
    auth.user.papel,
    companyId,
    year,
    categoryCode,
    alvo.id,
  );
  if (travado) return { error: travado };
  if (alvo.error) return { error: alvo.error };
  const { error } = await supabase.from("orcamento_planejamento_socios").upsert(
    {
      company_id: companyId,
      year,
      category_code: categoryCode,
      setor_id: alvo.id,
      category_name: categoryName,
      conversa: sanitizeConversa(conversa),
      updated_by: admin.userId,
    },
    { onConflict: "company_id,year,category_code,setor_id" },
  );
  if (error) {
    if (isSchemaMissing(error.message)) return { needsMigration: true };
    return { error: error.message };
  }
  revalidatePath(PATH);
  return { ok: true };
}

// ─── Salvar / remover ──────────────────────────────────────────────────────────

/**
 * ETAPA 1 — grava a BASE (o que a IA deve considerar) e a marca como FINALIZADA
 * (base_salva=true), o que habilita a entrevista. Persiste TODAS as linhas —
 * inclusive as EXCLUÍDAS (incluir=false), para lembrar as exclusões; só as
 * incluídas viram contexto da IA. NÃO mexe na proposta (Etapa 3).
 */
export async function salvarBasePlanejamento(
  companyId: string,
  year: number,
  categoryCode: string,
  categoryName: string,
  itens: PlanejamentoItemProposto[],
  contextoAdmin = "",
  /** Setor da tela — a linha de planejamento pertence a ele. */
  setorId: string | null = null,
): Promise<{ ok?: true; error?: string; needsMigration?: boolean }> {
  const supabaseAuth = createAdminClientIfAvailable() ?? (await createClient());
  const auth = await autorizarEscrita(supabaseAuth, companyId, year);
  if (!auth.ok) return { error: auth.error };
  const admin = { userId: auth.user.userId };
  // "Todos os setores" é só leitura: sem setor de destino a linha nasceria órfã.
  if (isTodosSetores(setorId)) {
    return { error: "Escolha um setor para editar — \"Todos os setores\" é só leitura." };
  }
  if (!companyId || !categoryCode) return { error: "Categoria inválida." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  // A base PODE ser vazia (categorias sem contratos/assinaturas pré-existentes,
  // ex.: Consultoria e Treinamento) — nesse caso a entrevista é aberta. Não há
  // trava de "mínimo 1 item".
  const limpos = sanitizeItensProposta(itens).filter((i) => i.descricao.trim() !== "");
  const ctx = contextoAdmin.trim();

  const supabase = createAdminClientIfAvailable() ?? (await createClient());

  const alvo = await setorParaGravar(supabase, companyId, year, setorId, admin.userId);
  // O destino só é conhecido aqui ("Todos os setores" cai no balde "Não
  // atribuído", que não pertence a gerente nenhum).
  if (!podeEscreverNoSetor(auth.setores, alvo.id)) return { error: SEM_ACESSO_SETOR };
  const travado = await travaDaDiretoria(
    supabase,
    auth.user.papel,
    companyId,
    year,
    categoryCode,
    alvo.id,
  );
  if (travado) return { error: travado };
  if (alvo.error) return { error: alvo.error };

  const { error: catErr } = await supabase.from("orcamento_planejamento_socios").upsert(
    {
      company_id: companyId,
      year,
      category_code: categoryCode,
      setor_id: alvo.id,
      category_name: categoryName,
      base_salva: true,
      contexto_admin: ctx || null,
      updated_by: admin.userId,
    },
    { onConflict: "company_id,year,category_code,setor_id" },
  );
  if (catErr) {
    if (isSchemaMissing(catErr.message)) return { needsMigration: true };
    return { error: catErr.message };
  }

  const { error: delErr } = await supabase
    .from("orcamento_planejamento_socios_itens")
    .delete()
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("category_code", categoryCode)
    .eq("setor_id", alvo.id);
  if (delErr) return { error: delErr.message };

  const rows = limpos.map((i) => ({
    company_id: companyId,
    year,
    category_code: categoryCode,
    setor_id: alvo.id,
    descricao: i.descricao.trim(),
    valor_mensal: i.valorMensal,
    mes_inicio: i.mesInicio,
    mes_fim: i.periodicidade === "anual" ? null : i.mesFim ?? null,
    periodicidade: i.periodicidade,
    origem: i.origem,
    fornecedor: i.fornecedor ?? null,
    incluir: i.incluir !== false,
    updated_by: admin.userId,
  }));
  const { error: insErr } = await supabase.from("orcamento_planejamento_socios_itens").insert(rows);
  if (insErr) return { error: insErr.message };

  await registrarAlteracao({
    companyId,
    year,
    cicloId: auth.cicloId,
    categoryCode,
    setorId: alvo.id,
    metodo: "planejamento_socios",
    alvoTipo: "planejamento_item",
    alvoRotulo: `Base de ${categoryName} (${rows.length} item(ns))`,
    acao: "alterou",
    fase: auth.fase,
    depois: { itens: rows.length, contexto_admin: (contextoAdmin ?? "").trim() || null },
    autorId: auth.user.userId,
    autorPapel: auth.user.papel,
  });
  revalidatePath(PATH);
  return { ok: true };
}

/**
 * ETAPA 3 — CONFIRMA a proposta (congela). Depois disso ela vai para a Prévia e
 * só o admin altera os números (via editarPropostaPlanejamento).
 */
export async function confirmarPropostaPlanejamento(
  companyId: string,
  year: number,
  categoryCode: string,
  /** Setor da tela — a linha de planejamento pertence a ele. */
  setorId: string | null = null,
): Promise<{ ok?: true; error?: string; needsMigration?: boolean }> {
  const supabaseAuth = createAdminClientIfAvailable() ?? (await createClient());
  const auth = await autorizarEscrita(supabaseAuth, companyId, year);
  if (!auth.ok) return { error: auth.error };
  const admin = { userId: auth.user.userId };
  // "Todos os setores" é só leitura: sem setor de destino a linha nasceria órfã.
  if (isTodosSetores(setorId)) {
    return { error: "Escolha um setor para editar — \"Todos os setores\" é só leitura." };
  }
  if (!companyId || !categoryCode) return { error: "Categoria inválida." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());
  const alvo = await setorParaGravar(supabase, companyId, year, setorId, admin.userId);
  // O destino só é conhecido aqui ("Todos os setores" cai no balde "Não
  // atribuído", que não pertence a gerente nenhum).
  if (!podeEscreverNoSetor(auth.setores, alvo.id)) return { error: SEM_ACESSO_SETOR };
  const travado = await travaDaDiretoria(
    supabase,
    auth.user.papel,
    companyId,
    year,
    categoryCode,
    alvo.id,
  );
  if (travado) return { error: travado };
  if (alvo.error) return { error: alvo.error };
  const { error } = await supabase
    .from("orcamento_planejamento_socios")
    .update({
      proposta_confirmada: true,
      proposta_confirmada_por: admin.userId,
      status: "concluido",
      updated_by: admin.userId,
    })
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("category_code", categoryCode)
    .eq("setor_id", alvo.id);
  if (error) {
    if (isSchemaMissing(error.message)) return { needsMigration: true };
    return { error: error.message };
  }
  // Confirmar é o momento em que a proposta VIRA orçamento (é o que a Prévia
  // lê) — o registro mais importante deste método.
  await registrarAlteracao({
    companyId,
    year,
    cicloId: auth.cicloId,
    categoryCode,
    setorId: alvo.id,
    metodo: "planejamento_socios",
    alvoTipo: "planejamento_item",
    alvoRotulo: `Proposta de ${categoryCode} confirmada`,
    acao: "alterou",
    fase: auth.fase,
    depois: { proposta_confirmada: true },
    autorId: auth.user.userId,
    autorPapel: auth.user.papel,
  });
  revalidatePath(PATH);
  return { ok: true };
}

/**
 * ETAPA 3 (admin) — edita os NÚMEROS da proposta. Reescreve a coluna `proposta`
 * (jsonb) e mantém a confirmação.
 */
export async function editarPropostaPlanejamento(
  companyId: string,
  year: number,
  categoryCode: string,
  itens: PlanejamentoItemProposto[],
  justificativa: string,
  /** Setor da tela — a linha de planejamento pertence a ele. */
  setorId: string | null = null,
): Promise<{ ok?: true; error?: string; needsMigration?: boolean }> {
  const supabaseAuth = createAdminClientIfAvailable() ?? (await createClient());
  const auth = await autorizarEscrita(supabaseAuth, companyId, year);
  if (!auth.ok) return { error: auth.error };
  const admin = { userId: auth.user.userId };
  // "Todos os setores" é só leitura: sem setor de destino a linha nasceria órfã.
  if (isTodosSetores(setorId)) {
    return { error: "Escolha um setor para editar — \"Todos os setores\" é só leitura." };
  }
  if (!companyId || !categoryCode) return { error: "Categoria inválida." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const limpos = sanitizeItensProposta(itens).filter((i) => i.descricao.trim() !== "");
  if (limpos.length === 0) return { error: "A proposta precisa de ao menos um item." };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());
  const alvo = await setorParaGravar(supabase, companyId, year, setorId, admin.userId);
  // O destino só é conhecido aqui ("Todos os setores" cai no balde "Não
  // atribuído", que não pertence a gerente nenhum).
  if (!podeEscreverNoSetor(auth.setores, alvo.id)) return { error: SEM_ACESSO_SETOR };
  const travado = await travaDaDiretoria(
    supabase,
    auth.user.papel,
    companyId,
    year,
    categoryCode,
    alvo.id,
  );
  if (travado) return { error: travado };
  if (alvo.error) return { error: alvo.error };
  const { error } = await supabase
    .from("orcamento_planejamento_socios")
    .update({
      proposta: { itens: limpos, justificativa: (justificativa ?? "").trim() },
      updated_by: admin.userId,
    })
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("category_code", categoryCode)
    .eq("setor_id", alvo.id);
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
    alvoRotulo: `Proposta de ${categoryCode}`,
    acao: "alterou",
    fase: auth.fase,
    depois: {
      itens: limpos.length,
      total_mensal: limpos.reduce((a, i) => a + (i.valorMensal ?? 0), 0),
    },
    autorId: auth.user.userId,
    autorPapel: auth.user.papel,
  });
  revalidatePath(PATH);
  return { ok: true };
}

/**
 * Reinicia SOMENTE a entrevista com a IA: zera a conversa E a proposta (saída da
 * entrevista), mantendo intacta a BASE (Etapa 1) que o admin salvou.
 */
export async function reiniciarConversaPlanejamento(
  companyId: string,
  year: number,
  categoryCode: string,
  /** Setor da tela — a linha de planejamento pertence a ele. */
  setorId: string | null = null,
): Promise<{ ok?: true; error?: string; needsMigration?: boolean }> {
  const supabaseAuth = createAdminClientIfAvailable() ?? (await createClient());
  const auth = await autorizarEscrita(supabaseAuth, companyId, year);
  if (!auth.ok) return { error: auth.error };
  const admin = { userId: auth.user.userId };
  // "Todos os setores" é só leitura: sem setor de destino a linha nasceria órfã.
  if (isTodosSetores(setorId)) {
    return { error: "Escolha um setor para editar — \"Todos os setores\" é só leitura." };
  }
  if (!companyId || !categoryCode) return { error: "Categoria inválida." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());
  const alvo = await setorParaGravar(supabase, companyId, year, setorId, admin.userId);
  // O destino só é conhecido aqui ("Todos os setores" cai no balde "Não
  // atribuído", que não pertence a gerente nenhum).
  if (!podeEscreverNoSetor(auth.setores, alvo.id)) return { error: SEM_ACESSO_SETOR };
  const travado = await travaDaDiretoria(
    supabase,
    auth.user.papel,
    companyId,
    year,
    categoryCode,
    alvo.id,
  );
  if (travado) return { error: travado };
  if (alvo.error) return { error: alvo.error };
  const { error } = await supabase
    .from("orcamento_planejamento_socios")
    .update({
      conversa: [],
      proposta: null,
      proposta_confirmada: false,
      status: "rascunho",
      updated_by: admin.userId,
    })
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("category_code", categoryCode)
    .eq("setor_id", alvo.id);
  if (error) {
    if (isSchemaMissing(error.message)) return { needsMigration: true };
    return { error: error.message };
  }
  revalidatePath(PATH);
  return { ok: true };
}

export async function removerPlanejamentoSocios(
  companyId: string,
  year: number,
  categoryCode: string,
  /** Setor da tela — a linha de planejamento pertence a ele. */
  setorId: string | null = null,
): Promise<{ ok?: true; error?: string }> {
  const supabaseAuth = createAdminClientIfAvailable() ?? (await createClient());
  const auth = await autorizarEscrita(supabaseAuth, companyId, year);
  if (!auth.ok) return { error: auth.error };
  const admin = { userId: auth.user.userId };
  // "Todos os setores" é só leitura: sem setor de destino a linha nasceria órfã.
  if (isTodosSetores(setorId)) {
    return { error: "Escolha um setor para editar — \"Todos os setores\" é só leitura." };
  }
  if (!companyId || !categoryCode) return { error: "Categoria inválida." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());
  const alvo = await setorParaGravar(supabase, companyId, year, setorId, admin.userId);
  // O destino só é conhecido aqui ("Todos os setores" cai no balde "Não
  // atribuído", que não pertence a gerente nenhum).
  if (!podeEscreverNoSetor(auth.setores, alvo.id)) return { error: SEM_ACESSO_SETOR };
  const travado = await travaDaDiretoria(
    supabase,
    auth.user.papel,
    companyId,
    year,
    categoryCode,
    alvo.id,
  );
  if (travado) return { error: travado };
  if (alvo.error) return { error: alvo.error };
  const { error: itemErr } = await supabase
    .from("orcamento_planejamento_socios_itens")
    .delete()
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("category_code", categoryCode)
    .eq("setor_id", alvo.id);
  if (itemErr) return { error: itemErr.message };
  const { error } = await supabase
    .from("orcamento_planejamento_socios")
    .delete()
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("category_code", categoryCode)
    .eq("setor_id", alvo.id);
  if (error) return { error: error.message };
  await registrarAlteracao({
    companyId,
    year,
    cicloId: auth.cicloId,
    categoryCode,
    setorId: alvo.id,
    metodo: "planejamento_socios",
    alvoTipo: "planejamento_item",
    alvoRotulo: `Planejamento de ${categoryCode}`,
    acao: "excluiu",
    fase: auth.fase,
    autorId: auth.user.userId,
    autorPapel: auth.user.papel,
  });
  revalidatePath(PATH);
  return { ok: true };
}
