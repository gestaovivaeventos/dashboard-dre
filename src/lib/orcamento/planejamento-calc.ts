// Cálculo puro do método "Planejamento dos gestores" — compartilhado por UI,
// server actions e Prévia (sem "use server", para poder ser importado pelo
// cliente). Uma categoria reúne N ITENS (ex.: cada plataforma/serviço de
// "Softwares, Sistemas e Servidores"); o orçado da categoria = SOMA das séries
// dos itens.
//
// Cada item tem uma PERIODICIDADE, que é o INTERVALO entre pagamentos: mensal
// (todo mês), bimestral (a cada 2), trimestral (3), semestral (6) e anual
// (pagamento único no mês de renovação).
//
// O primeiro pagamento é sempre em `mesInicio`, e a série segue de passo em
// passo até `mesFim` (padrão dezembro): um serviço novo em julho conta a partir
// de julho; um cancelado em julho (último pagamento em junho) tem mesFim=6.
// 'anual' é o único que ignora `mesFim` — paga uma vez e pronto.
//
// `valorMensal` é o valor de CADA pagamento: mensal na periodicidade mensal, do
// trimestre na trimestral, e assim por diante.

export type Periodicidade =
  | "mensal"
  | "bimestral"
  | "trimestral"
  | "semestral"
  | "anual";

export interface PeriodicidadeMeta {
  key: Periodicidade;
  label: string;
  /** Meses entre um pagamento e o seguinte. */
  passo: number;
}

// Ordem do seletor, do mais frequente ao menos frequente.
export const PERIODICIDADES: readonly PeriodicidadeMeta[] = [
  { key: "mensal", label: "mensal", passo: 1 },
  { key: "bimestral", label: "bimestral", passo: 2 },
  { key: "trimestral", label: "trimestral", passo: 3 },
  { key: "semestral", label: "semestral", passo: 6 },
  { key: "anual", label: "anual", passo: 12 },
] as const;

export function isPeriodicidade(v: unknown): v is Periodicidade {
  return PERIODICIDADES.some((p) => p.key === v);
}

/** Normaliza o que vem do banco ou da IA. Desconhecido cai em mensal. */
export function toPeriodicidade(v: unknown): Periodicidade {
  return isPeriodicidade(v) ? v : "mensal";
}

/** Meses entre pagamentos. */
export function passoMeses(p: Periodicidade): number {
  return PERIODICIDADES.find((x) => x.key === p)?.passo ?? 1;
}

export function periodicidadeLabel(p: Periodicidade): string {
  return PERIODICIDADES.find((x) => x.key === p)?.label ?? p;
}

export interface PlanejamentoMensagem {
  role: "user" | "assistant";
  content: string;
}

// ─── Marcador de fim da entrevista (streaming) ───────────────────────────────
// No modo streaming a IA responde em texto corrido; quando não há mais o que
// perguntar, ela acrescenta esta linha no FIM. O marcador é interno (nunca
// mostrado ao gestor) e destrava o botão "Concluir entrevista e gerar proposta".
export const MARCADOR_FECHAR = "[[FECHAR]]";

/**
 * Separa o texto exibível do sinal de encerramento. `podeFechar` = a IA marcou
 * fim; `texto` = a mensagem SEM o marcador. Para o streaming, cortamos a partir
 * do primeiro "[[" (o marcador fica no fim) — assim um marcador ainda-parcial
 * não "pisca" na tela enquanto os tokens chegam.
 */
export function limparMarcadorFechar(texto: string): { texto: string; podeFechar: boolean } {
  const podeFechar = /\[\[\s*FECHAR\s*\]\]/i.test(texto);
  const idx = texto.indexOf("[[");
  const limpo = (idx >= 0 ? texto.slice(0, idx) : texto).trim();
  return { texto: limpo, podeFechar };
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
  const passo = passoMeses(periodicidade);
  // 'anual' paga uma vez só, no mês da renovação, e ignora mesFim. Nas demais,
  // paga em mesInicio e depois a cada `passo` meses, até mesFim (ou dezembro).
  const fim = periodicidade === "anual" ? inicio : mesFim == null ? 12 : clampMes(mesFim);
  for (let mes = inicio; mes <= fim; mes += passo) arr[mes - 1] = v;
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
