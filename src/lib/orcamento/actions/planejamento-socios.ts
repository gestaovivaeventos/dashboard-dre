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

const PATH = "/orcamento";
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface PlanejamentoMensagem {
  role: "user" | "assistant";
  content: string;
}

/** Proposta da IA: os 12 valores mensais + a justificativa das premissas. */
export interface PlanejamentoProposta {
  valores: number[];
  justificativa: string;
}

export interface PlanejamentoSociosItem {
  categoryCode: string;
  categoryName: string;
  dreLineCode: string;
  dreLineName: string;
  /** 12 valores mensais decididos, ou null se ainda não orçada. */
  valores: number[] | null;
  justificativa: string | null;
  conversa: PlanejamentoMensagem[];
  status: "rascunho" | "concluido";
  /** Referência do ano anterior (realizado), para contexto do gestor e da IA. */
  realizadoAnterior: { total: number; media: number | null } | null;
}

interface SavedRow {
  category_code: string;
  category_name: string | null;
  valores: unknown;
  justificativa: string | null;
  conversa: unknown;
  status: string | null;
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

/** Normaliza os 12 valores: números finitos >= 0; comprimento exato de 12. */
function sanitizeValores(raw: unknown): number[] | null {
  if (!Array.isArray(raw)) return null;
  const out: number[] = [];
  for (let i = 0; i < 12; i += 1) {
    const n = Number(raw[i]);
    out.push(Number.isFinite(n) && n > 0 ? n : 0);
  }
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
    // Modelo respondeu texto puro (fora do contrato): trata como fala, sem proposta.
    return { reply: (text ?? "").trim() || "Pode me contar um pouco mais sobre essa despesa?", proposta: null };
  }

  const reply =
    obj && typeof obj === "object" && typeof (obj as { reply?: unknown }).reply === "string"
      ? ((obj as { reply: string }).reply as string)
      : "";

  const rawProposta =
    obj && typeof obj === "object" ? (obj as { proposta?: unknown }).proposta : null;
  let proposta: PlanejamentoProposta | null = null;
  if (rawProposta && typeof rawProposta === "object") {
    const valores = sanitizeValores((rawProposta as { valores?: unknown }).valores);
    const justificativa = (rawProposta as { justificativa?: unknown }).justificativa;
    if (valores && valores.some((v) => v > 0)) {
      proposta = {
        valores,
        justificativa: typeof justificativa === "string" ? justificativa : "",
      };
    }
  }

  return { reply: reply || "…", proposta };
}

function realizadoContexto(r: MediaRealizado | undefined): string {
  if (!r) return "sem dados do ano anterior.";
  const linha = r.meses
    .map((v, i) => `${MESES[i]} ${v == null ? 0 : Math.round(Number(v))}`)
    .join(" · ");
  const media = r.media == null ? "n/d" : formatBRL(r.media);
  return `${linha}\nTotal realizado (meses fechados): ${formatBRL(r.total)} · média mensal: ${media}`;
}

// Provedor: usa o Gemini (cadastrado no painel de IA). Se não houver chave para
// ele, cai no provedor ATIVO da config (nunca deixa a entrevista morrer por
// config). A entrevista é 100% texto → o shim OpenAI-compat do Gemini basta
// (a armadilha do Gemini é só visão/PDF).
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
}): string {
  return [
    'Você ajuda o gestor financeiro do Grupo Viva a montar o ORÇAMENTO ANUAL de UMA',
    'categoria de despesa pelo método "Planejamento dos sócios" — uma decisão',
    "gerencial, que não vem do histórico automático nem de contrato fixo.",
    "",
    `Empresa: ${opts.companyName}`,
    `Categoria: ${opts.categoryName} (linha da DRE: ${opts.dreLineCode} — ${opts.dreLineName})`,
    `Ano do orçamento: ${opts.year}`,
    `Realizado do ano anterior (${opts.year - 1}), em R$:`,
    realizadoContexto(opts.realizado),
    "",
    "Seu papel: conduzir uma ENTREVISTA curta e objetiva — UMA pergunta por vez, em",
    "português do Brasil — para entender como essa despesa deve se comportar no ano do",
    "orçamento (valor esperado, sazonalidade, reajustes, contratos novos, eventos",
    "pontuais, cortes). Use o realizado do ano anterior como referência quando fizer",
    "sentido, sem impô-lo. Nunca invente contratos, nomes ou eventos que o gestor não citou.",
    "",
    "Quando tiver informação suficiente (normalmente após 2 a 4 perguntas, ou assim que",
    "o gestor pedir para fechar), PROPONHA os 12 valores mensais (jan a dez), em reais, e",
    "uma justificativa curta (2 a 4 frases) com as premissas. Respeite a sazonalidade",
    "indicada: pode concentrar valores em meses específicos e deixar outros zerados.",
    "",
    "Responda SEMPRE com um ÚNICO objeto JSON, sem nenhum texto fora dele:",
    '{ "reply": "sua mensagem ao gestor", "proposta": null }',
    'Enquanto entrevista, "proposta" é null e "reply" é a próxima pergunta.',
    "Ao propor os valores, preencha:",
    '{ "reply": "texto curto apresentando a proposta", "proposta": { "valores": [12 números jan..dez], "justificativa": "premissas" } }',
    "Se o gestor pedir ajustes depois de uma proposta, devolva uma NOVA proposta revisada.",
  ].join("\n");
}

// ─── Leitura ───────────────────────────────────────────────────────────────────

