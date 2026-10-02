import { materialidade } from "@/lib/orcamento/entrevista-prompt";

// =============================================================================
// CALIBRAR AS FAIXAS com a web (02/10/2026) — fase 4.
//
// ── Por que se cota a FAIXA, e não a viagem ───────────────────────────────
// Cotar viagem a viagem foi o que tornou a fase 0 inviável: ~50 destinos que
// quase não se repetem são ~50 buscas na web, dezenas de segundos cada, e nada
// amortiza. A faixa inverte a conta — são ~10, cada uma é lida por dezenas de
// linhas, e uma busca por faixa melhora o orçamento inteiro. É para isso que a
// tabela de faixas existe: o custo de 50 viagens cabe em 10 números curados.
//
// ── A PROPOSTA nunca se aplica sozinha ────────────────────────────────────
// A faixa é o número que o administrador curou e que a diretoria já viu em
// viagens aprovadas. A busca propõe ao lado do valor atual, e ele aceita faixa a
// faixa. Sobrescrever calado mudaria, de uma vez, o custo de todas as linhas que
// leem aquela faixa — inclusive as já validadas.
//
// ── MEDIANA, nunca média ──────────────────────────────────────────────────
// Uma rota com companhia única custa múltiplos das outras da mesma faixa. Na
// média ela arrasta o número que vinte linhas leem; na mediana ela é um ponto
// entre os pontos. Para isso a busca pede VÁRIAS rotas da mesma faixa — uma só
// não é calibragem, é cotação de uma viagem.
//
// ── PARETO sobre as faixas ────────────────────────────────────────────────
// Mesmo com 10, não é preciso calibrar as 10: a tela marca as que carregam 80%
// do orçamento (mesma regra do Planejamento, materialidade). Calibrar a faixa que
// responde por 2% do total gasta busca e não muda decisão nenhuma.
//
// Módulo PURO e testado.
// =============================================================================

export interface LinhaParaCalibrar {
  destino: string;
  noites: number;
  pessoas: number;
  mesIda: number | null;
  faixaPassagemId: string | null;
  faixaHospedagemId: string | null;
  /** O custo já calculado da linha — é por ele que a faixa pesa. */
  custoTotal: number;
}

export interface FaixaParaCalibrar {
  id: string;
  tipo: "passagem" | "hospedagem";
  nome: string;
  valor: number;
  modal: string | null;
}

function idDaFaixa(l: LinhaParaCalibrar, tipo: "passagem" | "hospedagem"): string | null {
  return tipo === "passagem" ? l.faixaPassagemId : l.faixaHospedagemId;
}

/** As linhas que leem esta faixa. Hospedagem ignora bate-volta: lá ela não pesa. */
export function linhasDaFaixa(
  linhas: readonly LinhaParaCalibrar[],
  faixa: FaixaParaCalibrar,
): LinhaParaCalibrar[] {
  return linhas.filter((l) => {
    if (idDaFaixa(l, faixa.tipo) !== faixa.id) return false;
    if (faixa.tipo === "hospedagem" && l.noites <= 0) return false;
    return true;
  });
}

/**
 * As cidades representativas da faixa, as mais pesadas primeiro.
 *
 * O peso é o CUSTO que a cidade carrega dentro da faixa, não a ordem alfabética
 * nem a contagem: a calibragem tem de olhar as rotas que movem o número. A mesma
 * cidade em quatro linhas entra UMA vez — buscar o mesmo trecho quatro vezes
 * gastaria a busca sem acrescentar ponto nenhum à mediana.
 */
