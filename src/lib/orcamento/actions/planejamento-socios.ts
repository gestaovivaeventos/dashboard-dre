"use server";

import { revalidatePath } from "next/cache";
import { generateText, type ModelMessage } from "ai";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { getOrcamentoAdmin } from "@/lib/orcamento/auth";
import { isSchemaMissing } from "@/lib/orcamento/errors";
import { isValidBudgetYear } from "@/lib/orcamento/years";
import { getCategoriaMetodo } from "@/lib/orcamento/actions/categoria-metodo";
import { fetchRealizados, mesesFechados, type MediaRealizado } from "@/lib/orcamento/media-realizado";
import { formatBRL } from "@/lib/orcamento/format";
import { resolveAiProvider, logResolvedUsage } from "@/lib/ai/provider";
import {
  categoriaTotal,
  type Periodicidade,
  type PlanejamentoItem,
  type PlanejamentoItemProposto,
  type PlanejamentoMensagem,
  type PlanejamentoProposta,
  type PlanejamentoRealizadoItem,
} from "@/lib/orcamento/planejamento-calc";

const PATH = "/orcamento";

// ─── Tipos de retorno ──────────────────────────────────────────────────────────

export interface PlanejamentoListItem {
  categoryCode: string;
  categoryName: string;
  dreLineCode: string;
  dreLineName: string;
  status: "rascunho" | "concluido";
  iniciado: boolean;
  itemCount: number;
  totalOrcado: number;
  realizadoAnterior: { total: number; media: number | null } | null;
}

export interface PlanejamentoCategoriaDetalhe {
  categoryCode: string;
  categoryName: string;
  dreLineCode: string;
  dreLineName: string;
  /** Itens já persistidos (com incluir + parametrização). */
  itens: PlanejamentoItem[];
  justificativa: string | null;
  conversa: PlanejamentoMensagem[];
  status: "rascunho" | "concluido";
  realizadoAnterior: { total: number; media: number | null } | null;
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

interface CategoriaRow {
  category_code: string;
  category_name: string | null;
  justificativa: string | null;
  conversa: unknown;
  status: string | null;
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

function toPeriodicidade(v: unknown): Periodicidade {
  return v === "anual" ? "anual" : "mensal";
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
    });
  });
  return out;
}

function parseAiReply(text: string): { reply: string; proposta: PlanejamentoProposta | null } {
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
    };
  }

  const reply =
    obj && typeof obj === "object" && typeof (obj as { reply?: unknown }).reply === "string"
      ? ((obj as { reply: string }).reply as string)
      : "";

  const rawProposta = obj && typeof obj === "object" ? (obj as { proposta?: unknown }).proposta : null;
  let proposta: PlanejamentoProposta | null = null;
  if (rawProposta && typeof rawProposta === "object") {
    const itens = sanitizeItensProposta((rawProposta as { itens?: unknown }).itens);
    const justificativa = (rawProposta as { justificativa?: unknown }).justificativa;
    if (itens.length > 0) {
      proposta = { itens, justificativa: typeof justificativa === "string" ? justificativa : "" };
    }
  }

  return { reply: reply || "…", proposta };
}

function realizadoMensalContexto(r: MediaRealizado | undefined): string {
  if (!r) return "sem dados do ano anterior.";
  const media = r.media == null ? "n/d" : formatBRL(r.media);
  return `total ${formatBRL(r.total)} · média mensal ${media}`;
}

/** Lista que guia a IA: o que o admin já selecionou (contexto vivo) ou, na
 * falta, todos os fornecedores do ano anterior. */
const MESES_NOME = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

