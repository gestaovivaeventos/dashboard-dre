import { createOpenAI } from "@ai-sdk/openai";

import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { decryptSecret } from "@/lib/security/encryption";

// ============================================================================
// Camada central de IA — resolve QUAL provedor/modelo cada chamada usa e mede
// o consumo. Antes deste módulo, cada arquivo criava o cliente OpenAI direto
// com OPENAI_API_KEY. Agora todos passam por `resolveAiProvider()`, e o
// provedor ativo (OpenAI ou DeepSeek) é decidido pela config no banco
// (tabelas ai_config / ai_provider_settings), configurável em /admin/ia.
//
// DeepSeek é compatível com a API da OpenAI, então usamos o mesmo
// `createOpenAI` apontando o baseURL para api.deepseek.com.
//
// Fallbacks (nunca deixa a IA cair por falta de config):
//   - Sem service role / tabelas vazias → OpenAI via OPENAI_API_KEY (env).
//   - Provedor ativo desabilitado ou sem chave → cai para OpenAI.
//   - Capacidade que o provedor ativo não tem (visão/web search) → OpenAI.
// ============================================================================

// Slug do provedor. "openai" e "deepseek" são embutidos (têm fallback por env
// var); qualquer outro é um provedor adicionado no painel (compatível com a API
// da OpenAI, ex.: Groq, Together, OpenRouter, Mistral) e precisa de base_url +
// chave no banco.
export type AiProviderName = string;

// Módulos que consomem IA — usado como rótulo no log e no painel de consumo.
export type AiModule =
  | "bi"
  | "relatorio_mensal"
  | "projecao"
  | "comparacao"
  | "contratos"
  | "ocr"
  | "viagens";

export const AI_MODULE_LABELS: Record<AiModule, string> = {
  bi: "Business Intelligence",
  relatorio_mensal: "Relatório Mensal",
  projecao: "Projeção",
  comparacao: "Comparação",
  contratos: "Contratos",
  ocr: "Leitura de Documentos (OCR)",
  viagens: "Viagens",
};

export const AI_PROVIDER_LABELS: Record<AiProviderName, string> = {
  openai: "OpenAI",
  deepseek: "DeepSeek",
};

// Capacidades exigidas por alguns fluxos. Só a OpenAI, no nosso stack, faz
// visão (OCR de imagem/PDF) e web search (Viagens); quando o provedor ativo
// for o DeepSeek, esses fluxos continuam na OpenAI.
export type AiCapability = "text" | "vision" | "web_search";

function providerSupports(p: AiProviderName, cap: AiCapability): boolean {
  if (cap === "text") return true;
  return p === "openai";
}

const OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEEPSEEK_BASE_URL = "https://api.deepseek.com";

// Defaults dos provedores EMBUTIDOS: env var de fallback, baseURL e modelo
// padrão. Provedores adicionados no painel não têm entrada aqui — sua baseURL,
// modelo e chave vêm da linha em ai_provider_settings.
interface BuiltinDefaults {
  baseURL?: string;
  envKey: string;
  model: string;
}

export const BUILTIN_PROVIDERS = ["openai", "deepseek"] as const;

const BUILTIN_DEFAULTS: Record<string, BuiltinDefaults> = {
  openai: { baseURL: undefined, envKey: "OPENAI_API_KEY", model: "gpt-4o-mini" },
  deepseek: { baseURL: DEEPSEEK_BASE_URL, envKey: "DEEPSEEK_API_KEY", model: "deepseek-chat" },
};

// Monta o endpoint de chat completions (API crua) a partir da baseURL.
function chatUrlFor(baseURL: string | undefined): string {
  return `${baseURL ?? OPENAI_BASE_URL}/chat/completions`;
}

/**
 * base_url só vale se for URL absoluta http(s). O campo "Base URL" do painel é
 * texto livre e um valor qualquer ali (já entrou um e-mail) vira endpoint: toda
 * chamada do provedor morre em "Failed to parse URL from …" — foi o que quebrou
 * o OCR de boleto/nota. Valor inválido é ignorado e o provedor volta ao endpoint
 * padrão, em vez de derrubar o recurso inteiro.
 */
