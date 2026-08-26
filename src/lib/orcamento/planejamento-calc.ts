// Cálculo puro do método "Planejamento dos sócios" — compartilhado por UI,
// server actions e Prévia (sem "use server", para poder ser importado pelo
// cliente). Uma categoria reúne N ITENS (ex.: cada plataforma/serviço de
// "Softwares, Sistemas e Servidores"); o orçado da categoria = SOMA das séries
// dos itens.
//
// Cada item tem uma PERIODICIDADE:
//  - 'mensal': o valor vale de `mesInicio` até `mesFim` (padrão dezembro). Um
//    serviço novo em julho conta jul..dez; um serviço cancelado em julho (último
//    pagamento em junho) tem mesFim=6 e conta jan..jun;
//  - 'anual':  pagamento ÚNICO no mês de renovação (`mesInicio`), 0 nos demais.

export type Periodicidade = "mensal" | "anual";

export interface PlanejamentoMensagem {
  role: "user" | "assistant";
  content: string;
}

/** Item persistido de uma categoria (uma plataforma/serviço). */
export interface PlanejamentoItem {
  /** id real (persistido) ou chave temporária no estado local da tela. */
  id: string;
  descricao: string;
  /** Valor: MENSAL quando periodicidade='mensal'; ANUAL quando 'anual'. */
  valorMensal: number;
  /** Mês (1..12): início da recorrência (mensal) ou mês da renovação (anual). */
  mesInicio: number;
  /** Mês do ÚLTIMO pagamento (1..12) para itens mensais; null = vai até dezembro.
   * Usado para cancelamento no meio do ano. Ignorado quando periodicidade='anual'. */
  mesFim: number | null;
  periodicidade: Periodicidade;
  /** 'mantido' = já era pago no ano anterior; 'novo' = nova contratação. */
  origem: "mantido" | "novo";
  /** Fornecedor de referência do ano anterior (quando o item veio de lá). */
  fornecedor: string | null;
  /** Entra no orçamento (e na entrevista da IA)? Desmarcado = ignorado, mas
   * lembrado (não volta a ser sugerido). */
  incluir: boolean;
}

/** Item como a IA propõe (sem id — ainda não persistido). */
export interface PlanejamentoItemProposto {
  descricao: string;
  valorMensal: number;
  mesInicio: number;
  mesFim?: number | null;
  periodicidade: Periodicidade;
  origem: "mantido" | "novo";
  fornecedor?: string | null;
  incluir?: boolean;
}

export interface PlanejamentoProposta {
  itens: PlanejamentoItemProposto[];
  justificativa: string;
}

/** Plataforma/fornecedor já pago no ano anterior (referência p/ a entrevista). */
export interface PlanejamentoRealizadoItem {
  /** Nome ORIGINAL do fornecedor no lançamento (chave de curadoria). */
  fornecedor: string;
  /** Total pago nos meses FECHADOS do ano-base. */
  total: number;
  /** Média mensal = total ÷ meses fechados (mesma lógica da tela Média). */
  media: number | null;
  lancamentos: number;
}

/** Curadoria do administrador sobre um fornecedor do ano anterior. */
export interface CuradoriaEntry {
  /** Nome ORIGINAL do fornecedor (casa com PlanejamentoRealizadoItem.fornecedor). */
  fornecedor: string;
  /** Nome de exibição (o admin pode renomear "DIVERSOS" → "Trello"). */
  nome: string;
  /** Se entra na entrevista (a IA só considera os incluídos). */
  incluir: boolean;
}

function clampMes(mes: number): number {
  return Number.isFinite(mes) ? Math.min(12, Math.max(1, Math.round(mes))) : 1;
}

/** Série de 12 meses de UM item, conforme a periodicidade. */
export function serieItem(
  valor: number,
  mesInicio: number,
  periodicidade: Periodicidade,
  mesFim: number | null = null,
): number[] {
  const arr = Array<number>(12).fill(0);
  const inicio = clampMes(mesInicio);
  const v = Number.isFinite(valor) && valor > 0 ? valor : 0;
  if (periodicidade === "anual") {
    arr[inicio - 1] = v; // pagamento único no mês de renovação
  } else {
    const fim = mesFim == null ? 12 : clampMes(mesFim);
    for (let m = 0; m < 12; m += 1) if (m + 1 >= inicio && m + 1 <= fim) arr[m] = v;
  }
  return arr;
}

type ItemSerie = {
  valorMensal: number;
  mesInicio: number;
  periodicidade: Periodicidade;
  mesFim?: number | null;
};

/** Série de 12 meses da categoria = soma dos itens. */
export function categoriaSerie(itens: ItemSerie[]): number[] {
  const acc = Array<number>(12).fill(0);
  itens.forEach((it) => {
    const s = serieItem(it.valorMensal, it.mesInicio, it.periodicidade, it.mesFim ?? null);
    for (let m = 0; m < 12; m += 1) acc[m] += s[m];
  });
  return acc;
}

/** Total do ano da categoria. */
export function categoriaTotal(itens: ItemSerie[]): number {
  return categoriaSerie(itens).reduce((a, b) => a + b, 0);
}

/** Total do ano de UM item (para exibir na linha). */
export function totalItem(
  valor: number,
  mesInicio: number,
  periodicidade: Periodicidade,
  mesFim: number | null = null,
): number {
  return serieItem(valor, mesInicio, periodicidade, mesFim).reduce((a, b) => a + b, 0);
}
