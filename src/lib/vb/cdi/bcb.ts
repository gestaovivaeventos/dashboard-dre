// src/lib/vb/cdi/bcb.ts
// Fronteira com o SGS do Banco Central. O parsing é separado da rede para ser
// testável sem internet.

import { VB_CDI_SGS_SERIES } from "@/lib/vb/cdi/config";

export interface CdiRate {
  /** 'YYYY-MM-DD' */
  rate_date: string;
  /** Percentual ao dia, como o BCB publica (0.05166 = 0,05166% a.d.). */
  rate: number;
}

const BCB_DATE = /^(\d{2})\/(\d{2})\/(\d{4})$/;

/** '2026-09-10' → '10/09/2026'. */
export function toBcbDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export function cdiRangeUrl(from: string, to: string): string {
  const url = new URL(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.${VB_CDI_SGS_SERIES}/dados`);
  url.searchParams.set("formato", "json");
  url.searchParams.set("dataInicial", toBcbDate(from));
  url.searchParams.set("dataFinal", toBcbDate(to));
  return url.toString();
}

/** Linha quebrada é descartada; corpo de erro do BCB vira lista vazia. */
export function parseCdiPayload(payload: unknown): CdiRate[] {
  if (!Array.isArray(payload)) return [];
  const rows: CdiRate[] = [];
  for (const item of payload) {
    if (!item || typeof item !== "object") continue;
    const record = item as { data?: unknown; valor?: unknown };
    if (typeof record.data !== "string" || typeof record.valor !== "string") continue;
    const match = BCB_DATE.exec(record.data);
    if (!match) continue;
    const rate = Number(record.valor);
    if (!Number.isFinite(rate) || rate < 0) continue;
    rows.push({ rate_date: `${match[3]}-${match[2]}-${match[1]}`, rate });
  }
  return rows;
}

/**
 * Taxas do intervalo. O SGS devolve **404 quando não há taxa no período**
 * (fim de semana, feriado, futuro) — isso é "nada novo", não falha.
 */
export async function fetchCdiRange(from: string, to: string): Promise<CdiRate[]> {
  if (to < from) return [];
  const response = await fetch(cdiRangeUrl(from, to), { cache: "no-store" });
  if (response.status === 404) return [];
  if (!response.ok) throw new Error(`BCB SGS ${response.status} fetching CDI ${from}..${to}`);
  return parseCdiPayload(await response.json());
}
