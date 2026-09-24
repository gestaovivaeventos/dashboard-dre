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
  /**
   * Cancelado pela DIRETORIA na validação. O item continua na proposta (visível,
   * riscado, com o motivo) mas não entra em número nenhum — ver
   * a coluna `cancelado` da despesa. (A validação saiu do sistema em
   * 24/09/2026 e será redesenhada; a coluna ficou, sem ninguém escrever nela.)
   *
   * Vive aqui, e não numa coluna, porque o item do planejamento é um objeto
   * dentro do jsonb `orcamento_planejamento_socios.proposta`.
   */
  cancelado?: boolean;
  cancelado_motivo?: string | null;
  cancelado_por?: string | null;
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
  /** Departamento (Omie) dos lançamentos deste fornecedor na categoria.
   * null = sem departamento, ou espalhado por vários (fornecedor ambíguo). */
  departamento?: string | null;
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

// ─── Categorias IRMÃS (a divisão "(*)" é interna à contabilidade) ────────────
// Ex.: "Marketing" e "Marketing (*)" são duas categorias Omie (dois códigos) com
// o MESMO nome a menos do sufixo " (*)". Para o gestor é UMA despesa só: o card
// canônico agrega o realizado das duas e produz UMA proposta.
//
// Vive aqui (módulo puro) porque a regra vale em dois lugares que precisam
// concordar: a LISTA do Planejamento, que esconde o card da gêmea, e a PRÉVIA,
// que não pode orçar uma proposta que a tela não mostra.

/** Nome sem o sufixo " (*)" (e sem caixa), para casar irmãs. */
export function normNomeCategoria(s: string): string {
  return (s ?? "")
    .replace(/\s*\(\*\)\s*$/i, "")
    .trim()
    .toLocaleLowerCase("pt-BR");
}

/** A categoria é a "gêmea (*)" (subdivisão contábil interna), não a canônica? */
export function ehCategoriaEstrela(name: string): boolean {
  return /\(\*\)\s*$/.test((name ?? "").trim());
}

/** Códigos de todas as categorias irmãs (mesmo nome-base), incluindo a própria. */
export function codigosIrmaos(
  items: { categoryCode: string; categoryName: string }[],
  categoryCode: string,
  categoryName: string,
): string[] {
  const alvo = normNomeCategoria(categoryName);
  const set = new Set<string>([categoryCode]);
  for (const it of items) if (normNomeCategoria(it.categoryName) === alvo) set.add(it.categoryCode);
  return Array.from(set);
}

/**
 * Descarta a gêmea "(*)" quando a canônica de mesmo nome também está na lista.
 * É a regra que faz as duas categorias virarem UM card — e, na Prévia, UM valor.
 * Gêmea sozinha (sem canônica) é mantida: ali ela É a categoria do gestor.
 */
export function apenasCanonicas<T extends { categoryName: string }>(items: T[]): T[] {
  const canonicas = new Set(
    items.filter((c) => !ehCategoriaEstrela(c.categoryName)).map((c) => normNomeCategoria(c.categoryName)),
  );
  return items.filter(
    (c) => !(ehCategoriaEstrela(c.categoryName) && canonicas.has(normNomeCategoria(c.categoryName))),
  );
}

// ─── Cartão de despesa (o protocolo da entrevista) ───────────────────────────
// A IA propõe UMA despesa por mensagem num bloco no FIM do texto:
//
//   ...texto ao gestor... [[DESPESA]]{ "descricao": "...", ... }[[/DESPESA]]
//
// O gestor confirma na tela e só então ela vira linha no orçamento (decisão do
// dono do projeto em 23/09/2026: a IA sugere, quem grava é o gestor).
//
// A extração precisa ser PURA e tolerante a texto PARCIAL: o cliente lê o
// stream token a token, então na maior parte dos quadros o bloco está pela
// metade. Bloco incompleto = nenhum cartão, e o texto é cortado no primeiro
// "[[" para o marcador não "piscar" na tela enquanto chega.

export interface CartaoDespesa {
  descricao: string;
  /** Nome do grupo de despesa, como a IA o escreveu. A tela casa com o cadastro. */
  grupo: string | null;
  /** Valor de CADA pagamento (ver serieItem). */
  valor: number;
  periodicidade: Periodicidade;
  mesInicio: number;
  mesFim: number | null;
  fornecedor: string | null;
  origem: "base" | "nova";
}

const RE_DESPESA = /\[\[DESPESA\]\]([\s\S]*?)\[\[\/DESPESA\]\]/i;

function mesValido(v: unknown, padrao: number | null): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return padrao;
  const r = Math.round(n);
  return r >= 1 && r <= 12 ? r : padrao;
}

/** Converte o JSON do bloco num cartão, ou null se faltar dado obrigatório. */
export function parseCartaoDespesa(bruto: string): CartaoDespesa | null {
  let obj: unknown;
  try {
    obj = JSON.parse(bruto.trim());
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;

  const descricao = typeof o.descricao === "string" ? o.descricao.trim() : "";
  const valor = Number(o.valor);
  // Nome e valor são o mínimo: sem eles não há despesa, e um cartão pela metade
  // na tela é pior do que cartão nenhum.
  if (!descricao || !Number.isFinite(valor) || valor < 0) return null;

  const periodicidade = toPeriodicidade(o.periodicidade);
  const mesInicio = mesValido(o.mesInicio, 1) ?? 1;
  // 'anual' paga uma vez só: mesFim não significa nada e seria ruído na tela.
  const mesFim = periodicidade === "anual" ? null : mesValido(o.mesFim, null);

  const grupo = typeof o.grupo === "string" && o.grupo.trim() ? o.grupo.trim() : null;
  const fornecedor =
    typeof o.fornecedor === "string" && o.fornecedor.trim() ? o.fornecedor.trim() : null;

  return {
    descricao,
    grupo,
    valor,
    periodicidade,
    mesInicio,
    // mesFim anterior ao início é dado inconsistente da IA — vira "até dezembro"
    // em vez de produzir uma despesa de zero mês, que somaria nada em silêncio.
    mesFim: mesFim != null && mesFim < mesInicio ? null : mesFim,
    fornecedor,
    origem: o.origem === "base" ? "base" : "nova",
  };
}

/**
 * Separa o texto exibível, o cartão proposto e o sinal de encerramento.
 *
 * Substitui `limparMarcadorFechar` nos caminhos da entrevista nova: os dois
 * marcadores convivem no fim da mensagem, e cortar no primeiro "[[" sem antes
 * extrair o cartão o perderia.
 */
export function extrairCartaoDespesa(texto: string): {
  texto: string;
  cartao: CartaoDespesa | null;
  podeFechar: boolean;
} {
  const m = RE_DESPESA.exec(texto);
  const cartao = m ? parseCartaoDespesa(m[1]) : null;
  const { texto: limpo, podeFechar } = limparMarcadorFechar(texto);
  return { texto: limpo, cartao, podeFechar };
}
