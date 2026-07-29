"use server";

import { revalidatePath } from "next/cache";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret, encryptSecret } from "@/lib/security/encryption";
import {
  AI_MODULE_LABELS,
  AI_PROVIDER_LABELS,
  DEFAULT_MODEL_PRICES,
  DEFAULT_USD_BRL_RATE,
  type AiModule,
  type AiProviderName,
  type ModelPrice,
} from "@/lib/ai/provider";

// ============================================================================
// Server actions do painel de IA (/admin/ia). Todas exigem admin.
//   - getAiPanelData()      — config + provedores + resumo de consumo (custo R$)
//   - setActiveProvider()   — troca o provedor ativo (BI + demais fluxos)
//   - saveProviderSettings()— habilita/desabilita + modelo padrão do provedor
//   - saveProviderKey()     — grava/limpa a chave (criptografada)
//   - saveUsdBrlRate()      — câmbio USD→BRL usado no custo em reais
//   - saveModelPrices()     — tabela de preços por modelo (USD/1M tokens)
// ============================================================================

async function requireAdmin() {
  const ctx = await getCurrentSessionContext();
  if (!ctx.user || !ctx.profile || ctx.profile.role !== "admin") {
    throw new Error("Acesso restrito ao administrador.");
  }
  return ctx;
}

// Provedores embutidos: têm fallback por variável de ambiente e NÃO podem ser
// removidos. Qualquer outro é adicionado pelo admin (compatível com a API da
// OpenAI) e guarda base_url + chave no banco.
const BUILTIN_PROVIDERS = ["openai", "deepseek"] as const;
type BuiltinProvider = (typeof BUILTIN_PROVIDERS)[number];

const BUILTIN_ENV_KEY: Record<BuiltinProvider, string> = {
  openai: "OPENAI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
};

const BUILTIN_LABEL: Record<BuiltinProvider, string> = {
  openai: "OpenAI",
  deepseek: "DeepSeek",
};

const BUILTIN_DEFAULT_MODEL: Record<BuiltinProvider, string> = {
  openai: "gpt-4o-mini",
  deepseek: "deepseek-chat",
};

const BUILTIN_BASE_URL: Record<BuiltinProvider, string | undefined> = {
  openai: undefined, // base padrão do SDK
  deepseek: "https://api.deepseek.com",
};

function chatUrlFromBase(baseURL: string | undefined): string {
  return `${baseURL ?? "https://api.openai.com/v1"}/chat/completions`;
}

// Só a OpenAI faz visão (OCR) e web search no nosso stack; qualquer outro
// provedor só atende texto e esses fluxos continuam na OpenAI.
const NON_OPENAI_CAPABILITY_NOTE =
  "Não faz OCR de documentos (visão) nem busca na web — esses fluxos continuam na OpenAI automaticamente.";

function isBuiltin(p: string): p is BuiltinProvider {
  return (BUILTIN_PROVIDERS as readonly string[]).includes(p);
}

