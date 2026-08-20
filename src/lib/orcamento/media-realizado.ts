// Realizado do ano-base da MÉDIA — fonte ÚNICA do cálculo (meses fechados,
// soma, denominador, média). Módulo "puro" (sem "use server"): importado tanto
// pela action da tela de média (`actions/media.ts`) quanto pela Prévia do
// orçamento (`actions/previa-orcamento.ts`), para as duas telas NUNCA divergirem
// no número — a tela mostrava a sugestão ao vivo e a prévia lia só o snapshot,
// então categoria com valor "vivo" mas sem snapshot aparecia zerada na prévia.

import type { createClient } from "@/lib/supabase/server";
import { currentYearBR, currentMonthBR } from "@/lib/ctrl/datetime";

/** Realizado do ano-base de uma categoria, mês a mês. */
export interface MediaRealizado {
  /** 12 posições (jan…dez). null = mês sem pagamento no ano-base. */
  meses: (number | null)[];
  /** Soma dos meses FECHADOS do ano-base (o mês corrente e futuros ficam fora). */
  total: number;
  /** Quantos meses do ano-base já fecharam = denominador da média. Um mês
   * fechado zerado ENTRA na conta (conta como 0); o mês corrente não. */
  mesesConsiderados: number;
  /** total / mesesConsiderados. null quando nenhum mês fechou (ou sem realizado). */
  media: number | null;
}

export interface RealizadoRow {
  category_code: string;
  month: number;
  total: number | string;
}

/**
 * Quantos meses do ano-base já FECHARAM, contados em Brasília.
 * - ano-base no passado → 12 (ano fechado).
 * - ano-base = ano corrente → mês corrente − 1 (o mês em curso ainda não fechou;
 *   ex.: 19/08 → jan…jul = 7 meses fechados; agosto entra só em 01/09).
 * - ano-base no futuro → 0.
 * Contamos em Brasília para não "fechar" um mês cedo demais à meia-noite UTC.
 */
export function mesesFechados(baseYear: number): number {
  const anoAtual = currentYearBR();
  if (baseYear < anoAtual) return 12;
  if (baseYear > anoAtual) return 0;
  return Math.max(0, currentMonthBR() - 1);
}

/**
 * Média = soma dos meses FECHADOS ÷ nº de meses fechados. Um mês fechado sem
 * pagamento (null) entra como 0; o mês corrente e os futuros ficam de fora,
 * mesmo que já tenham algum pagamento parcial.
 */
export function resumirRealizado(
  meses: (number | null)[],
  mesesFechadosCount: number,
): MediaRealizado {
  let total = 0;
  for (let i = 0; i < 12; i += 1) {
    if (i >= mesesFechadosCount) break; // mês ainda não fechado: fora da conta
    total += meses[i] ?? 0; // mês fechado zerado conta como 0
  }
  const media = mesesFechadosCount > 0 ? total / mesesFechadosCount : null;
  return { meses, total, mesesConsiderados: mesesFechadosCount, media };
}

/** Agrupa as linhas do RPC (categoria × mês) em um realizado por categoria. */
export function buildRealizados(
  rows: RealizadoRow[],
  mesesFechadosCount: number,
): Map<string, MediaRealizado> {
  const byCode = new Map<string, (number | null)[]>();
  for (const r of rows) {
    const code = r.category_code;
    if (!byCode.has(code)) byCode.set(code, Array(12).fill(null));
    const meses = byCode.get(code)!;
    const idx = Number(r.month) - 1;
    if (idx >= 0 && idx < 12) meses[idx] = Number(r.total);
  }
  const out = new Map<string, MediaRealizado>();
  byCode.forEach((meses, code) => out.set(code, resumirRealizado(meses, mesesFechadosCount)));
  return out;
}

export const REALIZADO_VAZIO: MediaRealizado = {
  meses: Array(12).fill(null),
  total: 0,
  mesesConsiderados: 0,
  media: null,
};

/** Lê o realizado do ano-base para um conjunto de categorias (via RPC). */
export async function fetchRealizados(
  supabase: Awaited<ReturnType<typeof createClient>>,
  companyId: string,
  baseYear: number,
  codes: string[],
): Promise<Map<string, MediaRealizado>> {
  if (codes.length === 0) return new Map();
  const { data, error } = await supabase.rpc("orcamento_media_realizado", {
    p_company_id: companyId,
    p_base_year: baseYear,
    p_category_codes: codes,
  });
  if (error) return new Map();
  return buildRealizados((data ?? []) as RealizadoRow[], mesesFechados(baseYear));
}