function sanitizeBaseURL(raw: string | null | undefined, provider: string): string | undefined {
  const v = (raw ?? "").trim();
  if (!v) return undefined;
  try {
    const u = new URL(v);
    if (u.protocol === "http:" || u.protocol === "https:") return v.replace(/\/+$/, "");
  } catch {
    // Não é URL absoluta — cai no aviso abaixo.
  }
  console.warn(`[ai] base_url inválida para "${provider}" (${v}) — ignorada; usando o endpoint padrão.`);
  return undefined;
}

// Preço padrão por modelo, em USD por 1 milhão de tokens (input / output).
// São editáveis no painel (persistidos em ai_config.model_prices, que
// sobrescreve este mapa). Valores aproximados de mercado — ajuste na tela.
export interface ModelPrice {
  input: number;
  output: number;
  /**
   * USD por 1M de tokens de input em CACHE HIT (contexto repetido). DeepSeek e
   * OpenAI cobram esses tokens bem mais barato que o input normal (cache miss).
   * Ausente → usa `input` (sem desconto).
   */
  cachedInput?: number;
}

export const DEFAULT_MODEL_PRICES: Record<string, ModelPrice> = {
  "gpt-4o-mini": { input: 0.15, output: 0.6, cachedInput: 0.075 },
  "gpt-4o": { input: 2.5, output: 10.0, cachedInput: 1.25 },
  "gpt-5-mini": { input: 0.25, output: 2.0, cachedInput: 0.025 },
  // Valores de referência (ajuste na tela conforme a tabela do DeepSeek):
  "deepseek-chat": { input: 0.14, output: 0.28, cachedInput: 0.014 },
  "deepseek-reasoner": { input: 0.55, output: 2.19, cachedInput: 0.14 },
  "deepseek-v4-flash": { input: 0.14, output: 0.28, cachedInput: 0.0028 },
  "deepseek-v4-pro": { input: 0.435, output: 0.87, cachedInput: 0.003625 },
};

export const DEFAULT_USD_BRL_RATE = 5.5;

interface AiConfigRow {
  active_provider: AiProviderName;
  // Provedor DEDICADO à leitura de documentos (OCR). null = usa o active_provider.
  ocr_provider: AiProviderName | null;
  usd_brl_rate: number | string | null;
  model_prices: Record<string, ModelPrice> | null;
}

interface ProviderRow {
  provider: AiProviderName;
  label: string | null;
  base_url: string | null;
  enabled: boolean;
  api_key_encrypted: string | null;
  model: string | null;
}

export interface ResolvedAiProvider {
  /** Instância do AI SDK (createOpenAI) — funciona também p/ DeepSeek via baseURL. */
  provider: ReturnType<typeof createOpenAI>;
  providerName: AiProviderName;
  modelName: string;
  /** Chave de API resolvida (para callers que fazem fetch cru). */
  apiKey: string;
  /** Endpoint de chat completions do provedor ativo (API crua). */
  chatCompletionsUrl: string;
  /** Preços mesclados (defaults + overrides do banco), por modelo. */
  modelPrices: Record<string, ModelPrice>;
  usdBrlRate: number;
  /** Origem da chave usada: "db" (painel) ou "env" (variável de ambiente). */
  source: "db" | "env";
}

function mergeModelPrices(override: Record<string, ModelPrice> | null): Record<string, ModelPrice> {
  const merged: Record<string, ModelPrice> = { ...DEFAULT_MODEL_PRICES };
  if (override && typeof override === "object") {
    for (const [model, price] of Object.entries(override)) {
      if (price && typeof price === "object" && "input" in price && "output" in price) {
        merged[model] = { input: Number(price.input) || 0, output: Number(price.output) || 0 };
      }
    }
  }
  return merged;
}

// Tenta obter a chave de um provedor: primeiro a do painel (criptografada),
// senão a variável de ambiente. Retorna null se não houver nenhuma.
function resolveKey(
  name: AiProviderName,
  row: ProviderRow | null,
): { apiKey: string; source: "db" | "env" } | null {
  if (row?.api_key_encrypted) {
    try {
      return { apiKey: decryptSecret(row.api_key_encrypted), source: "db" };
    } catch {
      // Chave corrompida/mudança de ENCRYPTION_KEY — cai no env.
    }
  }
  const envName = BUILTIN_DEFAULTS[name]?.envKey;
  const envKey = envName ? process.env[envName] : undefined;
  if (envKey) return { apiKey: envKey, source: "env" };
  return null;
}

/**
 * Resolve o provedor/modelo a usar agora. `capability` força a OpenAI quando o
 * provedor ativo não a suporta (visão / web search).
 */