function considerarContexto(
  itensContexto: PlanejamentoContextoItem[],
  realizadoItens: PlanejamentoRealizadoItem[],
): string {
  if (itensContexto.length > 0) {
    return itensContexto
      .map((i) => {
        const mes = MESES_NOME[Math.min(12, Math.max(1, Math.round(i.mesInicio))) - 1];
        if (i.periodicidade === "anual") {
          return `- ${i.descricao}: ${formatBRL(i.valorMensal)}/ano, pago em ${mes}`;
        }
        const fim = i.mesFim != null && i.mesFim >= 1 && i.mesFim <= 12 ? i.mesFim : null;
        const ate = fim != null && fim < 12 ? `, até ${MESES_NOME[fim - 1]} (cancela depois)` : "";
        return `- ${i.descricao}: ${formatBRL(i.valorMensal)}/mês, a partir de ${mes}${ate}`;
      })
      .join("\n");
  }
  if (realizadoItens.length === 0) return "Sem fornecedores do ano anterior.";
  return realizadoItens
    .map(
      (c) =>
        `- ${c.fornecedor}: ${c.media == null ? "n/d" : formatBRL(c.media)}/mês (média dos meses fechados; ` +
        `${c.lancamentos} lançamento(s), total ${formatBRL(c.total)} no ano)`,
    )
    .join("\n");
}

async function resolvePlanejamentoProvider() {
  try {
    return await resolveAiProvider({ forceProvider: "gemini", capability: "text" });
  } catch {
    return await resolveAiProvider({ capability: "text" });
  }
}

