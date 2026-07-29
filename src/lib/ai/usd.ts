import { createAdminClient } from "@/lib/supabase/admin";

// Conversão USD→BRL para as compras em dólar das requisições de Compras.
// Reaproveita a MESMA cotação do painel de IA (ai_config.usd_brl_rate, dólar
// comercial automático) e a alíquota de IOF configurável (ai_config.usd_iof_rate).
//
// A cotação é revalidada "sob demanda": se `usd_brl_auto` está ligado e a última
// atualização tem mais de 3h, rebusca da AwesomeAPI e persiste — mesma regra do
// painel de IA (getAiPanelData). Não há cron; quem abre a tela de nova
// requisição também mantém a cotação fresca.

const USD_STALE_MS = 3 * 60 * 60 * 1000; // 3h
const DEFAULT_IOF_RATE = 3.5; // % — IOF de câmbio/cartão
const FALLBACK_RATE = 5; // defensivo: nunca deve ocorrer (config sempre tem cotação)

// Busca a cotação USD→BRL de fontes gratuitas, com fallback. Igual ao painel de IA.
async function fetchCommercialUsdBrl(): Promise<{ rate: number } | { error: string }> {
  const errors: string[] = [];
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

export interface UsdConversion {
  /** Câmbio USD→BRL (dólar comercial). */
  rate: number;
  /** Alíquota de IOF (%). */
  iofRate: number;
  /** ISO da última atualização do câmbio. */
  updatedAt: string | null;
}

// Lê (e revalida, se necessário) o câmbio + IOF da configuração de IA.
export async function getUsdConversion(): Promise<UsdConversion> {
  const db = createAdminClient();
  const { data: cfg } = await db
    .from("ai_config")
    .select("usd_brl_rate, usd_brl_auto, usd_brl_updated_at, usd_iof_rate")
    .eq("id", 1)
    .maybeSingle();

  let rate = Number(cfg?.usd_brl_rate) || 0;
  const iofRate = cfg?.usd_iof_rate != null ? Number(cfg.usd_iof_rate) : DEFAULT_IOF_RATE;
  let updatedAt = (cfg?.usd_brl_updated_at as string | null) ?? null;
  const auto = cfg?.usd_brl_auto ?? true;

  if (auto) {
    const stale = !updatedAt || Date.now() - new Date(updatedAt).getTime() > USD_STALE_MS;
    if (stale) {
      const fresh = await fetchCommercialUsdBrl();
      if ("rate" in fresh) {
        const now = new Date().toISOString();
        await db.from("ai_config").update({ usd_brl_rate: fresh.rate, usd_brl_updated_at: now }).eq("id", 1);
        rate = fresh.rate;
        updatedAt = now;
      }
    }
  }

  if (!Number.isFinite(rate) || rate <= 0) rate = FALLBACK_RATE;
  return { rate, iofRate: Number.isFinite(iofRate) ? iofRate : DEFAULT_IOF_RATE, updatedAt };
}

// Converte USD → BRL somando o IOF. Fonte única da fórmula (cliente e servidor).
export function convertUsdToBrl(usd: number, rate: number, iofPct: number): number {
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  return Math.round(usd * rate * (1 + iofPct / 100) * 100) / 100;
}