export function rotasDaFaixa(
  linhas: readonly LinhaParaCalibrar[],
  faixa: FaixaParaCalibrar,
  max = 5,
): string[] {
  const peso = new Map<string, number>();
  for (const l of linhasDaFaixa(linhas, faixa)) {
    const cidade = l.destino.trim();
    if (!cidade) continue;
    peso.set(cidade, (peso.get(cidade) ?? 0) + Math.max(0, l.custoTotal));
  }
  return Array.from(peso.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR"))
    .slice(0, Math.max(1, max))
    .map(([cidade]) => cidade);
}

/**
 * O mês mais frequente entre as linhas da faixa.
 *
 * A busca precisa de UM mês, e preço de passagem tem sazonalidade grande. Com
 * meses espalhados, o mais frequente é a melhor aproximação de uma faixa que
 * vale para o ano. Nenhum mês definido devolve null, e a busca diz que não sabe —
 * escolher janeiro por padrão calibraria o ano pelo mês mais caro.
 */
export function mesDominante(
  linhas: readonly LinhaParaCalibrar[],
  faixa: FaixaParaCalibrar,
): number | null {
  const conta = new Map<number, number>();
  for (const l of linhasDaFaixa(linhas, faixa)) {
    if (l.mesIda == null) continue;
    conta.set(l.mesIda, (conta.get(l.mesIda) ?? 0) + 1);
  }
  let melhor: number | null = null;
  let maior = 0;
  for (const [mes, n] of Array.from(conta.entries())) {
    // Empate fica com o mês mais cedo: é o que o orçamento começa a gastar.
    if (n > maior || (n === maior && melhor != null && mes < melhor)) {
      maior = n;
      melhor = mes;
    }
  }
  return melhor;
}

export interface PesoDaFaixa {
  id: string;
  nome: string;
  tipo: "passagem" | "hospedagem";
  /** Quantas linhas leem esta faixa. */
  linhas: number;
  /** Custo das linhas que a leem — o que ela carrega do orçamento. */
  total: number;
  /** Fatia do total da grade. */
  peso: number;
  /** Entra nos 80% (ou pesa 10% ou mais sozinha): vale a busca. */
  prioritaria: boolean;
}

/**
 * Quanto cada faixa carrega, e quais valem a busca.
 *
 * O corte é o mesmo Pareto do Planejamento (materialidade), de propósito: uma
 * segunda regra de materialidade no sistema divergiria da primeira no dia em que
 * alguém ajustasse uma delas.
 *
 * O total de uma linha é contado nas DUAS faixas que ela usa — não é rateio, é a
 * pergunta "quanto do orçamento esta faixa influencia", e a passagem e a
 * hospedagem da mesma viagem influenciam as duas.
 */
export function pesoDasFaixas(
  linhas: readonly LinhaParaCalibrar[],
  faixas: readonly FaixaParaCalibrar[],
): PesoDaFaixa[] {
  const parciais = faixas.map((f) => {
    const dela = linhasDaFaixa(linhas, f);
    return {
      id: f.id,
      nome: f.nome,
      tipo: f.tipo,
      linhas: dela.length,
      total: dela.reduce((a, l) => a + Math.max(0, l.custoTotal), 0),
    };
  });

  const marcas = materialidade(parciais.map((p) => p.total));
  const totalGeral = parciais.reduce((a, p) => a + p.total, 0);

  return parciais.map((p, i) => ({
    ...p,
    peso: totalGeral > 0 ? p.total / totalGeral : 0,
    // Faixa sem nenhuma linha nunca é prioritária: não há o que calibrar nela.
    prioritaria: p.linhas > 0 && marcas[i]?.profundidade === "completa",
  }));
}

/**
 * Mediana dos preços encontrados.
 *
 * Com dois pontos, a mediana é a média dos dois — o que é o certo: não há como
 * saber qual dos dois representa a faixa.
 */
export function medianaDosPrecos(valores: readonly number[]): number | null {
  const bons = valores.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (bons.length === 0) return null;
  const meio = Math.floor(bons.length / 2);
  return bons.length % 2 === 1 ? bons[meio] : (bons[meio - 1] + bons[meio]) / 2;
}

export interface AmostraCalibragem {
  cidade: string;
  valor: number;
  fonte: string | null;
}

export interface PropostaFaixa {
  faixaId: string;
  /** O valor sugerido, já na unidade da faixa. `null` = a busca não achou nada. */
  valor: number | null;
  valorAtual: number;
  amostras: AmostraCalibragem[];
  /** Quanto o sugerido muda o atual, em fração. `null` quando não dá para dizer. */
  variacao: number | null;
  fontes: string[];
}

/**
 * Monta a proposta a partir do que a busca achou.
 *
 * ── A unidade é a MESMA da faixa, e isso não é detalhe ───────────────────
 * A faixa de passagem é "R$ por pessoa, SÓ IDA" — o motor cobra a volta como um
 * segundo trecho. A busca também pede o preço de ida. Então o valor entra como
 * veio: dobrá-lo aqui faria toda viagem custar quatro vias.
 */
export function propostaDaFaixa(
  faixa: FaixaParaCalibrar,
  amostras: readonly AmostraCalibragem[],
  fontes: readonly string[] = [],
): PropostaFaixa {
  const valor = medianaDosPrecos(amostras.map((a) => a.valor));
  return {
    faixaId: faixa.id,
    valor,
    valorAtual: faixa.valor,
    amostras: amostras.filter((a) => Number.isFinite(a.valor) && a.valor > 0),
    // Faixa em zero não tem variação definida: tudo seria infinito. "—" é a
    // resposta honesta, e é diferente de "não mudou".
    variacao: valor != null && faixa.valor > 0 ? valor / faixa.valor - 1 : null,
    fontes: Array.from(new Set(fontes.filter((f) => f && f.trim() !== ""))),
  };
}