function buildSystemPrompt(opts: {
  companyName: string;
  categoryName: string;
  dreLineCode: string;
  dreLineName: string;
  year: number;
  realizado: MediaRealizado | undefined;
  considerar: string;
}): string {
  return [
    'Você ajuda o gestor financeiro do Grupo Viva a montar o ORÇAMENTO ANUAL de UMA',
    'categoria de despesa pelo método "Planejamento dos sócios".',
    "",
    "IMPORTANTE: esta categoria reúne VÁRIOS ITENS independentes — cada",
    "plataforma/serviço/contrato é um item próprio. O orçado da categoria é a SOMA",
    "de todos os itens.",
    "",
    `Empresa: ${opts.companyName}`,
    `Categoria: ${opts.categoryName} (linha da DRE: ${opts.dreLineCode} — ${opts.dreLineName})`,
    `Ano do orçamento: ${opts.year}`,
    `Realizado do ano anterior (${opts.year - 1}) na categoria: ${realizadoMensalContexto(opts.realizado)}`,
    "",
    "Itens JÁ CADASTRADOS pela administração para esta categoria (valor e mês são o",
    "PONTO DE PARTIDA — o padrão, não um teto). NÃO invente itens MANTIDOS fora desta",
    "lista, mas o gestor PODE alterar qualquer valor/mês e PODE adicionar itens novos:",
    opts.considerar,
    "",
    "REGRA DE PRECEDÊNCIA (a mais importante): a RESPOSTA DO GESTOR na conversa SEMPRE",
    "vence o valor/mês pré-cadastrado. Se o gestor disser um valor diferente, um mês",
    "diferente, mensal↔anual, ou pedir para incluir/remover um item, a proposta final",
    "TEM de refletir exatamente isso. NUNCA descarte, esqueça ou 'volte ao padrão' uma",
    "mudança que o gestor declarou — reler TODA a conversa antes de propor é obrigatório.",
    "",
    "Como conduzir a ENTREVISTA (uma pergunta por vez, em português do Brasil):",
    "1. Para CADA item da lista acima, a ÚNICA dúvida é se ele será MANTIDO em",
    `   ${opts.year}. INFORME ao gestor o valor e o mês pré-cadastrados (em tom de`,
    '   FATO, nunca como pergunta) e pergunte apenas: "este item será mantido em ' + opts.year + '?".',
    "   NÃO pergunte o valor nem o mês por padrão. MAS se o gestor, ao responder,",
    "   informar um valor/mês/período diferente (ex.: 'sim, mas mude para R$ 40/mês'),",
    "   REGISTRE o valor NOVO que ele deu e confirme de volta o valor atualizado.",
    "   Se o gestor disser que o item NÃO será mantido, ele fica FORA da proposta.",
    "   Se disser que será CANCELADO no meio do ano (ex.: 'cancelo o SERASA em julho'),",
    "   o item continua na proposta como MENSAL, mas você define o mesFim = ÚLTIMO mês",
    "   que ainda será pago. Confirme com o gestor qual é o último mês pago (ex.: se",
    "   cancela em julho, o último pago costuma ser junho → mesFim=6). Não deixe um item",
    "   cancelado com os 12 meses cheios.",
    "2. Depois pergunte se o gestor pretende CONTRATAR algo NOVO. Para CADA item novo,",
    "   você OBRIGATORIAMENTE precisa dos 5 dados abaixo antes de aceitá-lo:",
    "   (a) NOME da plataforma/serviço;",
    "   (b) VALOR em reais;",
    "   (c) se a assinatura é MENSAL ou ANUAL;",
    "   (d) a partir de QUAL MÊS entra no orçamento;",
    "   (e) a JUSTIFICATIVA (para que serve / por que contratar).",
    "   Se o gestor omitir QUALQUER um desses 5 pontos, NÃO prossiga: repita a pergunta",
    "   pedindo SOMENTE o(s) dado(s) que ainda faltam, listando-os, e só siga quando",
    "   TODOS os 5 estiverem respondidos. Nunca preencha por conta própria nem 'chute'",
    "   valor, mês ou justificativa de um item novo.",
    "3. NUNCA invente itens fora da lista acima nem citados pelo gestor.",
    "",
    "TRAVA DA PROPOSTA: só monte a proposta final quando (i) todos os itens da lista",
    "acima tiverem sido confirmados como mantidos ou não e (ii) todo item NOVO tiver os",
    "5 dados (a–e) completos. Se faltar qualquer coisa, 'proposta' continua null e você",
    "faz a próxima pergunta. É PROIBIDO dizer que montou a proposta e mesmo assim mandar",
    "'proposta': null — se você anuncia a proposta, ela DEVE vir preenchida no JSON.",
    "",
    "Quando tiver TODAS as respostas, PROPONHA a LISTA COMPLETA de itens: cada item",
    "mantido (com o valor/mês que o gestor CONFIRMOU — já atualizado se ele mudou),",
    "MAIS cada item NOVO que o gestor pediu, EXCLUINDO os que ele disse não manter.",
    "Confira item por item contra a conversa: nenhuma alteração do gestor pode faltar.",
    "Cada item:",
    "  - descricao: nome da plataforma/serviço;",
    "  - valorMensal: o VALOR em reais — mensal quando periodicidade='mensal', ou o valor",
    "    ANUAL quando periodicidade='anual';",
    "  - mesInicio: mês (1..12) — início da recorrência (mensal) OU mês da renovação (anual);",
    "  - mesFim: mês (1..12) do ÚLTIMO pagamento quando o item é MENSAL e será cancelado",
    "    no meio do ano; use null (ou omita) quando vai até dezembro; ignorado se anual;",
    "  - periodicidade: 'mensal' ou 'anual';",
    "  - origem: 'mantido' (já pago no ano anterior) ou 'novo'.",
    "E uma justificativa curta (2 a 4 frases) com as premissas.",
    "",
    "Responda SEMPRE com um ÚNICO objeto JSON, sem nenhum texto fora dele:",
    '{ "reply": "sua mensagem ao gestor", "proposta": null }',
    'Enquanto entrevista, "proposta" é null e "reply" é a próxima pergunta.',
    "Ao propor, preencha:",
    '{ "reply": "texto curto", "proposta": { "itens": [ { "descricao": "...", "valorMensal": 0, "mesInicio": 1, "mesFim": null, "periodicidade": "mensal", "origem": "mantido" } ], "justificativa": "..." } }',
    "Se o gestor pedir ajustes depois de uma proposta, devolva uma NOVA proposta revisada.",
  ].join("\n");
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
  }>).map((r) => {
    const total = Number(r.total) || 0;
    const totalFechado = Number(r.total_fechado) || 0;
    return {
      fornecedor: String(r.fornecedor),
      total,
      media: fechados > 0 && totalFechado > 0 ? totalFechado / fechados : null,
      lancamentos: Number(r.lancamentos) || 0,
    };
  });
}

// ─── Leitura: lista (landing) ───────────────────────────────────────────────────

