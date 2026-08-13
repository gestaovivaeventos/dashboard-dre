// Projeção das despesas por média — função pura (client + server).
// A média encontrada (do ano anterior) é corrigida por um índice percentual
// para chegar ao valor mensal projetado do ano do orçamento.

/**
 * Aplica a correção do índice sobre a média.
 *   projetado = média × (1 + índice%/100)
 * Sem índice (null) → devolve a própria média. Média null → null.
 */
export function projetarMedia(
  media: number | null,
  indicePercent: number | null,
): number | null {
  if (media == null) return null;
  if (indicePercent == null) return media;
  return media * (1 + indicePercent / 100);
}