/**
 * Lista as categorias da empresa marcadas com o método 'planejamento_socios' no
 * ano, já com o que houver salvo (valores/justificativa/conversa/status) e a
 * referência do realizado do ano anterior. É a porta de entrada da tela: o
 * gestor escolhe por qual categoria começar.
 */
export async function getPlanejamentoSocios(
  companyId: string,
  year: number,
): Promise<{ items?: PlanejamentoSociosItem[]; error?: string; needsMigration?: boolean }> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!companyId) return { items: [] };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  // As categorias vêm do "Método por categoria" (reusa a resolução do mapeamento
  // e da linha DRE), filtradas ao método planejamento_socios.
  const cats = await getCategoriaMetodo(companyId, year);
  if (cats.needsMigration) return { needsMigration: true };
  if (cats.error) return { error: cats.error };
  const doMetodo = (cats.items ?? []).filter((c) => c.metodo === "planejamento_socios");

  const supabase = createAdminClientIfAvailable() ?? (await createClient());

  const { data: saved, error } = await supabase
    .from("orcamento_planejamento_socios")
    .select("category_code, category_name, valores, justificativa, conversa, status")
    .eq("company_id", companyId)
    .eq("year", year);
  if (error) {
    if (isSchemaMissing(error.message)) return { needsMigration: true };
    return { error: error.message };
  }
  const byCode = new Map<string, SavedRow>();
  ((saved ?? []) as SavedRow[]).forEach((r) => byCode.set(r.category_code, r));

  // Realizado do ano anterior para todas as categorias do método (1 RPC).
  const codes = doMetodo.map((c) => c.categoryCode);
  const realizados = await fetchRealizados(supabase, companyId, year - 1, codes);

  const items: PlanejamentoSociosItem[] = doMetodo.map((c) => {
    const row = byCode.get(c.categoryCode);
    const r = realizados.get(c.categoryCode);
    const status = row?.status === "concluido" ? "concluido" : "rascunho";
    return {
      categoryCode: c.categoryCode,
      categoryName: c.categoryName,
      dreLineCode: c.dreLineCode,
      dreLineName: c.dreLineName,
      valores: row ? sanitizeValores(row.valores) : null,
      justificativa: row?.justificativa ?? null,
      conversa: sanitizeConversa(row?.conversa),
      status,
      realizadoAnterior: r ? { total: r.total, media: r.media } : null,
    };
  });

  return { items };
}

// ─── Entrevista (chat) ─────────────────────────────────────────────────────────

/**
 * Um turno da entrevista: recebe a conversa atual + a nova fala do gestor, chama
 * a IA (Gemini) e devolve a resposta e, quando a IA decidir, uma proposta de 12
 * valores + justificativa. Persiste o transcript (status permanece 'rascunho').
 * `textoUsuario` vazio com conversa vazia = INICIAR a entrevista (a IA abre com
 * a primeira pergunta; a fala interna de arranque não é gravada).
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

  // Resolve a linha DRE (rótulo) e o realizado para o contexto da IA.
  const cats = await getCategoriaMetodo(companyId, year);
  const cat = (cats.items ?? []).find((c) => c.categoryCode === categoryCode);
  const realizados = await fetchRealizados(supabase, companyId, year - 1, [categoryCode]);

  const historico = sanitizeConversa(conversaAtual);
  const texto = (textoUsuario ?? "").trim();

  const system = buildSystemPrompt({
    companyName,
    categoryName: cat?.categoryName ?? categoryName,
    dreLineCode: cat?.dreLineCode ?? "",
    dreLineName: cat?.dreLineName ?? "",
    year,
    realizado: realizados.get(categoryCode),
  });

  // Mensagens enviadas ao modelo: o histórico + a fala nova (ou um arranque
  // interno quando é o primeiro turno, que NÃO entra no transcript salvo). O
  // ramo condicional dá a cada item um tipo concreto (não a união role), para
  // casar com CoreMessage.
  const messages: ModelMessage[] = historico.map((m) =>
    m.role === "user"
      ? { role: "user", content: m.content }
      : { role: "assistant", content: m.content },
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
    await logResolvedUsage(resolved, "orcamento", usage, {
      companyId,
      userId: admin.userId,
    });
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

  // Transcript salvo: histórico + a fala do gestor (se houve) + a resposta da IA.
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
    // A conversa não persistiu, mas a resposta é válida — devolve mesmo assim.
    return { reply, proposta, conversa: novaConversa, error: upErr.message };
  }

  revalidatePath(PATH);
  return { reply, proposta, conversa: novaConversa };
}

// ─── Salvar / remover ──────────────────────────────────────────────────────────

/**
 * Grava os 12 valores DECIDIDOS + a justificativa + o transcript e marca a
 * categoria como 'concluido'. Congela o número do ano (valor, não fórmula viva).
 */
export async function salvarPlanejamentoSocios(
  companyId: string,
  year: number,
  categoryCode: string,
  categoryName: string,
  valores: number[],
  justificativa: string,
  conversa: PlanejamentoMensagem[],
): Promise<{ ok?: true; error?: string; needsMigration?: boolean }> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!companyId || !categoryCode) return { error: "Categoria inválida." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const sanitized = sanitizeValores(valores);
  if (!sanitized) return { error: "Valores inválidos." };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());

  const { error } = await supabase.from("orcamento_planejamento_socios").upsert(
    {
      company_id: companyId,
      year,
      category_code: categoryCode,
      category_name: categoryName,
      valores: sanitized,
      justificativa: (justificativa ?? "").trim() || null,
      conversa: sanitizeConversa(conversa),
      status: "concluido",
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

/** Limpa o planejamento de uma categoria (recomeçar a entrevista do zero). */
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