export async function resolveAiProvider(
  opts: {
    capability?: AiCapability;
    /**
     * Ignora o provedor ativo da config e resolve ESTE. Usado como último
     * recurso quando o provedor ativo falha (ex.: o motor do relatório de BI
     * refaz na OpenAI depois de esgotar as tentativas no DeepSeek). Toda a
     * resolução de chave/baseURL/modelo abaixo continua valendo — se não
     * houver chave para o provedor pedido, a função lança normalmente.
     */
    forceProvider?: AiProviderName;
    /**
     * "ocr" resolve o provedor DEDICADO à leitura de documentos
     * (ai_config.ocr_provider) em vez do provedor geral — e confia que ele faz
     * visão (não força OpenAI). Sem OCR configurado (ou sem chave), cai no
     * comportamento anterior (visão → OpenAI).
     */
    role?: "ocr";
  } = {},
): Promise<ResolvedAiProvider> {
  const capability = opts.capability ?? "text";

  const db = createAdminClientIfAvailable();
  let cfg: AiConfigRow | null = null;
  let rows: ProviderRow[] = [];

  if (db) {
    try {
      const [{ data: cfgData }, { data: provData }] = await Promise.all([
        // `*` (não colunas explícitas): se a migração do `ocr_provider` ainda não
        // rodou, um select nominal dela devolveria erro e derrubaria a config
        // INTEIRA (o BI cairia na OpenAI). Com `*`, a coluna ausente só vem
        // undefined e o resto segue normal.
        db.from("ai_config").select("*").eq("id", 1).maybeSingle(),
        db.from("ai_provider_settings").select("provider, label, base_url, enabled, api_key_encrypted, model"),
      ]);
      cfg = (cfgData as AiConfigRow | null) ?? null;
      rows = (provData as ProviderRow[] | null) ?? [];
    } catch {
      // Tabelas ainda não migradas → segue com defaults (OpenAI via env).
    }
  }

  const modelPrices = mergeModelPrices(cfg?.model_prices ?? null);
  const usdBrlRate = Number(cfg?.usd_brl_rate) || DEFAULT_USD_BRL_RATE;
  const rowFor = (name: AiProviderName) => rows.find((r) => r.provider === name) ?? null;

  // 1. Provedor desejado (forçado > OCR dedicado > config ativo), com override de
  //    capacidade. Para role "ocr" com provedor de OCR escolhido, confiamos que
  //    ele faz visão e NÃO forçamos OpenAI (é justamente pra isso que foi
  //    escolhido). Sem OCR dedicado, mantém o comportamento antigo (visão →
  //    OpenAI). Se o provedor de OCR não tiver chave, o passo 3 abaixo já cai
  //    para OpenAI — então nada quebra antes de configurar a chave.
  const wantsOcr = opts.role === "ocr";
  const ocrConfigured = wantsOcr && Boolean(cfg?.ocr_provider);
  // role "ocr" É leitura de documento (visão). Sem OCR dedicado configurado, cai
  // no comportamento antigo: força OpenAI (a visão só a OpenAI faz no stack) —
  // NUNCA o provedor de texto (DeepSeek), que não lê imagem.
  const effCapability: AiCapability = wantsOcr && !ocrConfigured ? "vision" : capability;
  let activeName: AiProviderName =
    opts.forceProvider ??
    (ocrConfigured ? (cfg?.ocr_provider as AiProviderName) : cfg?.active_provider) ??
    "openai";
  if (!ocrConfigured && !providerSupports(activeName, effCapability)) activeName = "openai";

  // 2. Se o provedor ativo está desabilitado no painel, cai para OpenAI.
  const activeRow = rowFor(activeName);
  if (activeRow && activeRow.enabled === false && activeName !== "openai") {
    activeName = "openai";
  }

  // 3. Resolve a chave; se faltar e não for OpenAI, cai para OpenAI.
  let key = resolveKey(activeName, rowFor(activeName));
  if (!key && activeName !== "openai") {
    activeName = "openai";
    key = resolveKey("openai", rowFor("openai"));
  }
  if (!key) {
    const envName = BUILTIN_DEFAULTS[activeName]?.envKey;
    throw new Error(
      `Sem chave de API para o provedor "${activeName}". Configure em /admin/ia` +
        (envName ? ` ou defina ${envName} no ambiente.` : "."),
    );
  }

  const finalRow = rowFor(activeName);
  const builtin = BUILTIN_DEFAULTS[activeName];
  // baseURL: primeiro a do painel (base_url da linha), senão o default do
  // provedor embutido, senão OpenAI (undefined = default do AI SDK).
  const baseURL = sanitizeBaseURL(finalRow?.base_url, activeName) || builtin?.baseURL || undefined;
  const modelName = finalRow?.model || builtin?.model || "gpt-4o-mini";

  const provider = createOpenAI(baseURL ? { apiKey: key.apiKey, baseURL } : { apiKey: key.apiKey });

  return {
    provider,
    providerName: activeName,
    modelName,
    apiKey: key.apiKey,
    chatCompletionsUrl: chatUrlFor(baseURL),
    modelPrices,
    usdBrlRate,
    source: key.source,
  };
}

