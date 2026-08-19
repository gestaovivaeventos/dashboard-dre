// Projeção das despesas por VALOR FIXO com correção de índices — função pura
// (client + server). O usuário informa um valor base, um índice de correção e o
// mês em que o reajuste passa a valer; daí sai a série dos 12 meses.
//
//   antes do mês de reajuste → valor base
//   do mês de reajuste em diante → valor corrigido = base × (1 + índice%/100)
//
// Ex.: base 1.000, IGP-M 4,08%, reajuste em julho (mês 7):
//   jan..jun = 1.000 ; jul..dez = 1.048.

import { projetarMedia } from "@/lib/orcamento/media-calc";

/** Valor corrigido pelo índice (mesma conta da média). Base null → null. */
export function corrigirValorFixo(
  valorBase: number | null,
  indicePercent: number | null,
): number | null {
  return projetarMedia(valorBase, indicePercent);
}

/**
 * Série mensal (12 posições) do valor fixo com o degrau do reajuste.
 * - valorBase null → 12 zeros (categoria ainda não preenchida).
 * - mesReajuste null → sem reajuste no ano: valor base os 12 meses.
 * - mesReajuste m (1..12) → base até m-1, corrigido de m em diante.
 */
export function projetarValorFixoSerie(
  valorBase: number | null,
  indicePercent: number | null,
  mesReajuste: number | null,
): number[] {
  if (valorBase == null) return Array<number>(12).fill(0);
  if (mesReajuste == null) return Array<number>(12).fill(valorBase);
  const corrigido = corrigirValorFixo(valorBase, indicePercent) ?? valorBase;
  const m = Math.min(12, Math.max(1, mesReajuste));
  return Array.from({ length: 12 }, (_, i) => (i + 1 >= m ? corrigido : valorBase));
}
