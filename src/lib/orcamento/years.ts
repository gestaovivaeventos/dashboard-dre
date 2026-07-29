// =============================================================================
// Ano do orçamento — dimensão compartilhada por todas as telas do módulo.
//
// Toda a configuração do orçamento é VERSIONADA POR ANO: o orçamento de 2027 é
// montado com as premissas de 2027 (setores, cargos, salários, método por
// categoria, orçar por setor). Ao virar o ano, clona-se o ano anterior e
// edita-se a CÓPIA — o ano já montado nunca muda. Os índices de correção seguem
// o mesmo princípio, mas são chaveados por ano-base (tabela própria).
// =============================================================================

/** Primeiro ano que o módulo aceita (piso histórico). */
export const ORCAMENTO_MIN_YEAR = 2025;

/**
 * Ano do orçamento padrão: normalmente planejamos o PRÓXIMO ano civil.
 * (Em 2026 o padrão é 2027, que é o que estamos montando agora.)
 */
export function defaultBudgetYear(): number {
  return new Date().getFullYear() + 1;
}

/**
 * Faixa de anos selecionáveis, do mais recente para o mais antigo
 * (do piso histórico até o próximo ano + 1, dando folga para adiantar o
 * planejamento).
 */
export function orcamentoYears(): number[] {
  const max = new Date().getFullYear() + 2;
  const years: number[] = [];
  for (let y = max; y >= ORCAMENTO_MIN_YEAR; y--) years.push(y);
  return years;
}

/** Valida um ano de orçamento recebido de input/URL antes de gravar. */
export function isValidBudgetYear(year: number): boolean {
  return (
    Number.isInteger(year) &&
    year >= ORCAMENTO_MIN_YEAR &&
    year <= new Date().getFullYear() + 5
  );
}