// ─── Medição de consumo ──────────────────────────────────────────────────────

export interface AiUsageTokens {
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  /** Parte do input que foi CACHE HIT (subconjunto de inputTokens). */
  cachedInputTokens?: number | null;
}

// Normaliza o objeto `usage` do AI SDK (v6: inputTokens/outputTokens) e também
// aceita o formato snake_case da API crua (prompt_tokens/completion_tokens).
// Captura os tokens em cache hit: AI SDK (`cachedInputTokens`), OpenAI cru
// (`prompt_tokens_details.cached_tokens`) e DeepSeek cru (`prompt_cache_hit_tokens`).
export function normalizeUsage(u: unknown): AiUsageTokens {
  const usage = (u ?? {}) as Record<string, number | undefined> & {
    prompt_tokens_details?: { cached_tokens?: number };
  };
  const inputTokens = usage.inputTokens ?? usage.promptTokens ?? usage.prompt_tokens ?? 0;
  const outputTokens = usage.outputTokens ?? usage.completionTokens ?? usage.completion_tokens ?? 0;
  const totalTokens = usage.totalTokens ?? usage.total_tokens ?? inputTokens + outputTokens;
  const cachedInputTokens =
    usage.cachedInputTokens ??
    usage.prompt_cache_hit_tokens ??
    usage.prompt_tokens_details?.cached_tokens ??
    usage.cached_tokens ??
    0;
  return { inputTokens, outputTokens, totalTokens, cachedInputTokens };
}

export function priceForModel(
  model: string,
  modelPrices: Record<string, ModelPrice>,
): ModelPrice {
  return modelPrices[model] ?? { input: 0, output: 0 };
}

/**
 * Registra uma chamada de IA na ai_usage_log. Best-effort: qualquer falha é
 * engolida (log de consumo nunca pode derrubar o fluxo principal). O custo é
 * calculado a partir do modelo REAL usado (não só do provedor configurado),
 * para que OCR (gpt-4o) e web search (gpt-5-mini) tenham custo correto.
 */
export async function logAiUsage(params: {
  module: AiModule;
  providerName: AiProviderName;
  modelName: string;
  usage?: AiUsageTokens | null;
  modelPrices: Record<string, ModelPrice>;
  usdBrlRate: number;
  companyId?: string | null;
  userId?: string | null;
  success?: boolean;
  errorMessage?: string | null;
}): Promise<void> {
  try {
    const db = createAdminClientIfAvailable();
    if (!db) return;

    const inTok = Math.max(0, Math.round(params.usage?.inputTokens ?? 0));
    const outTok = Math.max(0, Math.round(params.usage?.outputTokens ?? 0));
    const totTok =
      params.usage?.totalTokens != null ? Math.max(0, Math.round(params.usage.totalTokens)) : inTok + outTok;

    // Input dividido em cache hit (mais barato) e cache miss (preço cheio), como
    // o DeepSeek/OpenAI cobram. Sem cachedInput → tudo pelo preço de input.
    const cachedIn = Math.min(Math.max(0, Math.round(params.usage?.cachedInputTokens ?? 0)), inTok);
    const regularIn = inTok - cachedIn;
    const price = priceForModel(params.modelName, params.modelPrices);
    const cachedPrice = price.cachedInput ?? price.input;
    const costUsd =
      (regularIn / 1_000_000) * price.input +
      (cachedIn / 1_000_000) * cachedPrice +
      (outTok / 1_000_000) * price.output;
    const costBrl = costUsd * (params.usdBrlRate || 0);

    await db.from("ai_usage_log").insert({
      module: params.module,
      provider: params.providerName,
      model: params.modelName,
      input_tokens: inTok,
      output_tokens: outTok,
      total_tokens: totTok,
      cost_usd: costUsd,
      cost_brl: costBrl,
      company_id: params.companyId ?? null,
      user_id: params.userId ?? null,
      success: params.success ?? true,
      error_message: params.errorMessage ?? null,
    });
  } catch (e) {
    console.warn("[ai] logAiUsage falhou:", e instanceof Error ? e.message : e);
  }
}

