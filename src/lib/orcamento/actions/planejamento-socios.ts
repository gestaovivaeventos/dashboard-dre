"use server";

import { revalidatePath } from "next/cache";
import { generateText, type ModelMessage } from "ai";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { getOrcamentoAdmin } from "@/lib/orcamento/auth";
import { isSchemaMissing } from "@/lib/orcamento/errors";
import { isValidBudgetYear } from "@/lib/orcamento/years";
import { getCategoriaMetodo } from "@/lib/orcamento/actions/categoria-metodo";
import { fetchRealizados, type MediaRealizado } from "@/lib/orcamento/media-realizado";
import { formatBRL } from "@/lib/orcamento/format";
import { resolveAiProvider, logResolvedUsage } from "@/lib/ai/provider";
import {
  categoriaTotal,
  type PlanejamentoItem,
  type PlanejamentoItemProposto,
  type PlanejamentoMensagem,
  type PlanejamentoProposta,
  type PlanejamentoRealizadoItem,
} from "@/lib/orcamento/planejamento-calc";

const PATH = "/orcamento";

// ─── Tipos de retorno ──────────────────────────────────────────────────────────

/** Um card da lista (landing): a categoria + o resumo do que já foi orçado. */
export interface PlanejamentoListItem {
  categoryCode: string;
  categoryName: string;
  dreLineCode: string;
  dreLineName: string;
  status: "rascunho" | "concluido";
  /** true = entrevista iniciada (há conversa) ou já há itens. */
  iniciado: boolean;
  itemCount: number;
  totalOrcado: number;
  realizadoAnterior: { total: number; media: number | null } | null;
}

/** Detalhe de uma categoria: itens + conversa + referência do ano anterior. */
export interface PlanejamentoCategoriaDetalhe {
  categoryCode: string;
  categoryName: string;
  dreLineCode: string;
  dreLineName: string;
  itens: PlanejamentoItem[];
  justificativa: string | null;
  conversa: PlanejamentoMensagem[];
  status: "rascunho" | "concluido";
  realizadoAnterior: { total: number; media: number | null } | null;
  realizadoItens: PlanejamentoRealizadoItem[];
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
  origem: string | null;
  fornecedor: string | null;
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
    origem: r.origem === "mantido" ? "mantido" : "novo",
    fornecedor: r.fornecedor ?? null,
  };
}

/** Normaliza os itens propostos pela IA (aceita camelCase e snake_case). */
function sanitizeItensProposta(raw: unknown): PlanejamentoItemProposto[] {
  if (!Array.isArray(raw)) return [];
  const out: PlanejamentoItemProposto[] = [];
  raw.forEach((it) => {
    if (!it || typeof it !== "object") return;
    const o = it as Record<string, unknown>;
    const descricao = String(o.descricao ?? "").trim();
    if (!descricao) return;
    const valor = Number(o.valorMensal ?? o.valor_mensal ?? 0);
    const mes = Number(o.mesInicio ?? o.mes_inicio ?? 1);
    out.push({
      descricao,
      valorMensal: Number.isFinite(valor) && valor > 0 ? valor : 0,
      mesInicio: Number.isFinite(mes) ? Math.min(12, Math.max(1, Math.round(mes))) : 1,
      origem: o.origem === "mantido" ? "mantido" : "novo",
      fornecedor: typeof o.fornecedor === "string" ? o.fornecedor : null,
    });
  });
  return out;
}

/** Extrai o objeto JSON da resposta do modelo, tolerando cercas de markdown. */
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

function realizadoItensContexto(itens: PlanejamentoRealizadoItem[]): string {
  if (itens.length === 0) return "Sem detalhamento por fornecedor no ano anterior.";
  return itens
    .map((i) => `- ${i.fornecedor}: ${formatBRL(i.total)} no ano (${i.lancamentos} lançamento(s))`)
    .join("\n");
}

// Provedor: usa o Gemini (cadastrado no painel de IA). Sem chave para ele, cai
// no provedor ATIVO da config. A entrevista é 100% texto → o shim OpenAI-compat
// do Gemini basta (a armadilha do Gemini é só visão/PDF).
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
  realizadoItens: PlanejamentoRealizadoItem[];
}): string {
  return [
    'Você ajuda o gestor financeiro do Grupo Viva a montar o ORÇAMENTO ANUAL de UMA',
    'categoria de despesa pelo método "Planejamento dos sócios".',
    "",
    "IMPORTANTE: esta categoria costuma reunir VÁRIOS ITENS independentes — cada",
    "plataforma/serviço/contrato é um item próprio. O orçado da categoria é a SOMA",
    "de todos os itens.",
    "",
    `Empresa: ${opts.companyName}`,
    `Categoria: ${opts.categoryName} (linha da DRE: ${opts.dreLineCode} — ${opts.dreLineName})`,
    `Ano do orçamento: ${opts.year}`,
    `Realizado do ano anterior (${opts.year - 1}) na categoria: ${realizadoMensalContexto(opts.realizado)}`,
    "",
    `Plataformas/serviços JÁ PAGOS em ${opts.year - 1} nesta categoria (por fornecedor):`,
    realizadoItensContexto(opts.realizadoItens),
    "",
    "Como conduzir a ENTREVISTA (uma pergunta por vez, em português do Brasil):",
    `1. Para CADA plataforma/serviço já pago em ${opts.year - 1} (lista acima),`,
    `   pergunte se será MANTIDA no orçamento de ${opts.year} e com qual valor mensal`,
    "   (confirme se muda de valor). Trate cada uma individualmente.",
    "2. Depois, pergunte se o gestor pretende CONTRATAR algum serviço NOVO de",
    "   softwares/sistemas/servidores e peça a JUSTIFICATIVA da nova contratação",
    "   (para que serve, valor mensal estimado e a partir de qual mês entra).",
    "3. Nunca invente plataformas que não estão na lista acima nem foram citadas pelo",
    "   gestor. Se a lista do ano anterior estiver vazia, pergunte quais serviços a",
    "   empresa mantém hoje.",
    "",
    "Quando tiver as respostas (o que mantém, com que valor, e o que entra de novo),",
    "PROPONHA a LISTA de itens do orçamento. Cada item:",
    "  - descricao: nome da plataforma/serviço;",
    "  - valorMensal: valor MENSAL em reais (número);",
    "  - mesInicio: mês (1..12) em que passa a valer — 1 para quem já roda o ano todo,",
    "    o mês previsto para uma contratação nova;",
    "  - origem: 'mantido' (já era pago no ano anterior) ou 'novo';",
    "  - fornecedor: o nome do fornecedor da lista acima quando o item corresponde a um.",
    "E uma justificativa curta (2 a 4 frases) com as premissas gerais.",
    "",
    "Responda SEMPRE com um ÚNICO objeto JSON, sem nenhum texto fora dele:",
    '{ "reply": "sua mensagem ao gestor", "proposta": null }',
    'Enquanto entrevista, "proposta" é null e "reply" é a próxima pergunta.',
    "Ao propor, preencha:",
    '{ "reply": "texto curto apresentando a proposta", "proposta": { "itens": [ { "descricao": "...", "valorMensal": 0, "mesInicio": 1, "origem": "mantido", "fornecedor": "..." } ], "justificativa": "..." } }',
    "Se o gestor pedir ajustes depois de uma proposta, devolva uma NOVA proposta revisada.",
  ].join("\n");
}

