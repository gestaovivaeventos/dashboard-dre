// Cálculo puro do método "Planejamento dos sócios" — compartilhado por UI,
// server actions e Prévia (sem "use server", para poder ser importado pelo
// cliente). Uma categoria reúne N ITENS (ex.: cada plataforma/serviço de
// "Softwares, Sistemas e Servidores"); cada item tem um VALOR MENSAL e o MÊS
// em que passa a valer (serviço novo em julho conta só de julho a dezembro). O
// orçado da categoria = SOMA das séries dos itens.

export interface PlanejamentoMensagem {
  role: "user" | "assistant";
  content: string;
}

/** Item persistido de uma categoria (uma plataforma/serviço). */
export interface PlanejamentoItem {
  /** id real (persistido) ou chave temporária "tmp-*" no estado local da tela. */
  id: string;
  descricao: string;
  /** Valor mensal em reais. */
  valorMensal: number;
  /** Mês (1..12) a partir do qual o valor passa a valer. */
  mesInicio: number;
  /** 'mantido' = já era pago no ano anterior; 'novo' = nova contratação. */
  origem: "mantido" | "novo";
  /** Fornecedor de referência do ano anterior (quando o item veio de lá). */
  fornecedor: string | null;
}

/** Item como a IA propõe (sem id — ainda não persistido). */
export interface PlanejamentoItemProposto {
  descricao: string;
  valorMensal: number;
  mesInicio: number;
  origem: "mantido" | "novo";
  fornecedor?: string | null;
}

export interface PlanejamentoProposta {
  itens: PlanejamentoItemProposto[];
  justificativa: string;
}

/** Plataforma/fornecedor já pago no ano anterior (referência p/ a entrevista). */
export interface PlanejamentoRealizadoItem {
  fornecedor: string;
  total: number;
  lancamentos: number;
}

/** Série de 12 meses de UM item: 0 antes do mês de início; valor mensal daí em diante. */
export function serieItemMensal(valorMensal: number, mesInicio: number): number[] {
  const arr = Array<number>(12).fill(0);
  const inicio = Number.isFinite(mesInicio) ? Math.min(12, Math.max(1, Math.round(mesInicio))) : 1;
  const v = Number.isFinite(valorMensal) && valorMensal > 0 ? valorMensal : 0;
  for (let m = 0; m < 12; m += 1) if (m + 1 >= inicio) arr[m] = v;
  return arr;
}

type ItemSerie = { valorMensal: number; mesInicio: number };

/** Série de 12 meses da categoria = soma dos itens. */
export function categoriaSerie(itens: ItemSerie[]): number[] {
  const acc = Array<number>(12).fill(0);
  itens.forEach((it) => {
    const s = serieItemMensal(it.valorMensal, it.mesInicio);
    for (let m = 0; m < 12; m += 1) acc[m] += s[m];
  });
  return acc;
}

/** Total do ano da categoria (soma dos 12 meses da soma dos itens). */
export function categoriaTotal(itens: ItemSerie[]): number {
  return categoriaSerie(itens).reduce((a, b) => a + b, 0);
}