/**
 * Açúcar sintático para os pontos de chamada: registra o consumo já com os
 * dados do provedor resolvido, evitando repetir modelPrices/usdBrlRate.
 */
export async function logResolvedUsage(
  resolved: ResolvedAiProvider,
  module: AiModule,
  usage: unknown,
  extra: {
    modelName?: string;
    companyId?: string | null;
    userId?: string | null;
    success?: boolean;
    errorMessage?: string | null;
  } = {},
): Promise<void> {
  await logAiUsage({
    module,
    providerName: resolved.providerName,
    modelName: extra.modelName ?? resolved.modelName,
    usage: normalizeUsage(usage),
    modelPrices: resolved.modelPrices,
    usdBrlRate: resolved.usdBrlRate,
    companyId: extra.companyId,
    userId: extra.userId,
    success: extra.success,
    errorMessage: extra.errorMessage,
  });
}

// ─── Saída JSON compatível (DeepSeek e afins) ────────────────────────────────
//
// O `generateObject` do AI SDK, no modelo chat, envia `response_format:
// json_schema`, que só a OpenAI aceita. Provedores compatíveis (DeepSeek, Groq,
// etc.) suportam `response_format: json_object`. Este helper faz a chamada crua
// de chat completions com json_object e devolve o JSON já parseado — o caller
// valida com o próprio schema Zod. Use-o quando `providerName !== "openai"`.
//
// MODO RACIOCÍNIO (DeepSeek V4): os modelos v4 vêm com `thinking` LIGADO por
// padrão, e o raciocínio (`reasoning_content`) consome o MESMO orçamento de
// `max_tokens` da resposta. Se o raciocínio esgotar o teto, a API devolve
// `finish_reason=length` com `content` VAZIO — nenhum JSON. Por isso, quando
// isso acontece, refazemos a chamada UMA vez com o raciocínio desligado
// (`thinking: {type: "disabled"}`), que gasta ~3x menos tokens de saída e
// garante o JSON. Ver https://api-docs.deepseek.com/api/create-chat-completion/
//
// RESPOSTA VAZIA TRANSITÓRIA: o mesmo sintoma (HTTP 200 com `content` vazio)
// também aparece por sobrecarga momentânea do provedor. Por isso a chamada é
// tentada até 3x com espera progressiva antes de virar erro.
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function generateJsonViaChat(
  resolved: ResolvedAiProvider,
  opts: {
    system: string;
    prompt: string;
    temperature?: number;
    maxTokens?: number;
    modelName?: string;
    // JSON Schema (texto) da saída esperada. Injetado no system para o provedor
    // seguir a estrutura exata, já que não recebe o schema como regra de máquina.
    schemaHint?: string;
  },
): Promise<{ object: unknown; usage: AiUsageTokens }> {
  const model = opts.modelName ?? resolved.modelName;
  const systemContent = opts.schemaHint
    ? opts.system +
      "\n\nO JSON de resposta DEVE seguir EXATAMENTE este JSON Schema — mesmos campos, " +
      "tipos e enums, sem campos a mais nem a menos:\n" +
      opts.schemaHint
    : opts.system;
  interface ChatPayload {
    choices?: Array<{
      message?: { content?: string; reasoning_content?: string };
      finish_reason?: string;
    }>;
    usage?: Record<string, number>;
  }

  // Uma chamada crua. `thinking` só vai no corpo quando informado, para não
  // enviar um parâmetro desconhecido a provedores que não o suportam.
  //
  // O timeout é POR TENTATIVA (antes o AbortController era criado uma vez para
  // toda a função — com as retentativas abaixo, a 2ª/3ª chamada herdaria um
  // orçamento de tempo já consumido e abortaria sem ter chance de responder).
  const call = async (thinking?: { type: "disabled" }): Promise<ChatPayload> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);
    try {
      return await doCall(controller, thinking);
    } finally {
      clearTimeout(timer);
    }
  };

  const doCall = async (
    controller: AbortController,
    thinking?: { type: "disabled" },
  ): Promise<ChatPayload> => {
    const res = await fetch(resolved.chatCompletionsUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resolved.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemContent },
          {
            role: "user",
            content: opts.prompt + "\n\nResponda APENAS com um único objeto JSON válido, sem texto fora do JSON.",
          },
        ],
        temperature: opts.temperature ?? 0.2,
        max_tokens: opts.maxTokens ?? 8192,
        response_format: { type: "json_object" },
        ...(thinking ? { thinking } : {}),
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`);
    }
    return (await res.json()) as ChatPayload;
  };

  // DeepSeek V4 vem com thinking LIGADO por default e gasta o max_tokens inteiro
  // em reasoning_content antes de escrever o JSON (finish_reason=length com
  // content vazio). Para saída JSON estruturada já desligamos na PRIMEIRA
  // chamada. Provedores que não conhecem o parâmetro `thinking` não o recebem.
  const thinkingOffDeStart = resolved.providerName === "deepseek";
  const baseThinking = thinkingOffDeStart ? ({ type: "disabled" } as const) : undefined;

  // Resposta vazia (content vazio com HTTP 200) NÃO é sempre "raciocínio
  // estourou o teto": também acontece por sobrecarga momentânea do provedor —
  // e é mais provável em lote (a rotina mensal dispara uma chamada por
  // empresa em sequência) do que na tela, onde o usuário gera um relatório por
  // vez. Por isso tentamos de novo em QUALQUER caso de vazio, com um respiro
  // entre as tentativas. (Antes o retry tinha `!thinkingOffDeStart` na
  // condição, o que o desligava exatamente para o DeepSeek — o provedor que
  // produz a falha —, e um vazio transitório virava erro na cara do usuário.)
  const MAX_ATTEMPTS = 3;
  const RETRY_DELAY_MS = 1500;

  const describeEmpty = (payload: ChatPayload): string => {
    const choice = payload.choices?.[0];
    const fr = choice?.finish_reason ?? "sem choice";
    const reasoningLen = choice?.message?.reasoning_content?.length ?? 0;
    const usage = payload.usage
      ? ` · usage=${JSON.stringify(payload.usage)}`
      : "";
    const reasoning = reasoningLen
      ? ` — modelo devolveu ${reasoningLen} chars de raciocínio e nenhum JSON (esgotou os tokens; aumente max_tokens)`
      : "";
    return `[finish_reason=${fr}]${reasoning} · max_tokens=${opts.maxTokens ?? 8192}${usage}`;
  };

  {
    let lastPayload: ChatPayload | null = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const payload = await call(baseThinking);
      lastPayload = payload;
      const choice = payload.choices?.[0];
      const text = choice?.message?.content;

      if (text) {
        return { object: JSON.parse(text), usage: normalizeUsage(payload.usage) };
      }

      // Provedor com thinking ligado (não-DeepSeek) que gastou tudo em
      // raciocínio: a próxima tentativa vai explicitamente sem raciocínio.
      const reasoningAteBudget =
        choice?.finish_reason === "length" && Boolean(choice?.message?.reasoning_content);

      console.warn(
        `[ai] ${model}: resposta vazia na tentativa ${attempt}/${MAX_ATTEMPTS} ${describeEmpty(payload)}`,
      );

      if (attempt === MAX_ATTEMPTS) break;

      if (reasoningAteBudget && !thinkingOffDeStart) {
        // Refaz imediatamente sem raciocínio — a causa é conhecida, não é
        // sobrecarga; esperar não ajudaria.
        const retry = await call({ type: "disabled" }).catch(() => null);
        const retryText = retry?.choices?.[0]?.message?.content;
        if (retry) lastPayload = retry;
        if (retryText) {
          return { object: JSON.parse(retryText), usage: normalizeUsage(retry!.usage) };
        }
      }

      await sleep(RETRY_DELAY_MS * attempt);
    }

    const raw = JSON.stringify(lastPayload ?? {}).slice(0, 300);
    throw new Error(
      `resposta vazia do provedor apos ${MAX_ATTEMPTS} tentativas ${describeEmpty(
        lastPayload ?? {},
      )} · ${raw}`,
    );
  }
}