async function fetchRealizadoItens(
  supabase: Awaited<ReturnType<typeof createClient>>,
  companyId: string,
  baseYear: number,
  categoryCode: string,
): Promise<PlanejamentoRealizadoItem[]> {
  const { data, error } = await supabase.rpc("orcamento_planejamento_realizado_itens", {
    p_company_id: companyId,
    p_base_year: baseYear,
    p_category_code: categoryCode,
  });
  if (error) return [];
  return ((data ?? []) as Array<{ fornecedor: string; total: number | string; lancamentos: number | string }>).map(
    (r) => ({
      fornecedor: String(r.fornecedor),
      total: Number(r.total) || 0,
      lancamentos: Number(r.lancamentos) || 0,
    }),
  );
}

// ─── Leitura: lista (landing) ───────────────────────────────────────────────────

/**
 * Lista as categorias da empresa marcadas com 'planejamento_socios' no ano, com o
 * resumo do que já foi orçado (nº de itens, total, status) e a referência do
 * realizado do ano anterior. É a porta de entrada: o gestor escolhe por qual começar.
 */
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
    .select("category_code, valor_mensal, mes_inicio")
    .eq("company_id", companyId)
    .eq("year", year);
  if (itemErr) {
    if (isSchemaMissing(itemErr.message)) return { needsMigration: true };
    return { error: itemErr.message };
  }
  const itensByCode = new Map<string, { valorMensal: number; mesInicio: number }[]>();
  ((itemRows ?? []) as { category_code: string; valor_mensal: number | string | null; mes_inicio: number | string | null }[]).forEach(
    (r) => {
      const arr = itensByCode.get(r.category_code) ?? [];
      const valor = Number(r.valor_mensal);
      const mes = Number(r.mes_inicio);
      arr.push({
        valorMensal: Number.isFinite(valor) && valor > 0 ? valor : 0,
        mesInicio: Number.isFinite(mes) ? Math.min(12, Math.max(1, Math.round(mes))) : 1,
      });
      itensByCode.set(r.category_code, arr);
    },
  );

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
    .select("id, category_code, descricao, valor_mensal, mes_inicio, origem, fornecedor")
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

/**
 * Um turno da entrevista: recebe a conversa atual + a nova fala do gestor, chama
 * a IA (Gemini) e devolve a resposta e, quando a IA decidir, uma PROPOSTA com a
 * lista de itens + justificativa. Persiste o transcript (status 'rascunho').
 * `textoUsuario` vazio com conversa vazia = INICIAR (a fala de arranque não é gravada).
 */
export async function enviarMensagemPlanejamento(
  companyId: string,
  year: number,
  categoryCode: string,
  categoryName: string,
  conversaAtual: PlanejamentoMensagem[],
  textoUsuario: string,
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

  const historico = sanitizeConversa(conversaAtual);
  const texto = (textoUsuario ?? "").trim();

  const system = buildSystemPrompt({
    companyName,
    categoryName: cat?.categoryName ?? categoryName,
    dreLineCode: cat?.dreLineCode ?? "",
    dreLineName: cat?.dreLineName ?? "",
    year,
    realizado: realizados.get(categoryCode),
    realizadoItens,
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
 * Grava a LISTA de itens da categoria (substitui a anterior) + a justificativa +
 * o transcript, e marca a categoria como 'concluido'. Congela os valores do ano.
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
  if (limpos.length === 0) return { error: "Adicione ao menos um item com descrição para salvar." };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());

  // Categoria: conversa + justificativa + status (upsert).
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

  // Itens: substitui o conjunto inteiro (apaga e reinsere).
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
    origem: i.origem,
    fornecedor: i.fornecedor ?? null,
    updated_by: admin.userId,
  }));
  const { error: insErr } = await supabase.from("orcamento_planejamento_socios_itens").insert(rows);
  if (insErr) return { error: insErr.message };

  revalidatePath(PATH);
  return { ok: true };
}

/** Limpa o planejamento de uma categoria (recomeçar do zero): itens + conversa. */
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
