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
  type CuradoriaEntry,
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

/** Fornecedor do ano anterior já resolvido pela curadoria do administrador. */
export interface PlanejamentoCuradoriaItem {
  /** Nome ORIGINAL do fornecedor no lançamento (chave). */
  fornecedor: string;
  /** Nome de exibição (renomeável). */
  nome: string;
  /** Entra (ou não) na entrevista. */
  incluir: boolean;
  media: number | null;
  total: number;
  lancamentos: number;
}

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
  /** Pagamentos do ano anterior por fornecedor, já com a curadoria aplicada. */
  curadoria: PlanejamentoCuradoriaItem[];
}

interface CategoriaRow {
  category_code: string;
  category_name: string | null;
  justificativa: string | null;
  conversa: unknown;
  curadoria: unknown;
  status: string | null;
}
interface ItemRow {
  id: string;
  category_code: string;
  descricao: string;
  valor_mensal: number | string | null;
  mes_inicio: number | string | null;
  periodicidade: string | null;
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

function sanitizeCuradoria(raw: unknown): CuradoriaEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: CuradoriaEntry[] = [];
  raw.forEach((c) => {
    if (c && typeof c === "object") {
      const fornecedor = String((c as { fornecedor?: unknown }).fornecedor ?? "").trim();
      if (!fornecedor) return;
      const nome = String((c as { nome?: unknown }).nome ?? "").trim() || fornecedor;
      const incluir = (c as { incluir?: unknown }).incluir !== false;
      out.push({ fornecedor, nome, incluir });
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
    periodicidade: toPeriodicidade(r.periodicidade),
    origem: r.origem === "mantido" ? "mantido" : "novo",
    fornecedor: r.fornecedor ?? null,
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
      periodicidade: toPeriodicidade(o.periodicidade),
      origem: o.origem === "mantido" ? "mantido" : "novo",
      fornecedor: typeof o.fornecedor === "string" ? o.fornecedor : null,
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

/** Junta o realizado por fornecedor (RPC) com a curadoria salva do administrador. */
function resolverCuradoria(
  realizado: PlanejamentoRealizadoItem[],
  curadoria: CuradoriaEntry[],
): PlanejamentoCuradoriaItem[] {
  const byFornecedor = new Map<string, CuradoriaEntry>();
  curadoria.forEach((c) => byFornecedor.set(c.fornecedor, c));
  return realizado.map((r) => {
    const c = byFornecedor.get(r.fornecedor);
    return {
      fornecedor: r.fornecedor,
      nome: c?.nome?.trim() || r.fornecedor,
      incluir: c ? c.incluir : true, // sem curadoria ainda → incluído por padrão
      media: r.media,
      total: r.total,
      lancamentos: r.lancamentos,
    };
  });
}

function realizadoMensalContexto(r: MediaRealizado | undefined): string {
  if (!r) return "sem dados do ano anterior.";
  const media = r.media == null ? "n/d" : formatBRL(r.media);
  return `total ${formatBRL(r.total)} · média mensal ${media}`;
}

function curadoriaContexto(curados: PlanejamentoCuradoriaItem[]): string {
  if (curados.length === 0) return "Sem fornecedores selecionados pelo administrador para o ano anterior.";
  return curados
    .map(
      (c) =>
        `- ${c.nome}: ${c.media == null ? "n/d" : formatBRL(c.media)}/mês (média dos meses fechados; ` +
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
  curados: PlanejamentoCuradoriaItem[];
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
    `Fornecedores do ano anterior (${opts.year - 1}) SELECIONADOS pelo administrador para esta`,
    "entrevista (considere SOMENTE estes; os valores são a média mensal dos meses já fechados):",
    curadoriaContexto(opts.curados),
    "",
    "Como conduzir a ENTREVISTA (uma pergunta por vez, em português do Brasil):",
    "1. Para CADA fornecedor da lista acima, pergunte se será MANTIDO no orçamento de",
    `   ${opts.year}, com qual valor e se o pagamento é MENSAL ou ANUAL (alguns têm poucos`,
    "   lançamentos no ano = provavelmente anuais). Se anual, pergunte em qual MÊS renova",
    "   (o valor será lançado só nesse mês); se mensal, a partir de qual mês vale.",
    "2. Depois pergunte se o gestor pretende CONTRATAR algo NOVO e peça a JUSTIFICATIVA",
    "   (para que serve, valor, mensal ou anual, e a partir de qual mês entra).",
    "3. NUNCA invente fornecedores fora da lista acima nem citados pelo gestor. Se a lista",
    "   estiver vazia, pergunte quais serviços a empresa mantém hoje.",
    "",
    "Quando tiver as respostas, PROPONHA a LISTA de itens. Cada item:",
    "  - descricao: nome da plataforma/serviço;",
    "  - valorMensal: o VALOR em reais — mensal quando periodicidade='mensal', ou o valor",
    "    ANUAL quando periodicidade='anual';",
    "  - mesInicio: mês (1..12) — início da recorrência (mensal) OU mês da renovação (anual);",
    "  - periodicidade: 'mensal' ou 'anual';",
    "  - origem: 'mantido' (já pago no ano anterior) ou 'novo';",
    "  - fornecedor: o nome do fornecedor da lista acima quando o item corresponde a um.",
    "E uma justificativa curta (2 a 4 frases) com as premissas.",
    "",
    "Responda SEMPRE com um ÚNICO objeto JSON, sem nenhum texto fora dele:",
    '{ "reply": "sua mensagem ao gestor", "proposta": null }',
    'Enquanto entrevista, "proposta" é null e "reply" é a próxima pergunta.',
    "Ao propor, preencha:",
    '{ "reply": "texto curto apresentando a proposta", "proposta": { "itens": [ { "descricao": "...", "valorMensal": 0, "mesInicio": 1, "periodicidade": "mensal", "origem": "mantido", "fornecedor": "..." } ], "justificativa": "..." } }',
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
    const total = Number(r.total) || 0; // ano inteiro (referência completa)
    const totalFechado = Number(r.total_fechado) || 0; // só meses fechados
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
    .select("category_code, valor_mensal, mes_inicio, periodicidade")
    .eq("company_id", companyId)
    .eq("year", year);
  if (itemErr) {
    if (isSchemaMissing(itemErr.message)) return { needsMigration: true };
    return { error: itemErr.message };
  }
  const itensByCode = new Map<string, { valorMensal: number; mesInicio: number; periodicidade: Periodicidade }[]>();
  ((itemRows ?? []) as { category_code: string; valor_mensal: number | string | null; mes_inicio: number | string | null; periodicidade: string | null }[]).forEach(
    (r) => {
      const arr = itensByCode.get(r.category_code) ?? [];
      const valor = Number(r.valor_mensal);
      const mes = Number(r.mes_inicio);
      arr.push({
        valorMensal: Number.isFinite(valor) && valor > 0 ? valor : 0,
        mesInicio: Number.isFinite(mes) ? Math.min(12, Math.max(1, Math.round(mes))) : 1,
        periodicidade: toPeriodicidade(r.periodicidade),
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
    .select("category_code, category_name, justificativa, conversa, curadoria, status")
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
    .select("id, category_code, descricao, valor_mensal, mes_inicio, periodicidade, origem, fornecedor")
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
  const curadoria = resolverCuradoria(realizadoItens, sanitizeCuradoria(catRow?.curadoria));
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
      curadoria,
    },
  };
}

// ─── Curadoria (o administrador seleciona/renomeia os fornecedores) ─────────────

export async function salvarCuradoria(
  companyId: string,
  year: number,
  categoryCode: string,
  categoryName: string,
  curadoria: CuradoriaEntry[],
): Promise<{ ok?: true; error?: string; needsMigration?: boolean }> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!companyId || !categoryCode) return { error: "Categoria inválida." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());
  const { error } = await supabase.from("orcamento_planejamento_socios").upsert(
    {
      company_id: companyId,
      year,
      category_code: categoryCode,
      category_name: categoryName,
      curadoria: sanitizeCuradoria(curadoria),
      updated_by: admin.userId,
    },
    { onConflict: "company_id,year,category_code" },
  );
  if (error) {
    if (isSchemaMissing(error.message)) return { needsMigration: true };
    return { error: error.message };
  }
  revalidatePath(PATH);
  return { ok: true };
}

// ─── Entrevista (chat) ─────────────────────────────────────────────────────────

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

  // Curadoria salva → só os fornecedores INCLUÍDOS guiam a IA (com o nome dado).
  const { data: catRow } = await supabase
    .from("orcamento_planejamento_socios")
    .select("curadoria")
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("category_code", categoryCode)
    .maybeSingle<{ curadoria: unknown }>();

  const realizados = await fetchRealizados(supabase, companyId, year - 1, [categoryCode]);
  const realizadoItens = await fetchRealizadoItens(supabase, companyId, year - 1, categoryCode);
  const curados = resolverCuradoria(realizadoItens, sanitizeCuradoria(catRow?.curadoria)).filter((c) => c.incluir);

  const historico = sanitizeConversa(conversaAtual);
  const texto = (textoUsuario ?? "").trim();

  const system = buildSystemPrompt({
    companyName,
    categoryName: cat?.categoryName ?? categoryName,
    dreLineCode: cat?.dreLineCode ?? "",
    dreLineName: cat?.dreLineName ?? "",
    year,
    realizado: realizados.get(categoryCode),
    curados,
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
    periodicidade: i.periodicidade,
    origem: i.origem,
    fornecedor: i.fornecedor ?? null,
    updated_by: admin.userId,
  }));
  const { error: insErr } = await supabase.from("orcamento_planejamento_socios_itens").insert(rows);
  if (insErr) return { error: insErr.message };

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