// slug válido para provedor: minúsculas, números, hífen/underscore.
function normalizeSlug(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// ─── Cotação do dólar comercial (automática) ─────────────────────────────────
const USD_STALE_MS = 3 * 60 * 60 * 1000; // revalida se a última cotação tem +3h

// Busca a cotação USD→BRL de fontes gratuitas, com fallback. Devolve o motivo
// da falha quando as duas fontes não respondem (para o painel exibir).
async function fetchCommercialUsdBrl(): Promise<{ rate: number } | { error: string }> {
  const errors: string[] = [];

  // 1. AwesomeAPI — dólar comercial (média compra/venda).
  try {
    const res = await fetch("https://economia.awesomeapi.com.br/last/USD-BRL", { cache: "no-store" });
    if (res.ok) {
      const json = (await res.json()) as { USDBRL?: { bid?: string; ask?: string } };
      const bid = Number(json.USDBRL?.bid);
      const ask = Number(json.USDBRL?.ask);
      const mid = Number.isFinite(bid) && Number.isFinite(ask) ? (bid + ask) / 2 : bid || ask;
      if (Number.isFinite(mid) && mid > 0) return { rate: Number(mid.toFixed(4)) };
      errors.push("AwesomeAPI: resposta sem cotação");
    } else {
      errors.push(`AwesomeAPI HTTP ${res.status}`);
    }
  } catch (e) {
    errors.push(`AwesomeAPI: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 2. Fallback — open.er-api.com (sem chave).
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD", { cache: "no-store" });
    if (res.ok) {
      const json = (await res.json()) as { rates?: { BRL?: number } };
      const brl = Number(json.rates?.BRL);
      if (Number.isFinite(brl) && brl > 0) return { rate: Number(brl.toFixed(4)) };
      errors.push("er-api: resposta sem BRL");
    } else {
      errors.push(`er-api HTTP ${res.status}`);
    }
  } catch (e) {
    errors.push(`er-api: ${e instanceof Error ? e.message : String(e)}`);
  }

  return { error: errors.join(" | ") };
}

export interface ModuleUsage {
  module: AiModule;
  label: string;
  calls: number;
  totalTokens: number;
  costBrl: number;
  costUsd: number;
}

export interface ProviderUsage {
  provider: AiProviderName;
  calls: number;
  totalTokens: number;
  costBrl: number;
  costUsd: number;
}

export interface UsageBucket {
  costBrl: number;
  costUsd: number;
  totalTokens: number;
  calls: number;
  byModule: ModuleUsage[];
  byProvider: ProviderUsage[];
}

export interface UsageSummary {
  today: UsageBucket;
  month: UsageBucket;
  total: UsageBucket;
  daily: Array<{ day: string; costBrl: number; totalTokens: number }>;
  byProvider: Array<{ provider: AiProviderName; label: string; costBrl: number; totalTokens: number; calls: number }>;
}

export interface AiProviderView {
  provider: AiProviderName;
  label: string;
  enabled: boolean;
  model: string;
  baseUrl: string | null;
  hasKey: boolean;
  hasEnvKey: boolean;
  isBuiltin: boolean;
  canDelete: boolean;
  capabilityNote?: string;
}

export interface AiPanelData {
  activeProvider: AiProviderName;
  usdBrlRate: number;
  usdBrlAuto: boolean;
  usdBrlUpdatedAt: string | null;
  /** Alíquota de IOF (%) para compras em dólar (requisições de Compras). */
  usdIofRate: number;
  modelPrices: Record<string, ModelPrice>;
  providers: AiProviderView[];
  usage: UsageSummary;
}

// ─── Helpers de agregação ────────────────────────────────────────────────────

// "Hoje" no fuso de São Paulo (BRT, UTC-3, sem horário de verão desde 2019).
function brtTodayInfo() {
  const brtNow = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const today = brtNow.toISOString().slice(0, 10); // YYYY-MM-DD
  const monthPrefix = today.slice(0, 7); // YYYY-MM
  return { today, monthPrefix };
}

function emptyBucket(): UsageBucket {
  return { costBrl: 0, costUsd: 0, totalTokens: 0, calls: 0, byModule: [], byProvider: [] };
}

function moduleLabel(m: string): string {
  return AI_MODULE_LABELS[m as AiModule] ?? m;
}

// Consolida as linhas num bucket com total + quebra por módulo E por provedor.
function buildBucket(
  rows: Array<{
    module: string;
    provider: string;
    calls: number;
    totalTokens: number;
    costBrl: number;
    costUsd: number;
  }>,
): UsageBucket {
  const byModuleMap = new Map<string, ModuleUsage>();
  const byProviderMap = new Map<string, ProviderUsage>();
  const bucket = emptyBucket();
  for (const r of rows) {
    bucket.costBrl += r.costBrl;
    bucket.costUsd += r.costUsd;
    bucket.totalTokens += r.totalTokens;
    bucket.calls += r.calls;

    const em = byModuleMap.get(r.module);
    if (em) {
      em.calls += r.calls;
      em.totalTokens += r.totalTokens;
      em.costBrl += r.costBrl;
      em.costUsd += r.costUsd;
    } else {
      byModuleMap.set(r.module, {
        module: r.module as AiModule,
        label: moduleLabel(r.module),
        calls: r.calls,
        totalTokens: r.totalTokens,
        costBrl: r.costBrl,
        costUsd: r.costUsd,
      });
    }

    const ep = byProviderMap.get(r.provider);
    if (ep) {
      ep.calls += r.calls;
      ep.totalTokens += r.totalTokens;
      ep.costBrl += r.costBrl;
      ep.costUsd += r.costUsd;
    } else {
      byProviderMap.set(r.provider, {
        provider: r.provider,
        calls: r.calls,
        totalTokens: r.totalTokens,
        costBrl: r.costBrl,
        costUsd: r.costUsd,
      });
    }
  }
  bucket.byModule = Array.from(byModuleMap.values()).sort((a, b) => b.costBrl - a.costBrl);
  bucket.byProvider = Array.from(byProviderMap.values()).sort((a, b) => b.costBrl - a.costBrl);
  return bucket;
}

async function loadUsageSummary(): Promise<UsageSummary> {
  const db = createAdminClient();
  const { today, monthPrefix } = brtTodayInfo();
  const sinceIso = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();

  const [summaryRes, totalsRes] = await Promise.all([
    db.rpc("ai_usage_summary", { p_since: sinceIso }),
    db.rpc("ai_usage_totals"),
  ]);

  type SummaryRow = {
    module: string;
    day: string;
    provider: string;
    total_tokens: number | string;
    cost_usd: number | string;
    cost_brl: number | string;
    calls: number | string;
  };
  type TotalsRow = {
    module: string;
    provider: string;
    total_tokens: number | string;
    cost_usd: number | string;
    cost_brl: number | string;
    calls: number | string;
  };

  const summaryRows = ((summaryRes.data as SummaryRow[] | null) ?? []).map((r) => ({
    module: r.module,
    day: String(r.day).slice(0, 10),
    provider: r.provider,
    totalTokens: Number(r.total_tokens) || 0,
    costUsd: Number(r.cost_usd) || 0,
    costBrl: Number(r.cost_brl) || 0,
    calls: Number(r.calls) || 0,
  }));

  const todayBucket = buildBucket(summaryRows.filter((r) => r.day === today));
  const monthBucket = buildBucket(summaryRows.filter((r) => r.day.startsWith(monthPrefix)));

  // Série diária (últimos 30 dias) — soma por dia.
  const dailyMap = new Map<string, { costBrl: number; totalTokens: number }>();
  for (const r of summaryRows) {
    const cur = dailyMap.get(r.day) ?? { costBrl: 0, totalTokens: 0 };
    cur.costBrl += r.costBrl;
    cur.totalTokens += r.totalTokens;
    dailyMap.set(r.day, cur);
  }
  const daily = Array.from(dailyMap.entries())
    .map(([day, v]) => ({ day, ...v }))
    .sort((a, b) => a.day.localeCompare(b.day))
    .slice(-30);

  // Totais acumulados (todo o histórico).
  const totalsRows = ((totalsRes.data as TotalsRow[] | null) ?? []).map((r) => ({
    module: r.module,
    provider: r.provider as AiProviderName,
    totalTokens: Number(r.total_tokens) || 0,
    costUsd: Number(r.cost_usd) || 0,
    costBrl: Number(r.cost_brl) || 0,
    calls: Number(r.calls) || 0,
  }));

  const totalBucket = buildBucket(totalsRows);

  const providerMap = new Map<AiProviderName, { costBrl: number; totalTokens: number; calls: number }>();
  for (const r of totalsRows) {
    const cur = providerMap.get(r.provider) ?? { costBrl: 0, totalTokens: 0, calls: 0 };
    cur.costBrl += r.costBrl;
    cur.totalTokens += r.totalTokens;
    cur.calls += r.calls;
    providerMap.set(r.provider, cur);
  }
  const byProvider = Array.from(providerMap.entries()).map(([provider, v]) => ({
    provider,
    label: AI_PROVIDER_LABELS[provider] ?? provider,
    ...v,
  }));

  return { today: todayBucket, month: monthBucket, total: totalBucket, daily, byProvider };
}

// ─── Loader principal do painel ──────────────────────────────────────────────

export async function getAiPanelData(): Promise<AiPanelData> {
  await requireAdmin();
  const db = createAdminClient();

  const [{ data: cfg }, { data: provRows }] = await Promise.all([
    db
      .from("ai_config")
      .select("active_provider, usd_brl_rate, usd_brl_auto, usd_brl_updated_at, usd_iof_rate, model_prices")
      .eq("id", 1)
      .maybeSingle(),
    db.from("ai_provider_settings").select("provider, label, base_url, enabled, api_key_encrypted, model"),
  ]);

  const rows = (provRows as Array<{
    provider: string;
    label: string | null;
    base_url: string | null;
    enabled: boolean;
    api_key_encrypted: string | null;
    model: string | null;
  }> | null) ?? [];

  const modelPrices: Record<string, ModelPrice> = { ...DEFAULT_MODEL_PRICES };
  const override = (cfg?.model_prices as Record<string, ModelPrice> | null) ?? null;
  if (override) {
    for (const [model, price] of Object.entries(override)) {
      if (price && typeof price === "object") {
        const base = modelPrices[model];
        modelPrices[model] = {
          input: Number(price.input) || 0,
          output: Number(price.output) || 0,
          cachedInput:
            price.cachedInput != null && Number.isFinite(Number(price.cachedInput))
              ? Number(price.cachedInput)
              : base?.cachedInput,
        };
      }
    }
  }

  // Provedores: embutidos sempre presentes + customizados do banco.
  const bySlug = new Map(rows.map((r) => [r.provider, r]));
  const slugs: string[] = [...BUILTIN_PROVIDERS];
  for (const r of rows) if (!slugs.includes(r.provider)) slugs.push(r.provider);

  const providers: AiProviderView[] = slugs.map((p) => {
    const row = bySlug.get(p);
    const builtin = isBuiltin(p);
    return {
      provider: p,
      label: row?.label || (builtin ? BUILTIN_LABEL[p] : p),
      enabled: row?.enabled ?? true,
      model: row?.model || (builtin ? BUILTIN_DEFAULT_MODEL[p] : ""),
      baseUrl: row?.base_url ?? null,
      hasKey: Boolean(row?.api_key_encrypted),
      hasEnvKey: builtin ? Boolean(process.env[BUILTIN_ENV_KEY[p]]) : false,
      isBuiltin: builtin,
      canDelete: !builtin,
      capabilityNote: p === "openai" ? undefined : NON_OPENAI_CAPABILITY_NOTE,
    };
  });

  // Garante uma linha de preço para o modelo de CADA provedor (mesmo os que não
  // têm default) — assim o custo do modelo novo não fica preso em R$ 0 e o admin
  // pode informar o preço na tabela.
  for (const pv of providers) {
    const m = pv.model.trim();
    if (m && !(m in modelPrices)) modelPrices[m] = { input: 0, output: 0, cachedInput: 0 };
  }

  // Câmbio: se automático e desatualizado (>3h), busca a cotação comercial agora
  // e persiste (o resolver usa o valor gravado no custo das chamadas).
  let usdBrlRate = Number(cfg?.usd_brl_rate) || DEFAULT_USD_BRL_RATE;
  const usdBrlAuto = cfg?.usd_brl_auto ?? true;
  let usdBrlUpdatedAt = (cfg?.usd_brl_updated_at as string | null) ?? null;
  if (usdBrlAuto) {
    const stale = !usdBrlUpdatedAt || Date.now() - new Date(usdBrlUpdatedAt).getTime() > USD_STALE_MS;
    if (stale) {
      const fresh = await fetchCommercialUsdBrl();
      if ("rate" in fresh) {
        const now = new Date().toISOString();
        await db.from("ai_config").update({ usd_brl_rate: fresh.rate, usd_brl_updated_at: now }).eq("id", 1);
        usdBrlRate = fresh.rate;
        usdBrlUpdatedAt = now;
      }
    }
  }

  const usage = await loadUsageSummary();

  return {
    activeProvider: (cfg?.active_provider as AiProviderName) ?? "openai",
    usdBrlRate,
    usdBrlAuto,
    usdBrlUpdatedAt,
    usdIofRate: cfg?.usd_iof_rate != null ? Number(cfg.usd_iof_rate) : 3.5,
    modelPrices,
    providers,
    usage,
  };
}

// Só para recarregar o dashboard de consumo sem recarregar toda a página.
export async function refreshUsageSummary(): Promise<UsageSummary> {
  await requireAdmin();
  return loadUsageSummary();
}

// ─── Mutations ───────────────────────────────────────────────────────────────

export async function setActiveProvider(
  provider: string,
): Promise<{ ok: true } | { error: string }> {
  await requireAdmin();
  const slug = provider.trim();
  if (!slug) return { error: "Provedor inválido." };
  const db = createAdminClient();
  // Provedor customizado precisa existir na tabela; embutido é sempre válido.
  if (!isBuiltin(slug)) {
    const { data } = await db.from("ai_provider_settings").select("provider").eq("provider", slug).maybeSingle();
    if (!data) return { error: "Provedor não encontrado." };
  }
  const { error } = await db
    .from("ai_config")
    .update({ active_provider: slug, updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (error) return { error: error.message };
  revalidatePath("/admin/ia");
  return { ok: true };
}

export async function saveProviderSettings(
  provider: string,
  settings: { enabled: boolean; model: string; baseUrl?: string | null },
): Promise<{ ok: true } | { error: string }> {
  await requireAdmin();
  const slug = provider.trim();
  if (!slug) return { error: "Provedor inválido." };
  const model = settings.model.trim();
  if (!model) return { error: "Informe o modelo." };
  const db = createAdminClient();
  const patch: Record<string, unknown> = {
    provider: slug,
    enabled: settings.enabled,
    model,
    updated_at: new Date().toISOString(),
  };
  if (settings.baseUrl !== undefined) {
    const b = (settings.baseUrl ?? "").trim();
    patch.base_url = b || null;
  }
  const { error } = await db.from("ai_provider_settings").upsert(patch, { onConflict: "provider" });
  if (error) return { error: error.message };
  revalidatePath("/admin/ia");
  return { ok: true };
}

// Grava a chave criptografada. String vazia → limpa (embutidos voltam à env var;
// customizados ficam sem chave).
//
// UPDATE (não upsert): a linha já existe (o "Salvar" grava as configurações,
// com `model`, antes de chamar isto; e o "Remover chave" só aparece quando há
// linha). Um upsert aqui faria INSERT ... ON CONFLICT, e o Postgres valida o
// NOT NULL de `model` no candidato do INSERT mesmo quando a linha já existe —
// como este passo não manda `model`, violaria a constraint.
export async function saveProviderKey(
  provider: string,
  apiKey: string,
): Promise<{ ok: true } | { error: string }> {
  await requireAdmin();
  const slug = provider.trim();
  if (!slug) return { error: "Provedor inválido." };
  const db = createAdminClient();
  const trimmed = apiKey.trim();
  const encrypted = trimmed ? encryptSecret(trimmed) : null;
  const { error } = await db
    .from("ai_provider_settings")
    .update({ api_key_encrypted: encrypted, updated_at: new Date().toISOString() })
    .eq("provider", slug);
  if (error) return { error: error.message };
  revalidatePath("/admin/ia");
  return { ok: true };
}

// Adiciona um novo provedor (compatível com a API da OpenAI).
export async function addProvider(input: {
  slug: string;
  label: string;
  baseUrl: string;
  model: string;
  apiKey: string;
}): Promise<{ ok: true } | { error: string }> {
  await requireAdmin();
  const slug = normalizeSlug(input.slug);
  if (!slug) return { error: "Informe um identificador válido (ex.: groq)." };
  if (isBuiltin(slug)) return { error: `"${slug}" é um provedor embutido — já existe.` };

  const label = input.label.trim() || slug;
  const baseUrl = input.baseUrl.trim();
  if (!/^https?:\/\//i.test(baseUrl)) return { error: "Base URL deve começar com http(s)://." };
  const model = input.model.trim();
  if (!model) return { error: "Informe o modelo padrão." };
  const key = input.apiKey.trim();
  if (!key) return { error: "Informe a chave de API do provedor." };

  const db = createAdminClient();
  const { data: existing } = await db
    .from("ai_provider_settings")
    .select("provider")
    .eq("provider", slug)
    .maybeSingle();
  if (existing) return { error: `Já existe um provedor com o identificador "${slug}".` };

  const { error } = await db.from("ai_provider_settings").insert({
    provider: slug,
    label,
    base_url: baseUrl,
    model,
    enabled: true,
    api_key_encrypted: encryptSecret(key),
    updated_at: new Date().toISOString(),
  });
  if (error) return { error: error.message };
  revalidatePath("/admin/ia");
  return { ok: true };
}

// Remove um provedor customizado. Se era o ativo, volta para a OpenAI.
export async function deleteProvider(provider: string): Promise<{ ok: true } | { error: string }> {
  await requireAdmin();
  const slug = provider.trim();
  if (isBuiltin(slug)) return { error: "Provedores embutidos não podem ser removidos." };
  const db = createAdminClient();
  const { data: cfg } = await db.from("ai_config").select("active_provider").eq("id", 1).maybeSingle();
  if (cfg?.active_provider === slug) {
    await db
      .from("ai_config")
      .update({ active_provider: "openai", updated_at: new Date().toISOString() })
      .eq("id", 1);
  }
  const { error } = await db.from("ai_provider_settings").delete().eq("provider", slug);
  if (error) return { error: error.message };
  revalidatePath("/admin/ia");
  return { ok: true };
}

// ─── Câmbio USD→BRL ──────────────────────────────────────────────────────────

// Alíquota de IOF (%) para compras em dólar das requisições de Compras.
export async function saveUsdIofRate(rate: number): Promise<{ ok: true } | { error: string }> {
  await requireAdmin();
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) return { error: "IOF inválido (0 a 100%)." };
  const db = createAdminClient();
  const { error } = await db
    .from("ai_config")
    .update({ usd_iof_rate: rate, updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (error) return { error: error.message };
  revalidatePath("/admin/ia");
  return { ok: true };
}

// Câmbio manual: grava o valor e DESLIGA o automático.
export async function saveUsdBrlRate(rate: number): Promise<{ ok: true } | { error: string }> {
  await requireAdmin();
  if (!Number.isFinite(rate) || rate <= 0) return { error: "Câmbio inválido." };
  const db = createAdminClient();
  const now = new Date().toISOString();
  const { error } = await db
    .from("ai_config")
    .update({ usd_brl_rate: rate, usd_brl_auto: false, usd_brl_updated_at: now, updated_at: now })
    .eq("id", 1);
  if (error) return { error: error.message };
  revalidatePath("/admin/ia");
  return { ok: true };
}

// Liga/desliga a cotação automática. Ao ligar, já busca a cotação atual.
export async function setUsdRateAuto(
  auto: boolean,
): Promise<{ ok: true; rate?: number; updatedAt?: string } | { error: string }> {
  await requireAdmin();
  const db = createAdminClient();
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { usd_brl_auto: auto, updated_at: now };
  let rate: number | undefined;
  let updatedAt: string | undefined;
  if (auto) {
    const fresh = await fetchCommercialUsdBrl();
    if ("rate" in fresh) {
      patch.usd_brl_rate = fresh.rate;
      patch.usd_brl_updated_at = now;
      rate = fresh.rate;
      updatedAt = now;
    }
  }
  const { error } = await db.from("ai_config").update(patch).eq("id", 1);
  if (error) return { error: error.message };
  revalidatePath("/admin/ia");
  return { ok: true, rate, updatedAt };
}

// Força a atualização da cotação do dólar comercial agora.
export async function refreshUsdRate(): Promise<
  { ok: true; rate: number; updatedAt: string } | { error: string }
> {
  await requireAdmin();
  const fresh = await fetchCommercialUsdBrl();
  if ("error" in fresh) {
    return { error: `Não foi possível obter a cotação: ${fresh.error}` };
  }
  const db = createAdminClient();
  const now = new Date().toISOString();
  const { error } = await db
    .from("ai_config")
    .update({ usd_brl_rate: fresh.rate, usd_brl_updated_at: now, updated_at: now })
    .eq("id", 1);
  if (error) return { error: error.message };
  revalidatePath("/admin/ia");
  return { ok: true, rate: fresh.rate, updatedAt: now };
}

// ─── Teste de conexão ────────────────────────────────────────────────────────

// Faz uma chamada mínima de chat completion para validar base_url + chave +
// modelo. Aceita valores do formulário (provedor ainda não salvo) ou de um
// provedor já existente (busca a chave/base salvas, com fallback env p/ embutidos).
export async function testProviderConnection(input: {
  provider?: string;
  baseUrl?: string;
  apiKey?: string;
  model: string;
}): Promise<{ ok: true; latencyMs: number; sample: string } | { error: string }> {
  await requireAdmin();

  const model = input.model.trim();
  if (!model) return { error: "Informe o modelo para testar." };

  let apiKey = (input.apiKey ?? "").trim();
  let baseUrl = (input.baseUrl ?? "").trim() || undefined;
  const slug = input.provider?.trim();

  // Sem chave no formulário → tenta a do provedor salvo (e env, se embutido).
  if (!apiKey && slug) {
    const db = createAdminClient();
    const { data } = await db
      .from("ai_provider_settings")
      .select("api_key_encrypted, base_url")
      .eq("provider", slug)
      .maybeSingle();
    if (data?.api_key_encrypted) {
      try {
        apiKey = decryptSecret(data.api_key_encrypted);
      } catch {
        /* chave corrompida — cai no env abaixo */
      }
    }
    if (!baseUrl && data?.base_url) baseUrl = data.base_url;
    if (isBuiltin(slug)) {
      if (!apiKey) {
        const env = process.env[BUILTIN_ENV_KEY[slug]];
        if (env) apiKey = env;
      }
      if (!baseUrl) baseUrl = BUILTIN_BASE_URL[slug];
    }
  }

  if (!apiKey) {
    return { error: "Sem chave de API para testar (informe a chave ou salve o provedor)." };
  }

  const url = chatUrlFromBase(baseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Responda apenas: ok" }],
        max_tokens: 5,
        temperature: 0,
      }),
      signal: controller.signal,
    });
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { error: `HTTP ${res.status}: ${body.slice(0, 200) || res.statusText}` };
    }
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const sample = json.choices?.[0]?.message?.content?.trim() || "(resposta vazia)";
    return { ok: true, latencyMs, sample };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return { error: "Tempo esgotado ao conectar (20s)." };
    }
    return { error: `Falha de rede: ${e instanceof Error ? e.message : String(e)}` };
  } finally {
    clearTimeout(timer);
  }
}

export async function saveModelPrices(
  prices: Record<string, { input: number; output: number; cachedInput?: number }>,
): Promise<{ ok: true } | { error: string }> {
  await requireAdmin();
  const db = createAdminClient();

  // Mescla sobre o que já existe no banco (não apaga preços de modelos ausentes).
  const { data: cfg } = await db.from("ai_config").select("model_prices").eq("id", 1).maybeSingle();
  const current = ((cfg?.model_prices as Record<string, ModelPrice> | null) ?? {}) as Record<string, ModelPrice>;
  const merged: Record<string, ModelPrice> = { ...current };
  for (const [model, price] of Object.entries(prices)) {
    const input = Number(price.input);
    const output = Number(price.output);
    if (!model.trim() || !Number.isFinite(input) || !Number.isFinite(output)) continue;
    const cachedInput =
      price.cachedInput != null && Number.isFinite(Number(price.cachedInput)) ? Number(price.cachedInput) : undefined;
    merged[model] = cachedInput != null ? { input, output, cachedInput } : { input, output };
  }

  const { error } = await db
    .from("ai_config")
    .update({ model_prices: merged, updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (error) return { error: error.message };
  revalidatePath("/admin/ia");
  return { ok: true };
}