export async function getPlanejamentoSocios(
  companyId: string,
  year: number,
): Promise<{ items?: PlanejamentoListItem[]; error?: string; needsMigration?: boolean }> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!companyId) return { items: [] };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const cats = await getCategoriaMetodo(companyId, year);
  if (cats.needsMigration) return { needsMigration: true };
  if (cats.error) return { error: cats.error };
  const doMetodo = (cats.items ?? []).filter((c) => c.metodo === "planejamento_socios");

  const supabase = createAdminClientIfAvailable() ?? (await createClient());

  const { data: catRows, error: catErr } = await supabase
    .from("orcamento_planejamento_socios")
    .select("category_code, status")
    .eq("company_id", companyId)
    .eq("year", year);
  if (catErr) {
    if (isSchemaMissing(catErr.message)) return { needsMigration: true };
    return { error: catErr.message };
  }
  const statusByCode = new Map<string, string>();
  ((catRows ?? []) as { category_code: string; status: string | null }[]).forEach((r) =>
    statusByCode.set(r.category_code, r.status ?? "rascunho"),
  );

  const { data: itemRows, error: itemErr } = await supabase
    .from("orcamento_planejamento_socios_itens")
    .select("category_code, valor_mensal, mes_inicio, mes_fim, periodicidade, incluir")
    .eq("company_id", companyId)
    .eq("year", year);
  if (itemErr) {
    if (isSchemaMissing(itemErr.message)) return { needsMigration: true };
    return { error: itemErr.message };
  }
  const itensByCode = new Map<
    string,
    { valorMensal: number; mesInicio: number; mesFim: number | null; periodicidade: Periodicidade }[]
  >();
  ((itemRows ?? []) as {
    category_code: string;
    valor_mensal: number | string | null;
    mes_inicio: number | string | null;
    mes_fim: number | string | null;
    periodicidade: string | null;
    incluir: boolean | null;
  }[]).forEach((r) => {
    if (r.incluir === false) return; // só os incluídos contam no orçado
    const arr = itensByCode.get(r.category_code) ?? [];
    const valor = Number(r.valor_mensal);
    const mes = Number(r.mes_inicio);
    arr.push({
      valorMensal: Number.isFinite(valor) && valor > 0 ? valor : 0,
      mesInicio: Number.isFinite(mes) ? Math.min(12, Math.max(1, Math.round(mes))) : 1,
      mesFim: optMes(r.mes_fim),
      periodicidade: toPeriodicidade(r.periodicidade),
    });
    itensByCode.set(r.category_code, arr);
  });

  const realizados = await fetchRealizados(supabase, companyId, year - 1, doMetodo.map((c) => c.categoryCode));

  const items: PlanejamentoListItem[] = doMetodo.map((c) => {
    const itens = itensByCode.get(c.categoryCode) ?? [];
    const r = realizados.get(c.categoryCode);
    const status = statusByCode.get(c.categoryCode) === "concluido" ? "concluido" : "rascunho";
    return {
      categoryCode: c.categoryCode,
      categoryName: c.categoryName,
      dreLineCode: c.dreLineCode,
      dreLineName: c.dreLineName,
      status,
      iniciado: statusByCode.has(c.categoryCode) || itens.length > 0,
      itemCount: itens.length,
      totalOrcado: categoriaTotal(itens),
      realizadoAnterior: r ? { total: r.total, media: r.media } : null,
    };
  });

  return { items };
}

// ─── Leitura: detalhe de uma categoria ──────────────────────────────────────────

