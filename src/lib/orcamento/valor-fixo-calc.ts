// Projeção das despesas por VALOR FIXO com correção de índices — função pura
// (client + server). O usuário informa um valor base, um índice de correção e o
// mês em que o reajuste passa a valer; daí sai a série dos 12 meses.
//
//   antes do mês de reajuste → valor base
//   do mês de reajuste em diante → valor corrigido
//
// O valor corrigido depende da UNIDADE do índice:
//  - percent (IPCA, IGP-M, …) → base × (1 + índice%/100).
//    Ex.: base 1.000, IGP-M 4,08%, reajuste em julho → jul..dez = 1.048.
//  - brl (Salário mínimo) → o valor corrigido É o próprio salário mínimo
//    cadastrado para o ano, independentemente do valor base.
//    Ex.: base 1.412, SM 2027 = 1.630, reajuste em janeiro → 1.630 nos 12 meses.

import { projetarMedia } from "@/lib/orcamento/media-calc";
import type { IndiceUnit } from "@/lib/orcamento/indices";

/**
 * Valor corrigido pelo índice. `indiceValor` é o valor cadastrado do índice para
 * o ano (percentual, ou o próprio salário mínimo em R$ quando unit='brl').
 * - percent → base × (1 + índiceValor/100) (a mesma conta da média).
 * - brl → o próprio índiceValor (o salário mínimo do ano).
 * Retorna null quando não há como corrigir (base/índice ausentes).
 */
export function corrigirValorFixo(
  valorBase: number | null,
  indiceValor: number | null,
  unit: IndiceUnit = "percent",
): number | null {
  if (unit === "brl") return indiceValor;
  return projetarMedia(valorBase, indiceValor);
}

/**
 * Série mensal (12 posições) do valor fixo com o degrau do reajuste.
 * - valorBase null → 12 zeros (categoria ainda não preenchida).
 * - mesReajuste null → sem reajuste no ano: valor base os 12 meses.
 * - mesReajuste m (1..12) → base até m-1, corrigido de m em diante.
 */
export function projetarValorFixoSerie(
  valorBase: number | null,
  indiceValor: number | null,
  mesReajuste: number | null,
  unit: IndiceUnit = "percent",
): number[] {
  if (valorBase == null) return Array<number>(12).fill(0);
  if (mesReajuste == null) return Array<number>(12).fill(valorBase);
  const corrigido = corrigirValorFixo(valorBase, indiceValor, unit) ?? valorBase;
  const m = Math.min(12, Math.max(1, mesReajuste));
  return Array.from({ length: 12 }, (_, i) => (i + 1 >= m ? corrigido : valorBase));
}
