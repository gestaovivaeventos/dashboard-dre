import { NextResponse } from "next/server";

interface Indicator {
  name: string;
  value: string;
  change: string;
  changeType: "up" | "down" | "neutral";
  color: string;
  label: string;
}

// BCB API: https://api.bcb.gov.br/dados/serie/bcdata.sgs.{code}/dados/ultimos/1?formato=json
// SELIC = 432, IPCA mensal = 433
// AwesomeAPI for USD: https://economia.awesomeapi.com.br/json/last/USD-BRL

let cachedData: { indicators: Indicator[]; fetchedAt: number } | null = null;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

async function fetchJSON(url: string): Promise<unknown> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    console.warn(`[indicators] fetch failed: ${url} → ${res.status}`);
    return null;
  }
  return res.json();
}

async function fetchIndicators(): Promise<Indicator[]> {
  const indicators: Indicator[] = [];

  try {
    // SELIC
    const selicData = await fetchJSON("https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados/ultimos/1?formato=json") as Array<{ valor: string }> | null;
    if (selicData && selicData[0]) {
      indicators.push({
        name: "selic",
        value: `${Number(selicData[0].valor).toFixed(2)}%`,
        change: "ao ano",
        changeType: "neutral",
        color: "#3b82f6",
        label: "SELIC",
      });
    }
  } catch { /* skip */ }

  try {
    // IPCA
    const ipcaData = await fetchJSON("https://api.bcb.gov.br/dados/serie/bcdata.sgs.433/dados/ultimos/2?formato=json") as Array<{ valor: string }> | null;
    if (ipcaData && ipcaData.length >= 2) {
      const current = Number(ipcaData[1].valor);
      const prev = Number(ipcaData[0].valor);
      indicators.push({
        name: "ipca",
        value: `${current.toFixed(2)}%`,
        change: `${current >= prev ? "+" : ""}${(current - prev).toFixed(2)}% vs mes ant.`,
        changeType: current > prev ? "up" : current < prev ? "down" : "neutral",
        color: "#f59e0b",
        label: "IPCA",
      });
    }
  } catch { /* skip */ }

  try {
    // USD/BRL
    const usdData = await fetchJSON("https://economia.awesomeapi.com.br/json/last/USD-BRL") as { USDBRL?: { bid: string; pctChange: string } } | null;
    if (usdData?.USDBRL) {
      const bid = Number(usdData.USDBRL.bid);
      const pct = Number(usdData.USDBRL.pctChange);
      indicators.push({
        name: "dolar",
        value: `R$ ${bid.toFixed(2)}`,
        change: `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}% hoje`,
        changeType: pct < 0 ? "down" : pct > 0 ? "up" : "neutral",
        color: "#10b981",
        label: "DOLAR",
      });
    }
  } catch { /* skip */ }

  try {
    // IBOVESPA via Yahoo Finance
    const ibovData = await fetchJSON("https://query1.finance.yahoo.com/v8/finance/chart/%5EBVSP?interval=1d&range=1d") as {
      chart?: { result?: Array<{ meta?: { regularMarketPrice: number; chartPreviousClose: number } }> }
    } | null;
    const meta = ibovData?.chart?.result?.[0]?.meta;
    if (meta) {
      const price = meta.regularMarketPrice;
      const prevClose = meta.chartPreviousClose;
      const pct = prevClose ? ((price - prevClose) / prevClose) * 100 : 0;
      indicators.push({
        name: "ibovespa",
        value: price.toLocaleString("pt-BR", { maximumFractionDigits: 0 }),
        change: `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}% hoje`,
        changeType: pct > 0 ? "up" : pct < 0 ? "down" : "neutral",
        color: "#8b5cf6",
        label: "IBOVESPA",
      });
    }
  } catch { /* skip */ }

  return indicators;
}

export async function GET() {
  if (cachedData && Date.now() - cachedData.fetchedAt < CACHE_TTL) {
    return NextResponse.json({ indicators: cachedData.indicators });
  }

  const indicators = await fetchIndicators();
  cachedData = { indicators, fetchedAt: Date.now() };
  return NextResponse.json({ indicators });
}