export async function getPlanejamentoCategoria(
  companyId: string,
  year: number,
  categoryCode: string,
): Promise<{ detalhe?: PlanejamentoCategoriaDetalhe; error?: string; needsMigration?: boolean }> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!companyId || !categoryCode) return { error: "Categoria inválida." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const cats = await getCategoriaMetodo(companyId, year);
  if (cats.needsMigration) return { needsMigration: true };
  if (cats.error) return { error: cats.error };
  const cat = (cats.items ?? []).find((c) => c.categoryCode === categoryCode);
  if (!cat) return { error: "Categoria não encontrada para este método." };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());

  const { data: catRow, error: catErr } = await supabase
    .from("orcamento_planejamento_socios")
    .select("category_code, category_name, justificativa, conversa, status")
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("category_code", categoryCode)
    .maybeSingle<CategoriaRow>();
  if (catErr) {
    if (isSchemaMissing(catErr.message)) return { needsMigration: true };
    return { error: catErr.message };
  }

  const { data: itemRows, error: itemErr } = await supabase
    .from("orcamento_planejamento_socios_itens")
    .select("id, category_code, descricao, valor_mensal, mes_inicio, mes_fim, periodicidade, origem, fornecedor, incluir")
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("category_code", categoryCode)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (itemErr) {
    if (isSchemaMissing(itemErr.message)) return { needsMigration: true };
    return { error: itemErr.message };
  }

  const realizados = await fetchRealizados(supabase, companyId, year - 1, [categoryCode]);
  const realizadoItens = await fetchRealizadoItens(supabase, companyId, year - 1, categoryCode);
  const r = realizados.get(categoryCode);

  return {
    detalhe: {
      categoryCode,
      categoryName: cat.categoryName,
      dreLineCode: cat.dreLineCode,
      dreLineName: cat.dreLineName,
      itens: ((itemRows ?? []) as ItemRow[]).map(rowToItem),
      justificativa: catRow?.justificativa ?? null,
      conversa: sanitizeConversa(catRow?.conversa),
      status: catRow?.status === "concluido" ? "concluido" : "rascunho",
      realizadoAnterior: r ? { total: r.total, media: r.media } : null,
      realizadoItens,
    },
  };
}

// ─── Entrevista (chat) ─────────────────────────────────────────────────────────

export async function enviarMensagemPlanejamento(
  companyId: string,
  year: number,
  categoryCode: string,
  categoryName: string,
  conversaAtual: PlanejamentoMensagem[],
  textoUsuario: string,
  itensContexto: PlanejamentoContextoItem[] = [],
): Promise<{
  reply?: string;
  proposta?: PlanejamentoProposta | null;
  conversa?: PlanejamentoMensagem[];
  error?: string;
  needsMigration?: boolean;
}> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!companyId || !categoryCode) return { error: "Categoria inválida." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());

  const { data: companyData } = await supabase
    .from("companies")
    .select("name")
    .eq("id", companyId)
    .maybeSingle<{ name: string }>();
  const companyName = companyData?.name ?? "Empresa";

  const cats = await getCategoriaMetodo(companyId, year);
  const cat = (cats.items ?? []).find((c) => c.categoryCode === categoryCode);
  const realizados = await fetchRealizados(supabase, companyId, year - 1, [categoryCode]);
  const realizadoItens = await fetchRealizadoItens(supabase, companyId, year - 1, categoryCode);

  const contexto = (itensContexto ?? []).filter((i) => i.descricao.trim() !== "");

  const historico = sanitizeConversa(conversaAtual);
  const texto = (textoUsuario ?? "").trim();

  const system = buildSystemPrompt({
    companyName,
    categoryName: cat?.categoryName ?? categoryName,
    dreLineCode: cat?.dreLineCode ?? "",
    dreLineName: cat?.dreLineName ?? "",
    year,
    realizado: realizados.get(categoryCode),
    considerar: considerarContexto(contexto, realizadoItens),
  });

  const messages: ModelMessage[] = historico.map((m) =>
    m.role === "user" ? { role: "user", content: m.content } : { role: "assistant", content: m.content },
  );
  if (texto) {
    messages.push({ role: "user", content: texto });
  } else if (messages.length === 0) {
    messages.push({ role: "user", content: "Inicie a entrevista fazendo a primeira pergunta." });
  }

  const resolved = await resolvePlanejamentoProvider();
  let replyText: string;
  try {
    const { text, usage } = await generateText({
      model: resolved.provider.chat(resolved.modelName),
      system,
      messages,
      temperature: 0.4,
    });
    replyText = text;
    await logResolvedUsage(resolved, "orcamento", usage, { companyId, userId: admin.userId });
  } catch (e) {
    await logResolvedUsage(resolved, "orcamento", null, {
      companyId,
      userId: admin.userId,
      success: false,
      errorMessage: e instanceof Error ? e.message : String(e),
    });
    return { error: `Falha ao consultar a IA: ${e instanceof Error ? e.message : String(e)}` };
  }

  const { reply, proposta } = parseAiReply(replyText);

  const novaConversa: PlanejamentoMensagem[] = [
    ...historico,
    ...(texto ? [{ role: "user" as const, content: texto }] : []),
    { role: "assistant" as const, content: reply },
  ];

  const { error: upErr } = await supabase.from("orcamento_planejamento_socios").upsert(
    {
      company_id: companyId,
      year,
      category_code: categoryCode,
      category_name: categoryName,
      conversa: novaConversa,
      status: "rascunho",
      updated_by: admin.userId,
    },
    { onConflict: "company_id,year,category_code" },
  );
  if (upErr) {
    if (isSchemaMissing(upErr.message)) return { needsMigration: true };
    return { reply, proposta, conversa: novaConversa, error: upErr.message };
  }

  revalidatePath(PATH);
  return { reply, proposta, conversa: novaConversa };
}

