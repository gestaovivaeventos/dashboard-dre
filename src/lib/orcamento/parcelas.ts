// Quantas parcelas uma despesa tem, e entre que meses — a leitura que o valor
// do ano sozinho não dá.
//
// "R$ 45.600,00" numa linha da prévia não diz se é um contrato anual, doze
// mensalidades ou um pagamento único em março; e, no pessoal, não diz que a
// pessoa entra em maio. Quem valida precisa disso para decidir, e era o que
// faltava na faixa de itens.
//
// Módulo PURO (sem "use server"/"use client"): a regra é a mesma no servidor,
// que monta a prévia, e na tela, que a desenha.

export const MESES_CURTOS = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
] as const;

/**
 * Meio centavo. Abaixo disso é poeira de arredondamento, não parcela.
 *
 * O motor do pessoal divide encargos, férias e 13º por competência, e sobra
 * fração de centavo em meses que a pessoa nem estava na empresa — contar isso
 * como parcela transformaria "8 parcelas · mai–dez" em "12 parcelas · jan–dez"
 * e a linha mentiria justamente sobre o que ela veio explicar.
 */
const EPSILON = 0.005;

export interface ResumoParcelas {
  /** Meses com valor. 0 = a despesa não tem nada lançado. */
  parcelas: number;
  /** Primeiro e último mês com valor (1..12), ou null quando não há nenhum. */
  inicio: number | null;
  fim: number | null;
  /** Falso quando há mês vazio ENTRE o início e o fim (pagamento alternado). */
  contiguo: boolean;
}

export function resumirParcelas(meses: readonly number[] | null | undefined): ResumoParcelas {
  const vazio: ResumoParcelas = { parcelas: 0, inicio: null, fim: null, contiguo: true };
  if (!meses || meses.length === 0) return vazio;

  let parcelas = 0;
  let inicio: number | null = null;
  let fim: number | null = null;
  for (let i = 0; i < meses.length && i < 12; i += 1) {
    const v = meses[i];
    if (typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) < EPSILON) continue;
    parcelas += 1;
    if (inicio === null) inicio = i + 1;
    fim = i + 1;
  }
  if (inicio === null || fim === null) return vazio;
  // Span sem buraco = o número de parcelas cobre o intervalo inteiro.
  return { parcelas, inicio, fim, contiguo: parcelas === fim - inicio + 1 };
}

/**
 * O texto curto da linha: "12 parcelas · jan–dez", "1 parcela · mar".
 *
 * Mês único não vira intervalo ("mar", não "mar–mar"). Quando há buraco no
 * meio, o texto continua mostrando início e fim — é o que foi pedido — e a
 * CONTAGEM menor que o intervalo é o que denuncia o buraco; escrever
 * "com intervalos" em toda linha alternada viraria ruído numa fonte de 11px.
 *
 * Devolve `null` quando não há parcela nenhuma: linha sem valor não ganha
 * legenda, e um "0 parcelas" pendurado só ocuparia espaço.
 */
export function textoParcelas(resumo: ResumoParcelas): string | null {
  const { parcelas, inicio, fim } = resumo;
  if (parcelas === 0 || inicio === null || fim === null) return null;
  const quantas = `${parcelas} ${parcelas === 1 ? "parcela" : "parcelas"}`;
  const periodo =
    inicio === fim
      ? MESES_CURTOS[inicio - 1]
      : `${MESES_CURTOS[inicio - 1]}–${MESES_CURTOS[fim - 1]}`;
  return `${quantas} · ${periodo}`;
}

/** Atalho: dos meses direto para o texto. */
export function textoParcelasDeMeses(
  meses: readonly number[] | null | undefined,
): string | null {
  return textoParcelas(resumirParcelas(meses));
}
