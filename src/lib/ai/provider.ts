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

// Preço padrão por modelo, em USD por 1 milhão de tokens (input / output).
// São editáveis no painel (persistidos em ai_config.model_prices, que
// sobrescreve este mapa). Valores aproximados de mercado — ajuste na tela.
export interface ModelPrice {
  input: number;
  output: number;
}

export const DEFAULT_MODEL_PRICES: Record<string, ModelPrice> = {
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4o": { input: 2.5, output: 10.0 },
  "gpt-5-mini": { input: 0.25, output: 2.0 },
  "deepseek-chat": { input: 0.27, output: 1.1 },
  "deepseek-reasoner": { input: 0.55, output: 2.19 },
};

export const DEFAULT_USD_BRL_RATE = 5.5;

interface AiConfigRow {
  active_provider: AiProviderName;
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
  opts: { capability?: AiCapability } = {},
): Promise<ResolvedAiProvider> {
  const capability = opts.capability ?? "text";

  const db = createAdminClientIfAvailable();
  let cfg: AiConfigRow | null = null;
  let rows: ProviderRow[] = [];

  if (db) {
    try {
      const [{ data: cfgData }, { data: provData }] = await Promise.all([
        db.from("ai_config").select("active_provider, usd_brl_rate, model_prices").eq("id", 1).maybeSingle(),
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

  // 1. Provedor desejado (config), com override de capacidade.
  let activeName: AiProviderName = cfg?.active_provider ?? "openai";
  if (!providerSupports(activeName, capability)) activeName = "openai";

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
  const baseURL = finalRow?.base_url || builtin?.baseURL || undefined;
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
}

// Normaliza o objeto `usage` do AI SDK (v6: inputTokens/outputTokens) e também
// aceita o formato snake_case da API crua (prompt_tokens/completion_tokens).
export function normalizeUsage(u: unknown): AiUsageTokens {
  const usage = (u ?? {}) as Record<string, number | undefined>;
  const inputTokens = usage.inputTokens ?? usage.promptTokens ?? usage.prompt_tokens ?? 0;
  const outputTokens = usage.outputTokens ?? usage.completionTokens ?? usage.completion_tokens ?? 0;
  const totalTokens = usage.totalTokens ?? usage.total_tokens ?? inputTokens + outputTokens;
  return { inputTokens, outputTokens, totalTokens };
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

    const price = priceForModel(params.modelName, params.modelPrices);
    const costUsd = (inTok / 1_000_000) * price.input + (outTok / 1_000_000) * price.output;
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
