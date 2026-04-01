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
  const res = await fetch(url, { next: { revalidate: 3600 } });
  if (!res.ok) return null;
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
    // IBOVESPA via AwesomeAPI
    const ibovData = await fetchJSON("https://economia.awesomeapi.com.br/json/last/IBOV") as { IBOV?: { bid: string; pctChange: string } } | null;
    if (ibovData?.IBOV) {
      const bid = Number(ibovData.IBOV.bid);
      const pct = Number(ibovData.IBOV.pctChange);
      indicators.push({
        name: "ibovespa",
        value: bid.toLocaleString("pt-BR", { maximumFractionDigits: 0 }),
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