// ─── Salvar / remover ──────────────────────────────────────────────────────────

/**
 * Grava a LISTA de itens da categoria (substitui a anterior). Persiste TODAS as
 * linhas — inclusive as EXCLUÍDAS (incluir=false) — para lembrar as exclusões e
 * a parametrização; só as incluídas contam no orçado e vão para a Prévia.
 */
export async function salvarPlanejamentoItens(
  companyId: string,
  year: number,
  categoryCode: string,
  categoryName: string,
  itens: PlanejamentoItemProposto[],
  justificativa: string,
  conversa: PlanejamentoMensagem[],
): Promise<{ ok?: true; error?: string; needsMigration?: boolean }> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!companyId || !categoryCode) return { error: "Categoria inválida." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const limpos = sanitizeItensProposta(itens).filter((i) => i.descricao.trim() !== "");
  const incluidos = limpos.filter((i) => i.incluir !== false);
  if (incluidos.length === 0) {
    return { error: "Marque ao menos um item para incluir no orçamento." };
  }

  const supabase = createAdminClientIfAvailable() ?? (await createClient());

  const { error: catErr } = await supabase.from("orcamento_planejamento_socios").upsert(
    {
      company_id: companyId,
      year,
      category_code: categoryCode,
      category_name: categoryName,
      justificativa: (justificativa ?? "").trim() || null,
      conversa: sanitizeConversa(conversa),
      status: "concluido",
      updated_by: admin.userId,
    },
    { onConflict: "company_id,year,category_code" },
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
    .eq("category_code", categoryCode);
  if (delErr) return { error: delErr.message };

  const rows = limpos.map((i) => ({
    company_id: companyId,
    year,
    category_code: categoryCode,
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

  revalidatePath(PATH);
  return { ok: true };
}

/**
 * Reinicia SOMENTE a entrevista com a IA: zera a conversa da categoria e mantém
 * intactos os itens já cadastrados (a base "Pagos em {ano-1}") e a justificativa.
 * Não apaga nada da seção que o admin preencheu.
 */
export async function reiniciarConversaPlanejamento(
  companyId: string,
  year: number,
  categoryCode: string,
): Promise<{ ok?: true; error?: string; needsMigration?: boolean }> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!companyId || !categoryCode) return { error: "Categoria inválida." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());
  const { error } = await supabase
    .from("orcamento_planejamento_socios")
    .update({ conversa: [], updated_by: admin.userId })
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("category_code", categoryCode);
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
): Promise<{ ok?: true; error?: string }> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!companyId || !categoryCode) return { error: "Categoria inválida." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());
  const { error: itemErr } = await supabase
    .from("orcamento_planejamento_socios_itens")
    .delete()
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("category_code", categoryCode);
  if (itemErr) return { error: itemErr.message };
  const { error } = await supabase
    .from("orcamento_planejamento_socios")
    .delete()
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("category_code", categoryCode);
  if (error) return { error: error.message };
  revalidatePath(PATH);
  return { ok: true };
}
