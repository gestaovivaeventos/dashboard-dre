import { GRUPOS_VIAGEM, type ModalTrecho } from "@/lib/viagens/custo/tipos";

// =============================================================================
// O CARTÃO da viagem — o que a IA propõe e o gestor confirma.
//
// A IA monta o ROTEIRO e emite `[[VIAGEM]]{json}[[/VIAGEM]]` no fim da mensagem.
// A tela transforma isso no formulário já preenchido, e só o clique grava — é a
// mesma divisão do cartão de despesa no Planejamento: a IA propõe, o gestor
// grava.
//
// ── O cartão NÃO traz custo, e isso é a regra central ──────────────────────
// Nenhum campo de total é lido daqui, mesmo que o modelo o emita. O custo sai do
// motor (`calcularViagem`) sobre o roteiro gravado. Aceitar um total da IA
// devolveria um número plausível que ninguém consegue reconstruir — exatamente o
// que o motor existe para evitar.
//
// ── Roda sobre texto PARCIAL do streaming ─────────────────────────────────
// O cliente desenha token a token, então este parser é chamado com a mensagem
// pela metade: bloco incompleto devolve `cartao: null` em vez de um cartão
// quebrado, e o texto exibível é cortado no primeiro "[[" para nenhum marcador
// piscar na tela.
//
// Módulo PURO e testado.
// =============================================================================

const RE_VIAGEM = /\[\[VIAGEM\]\]([\s\S]*?)\[\[\/VIAGEM\]\]/i;

/**
 * Um turno da conversa, como fica gravado em `orcamento_viagem_conversas`.
 *
 * Mora aqui (módulo puro) e não na action, para a rota, a tela e o prompt lerem
 * o mesmo tipo — o transcript é o que a diretoria lê na validação.
 */
export interface MensagemViagem {
  role: "user" | "assistant";
  content: string;
}

const MODAIS: readonly ModalTrecho[] = ["carro", "onibus", "aviao", "van", "outro"];

export interface CartaoParada {
  cidade: string;
  noites: number;
  chegadaDe: string | null;
  chegadaModal: ModalTrecho;
  chegadaDistanciaKm: number | null;
  chegadaPrecoPessoa: number | null;
  chegadaPrecoTotal: number | null;
  chegadaPedagios: number | null;
  chegadaVeiculos: number | null;
  diariaHotel: number | null;
  localTrajetosDia: number | null;
  localCustoTrajeto: number | null;
  localDestino: string | null;
  localEndereco: string | null;
}

export interface CartaoViagem {
  titulo: string | null;
  finalidade: string | null;
  origem: string | null;
  dataIda: string | null;
  pessoas: number | null;
  pessoasPorQuarto: number | null;
  transladoCustoTrajeto: number | null;
  transladoTrajetos: number | null;
  voltaModal: ModalTrecho | null;
  voltaDistanciaKm: number | null;
  voltaPrecoPessoa: number | null;
  voltaPrecoTotal: number | null;
  voltaPedagios: number | null;
  voltaVeiculos: number | null;
  outros: Array<{ descricao: string; valor: number }>;
  paradas: CartaoParada[];
}

function texto(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

/** Número ≥ 0, ou `null`. Negativo é dado inconsistente, não desconto. */
function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function inteiro(v: unknown, minimo: number): number | null {
  const n = num(v);
  if (n == null) return null;
  return Math.max(minimo, Math.round(n));
}

function modal(v: unknown): ModalTrecho | null {
  if (typeof v !== "string") return null;
  const t = v.trim().toLowerCase();
  // "ônibus"/"avião" com acento são o que o modelo escreve naturalmente.
  const semAcento = t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, "");
  return MODAIS.includes(semAcento as ModalTrecho) ? (semAcento as ModalTrecho) : null;
}

/** Data ISO, ou `null`. Outro formato é descartado, nunca "corrigido". */
function dataIso(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  return v.trim();
}

function lerParada(v: unknown): CartaoParada | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const cidade = texto(o.cidade);
  // Sem cidade não há parada: uma linha de roteiro sem destino na tela é pior
  // do que uma parada a menos para o gestor acrescentar.
  if (!cidade) return null;
  return {
    cidade,
    noites: inteiro(o.noites, 0) ?? 0,
    chegadaDe: texto(o.chegadaDe),
    chegadaModal: modal(o.chegadaModal) ?? "carro",
    chegadaDistanciaKm: num(o.chegadaDistanciaKm),
    chegadaPrecoPessoa: num(o.chegadaPrecoPessoa),
    chegadaPrecoTotal: num(o.chegadaPrecoTotal),
    chegadaPedagios: num(o.chegadaPedagios),
    chegadaVeiculos: inteiro(o.chegadaVeiculos, 1),
    diariaHotel: num(o.diariaHotel),
    localTrajetosDia: inteiro(o.localTrajetosDia, 0),
    localCustoTrajeto: num(o.localCustoTrajeto),
    localDestino: texto(o.localDestino),
    localEndereco: texto(o.localEndereco),
  };
}

/**
 * Converte o JSON do bloco num cartão, ou `null` quando não há roteiro.
 *
 * O MÍNIMO é uma parada com cidade. Todo o resto é opcional porque o cartão
 * PREENCHE o formulário de uma viagem que já existe: um campo que a IA não
 * soube fica como está, e o gestor completa.
 */
export function parseCartaoViagem(bruto: string): CartaoViagem | null {
  let obj: unknown;
  try {
    obj = JSON.parse(bruto.trim());
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;

  const paradas = (Array.isArray(o.paradas) ? o.paradas : [])
    .map(lerParada)
    .filter((p): p is CartaoParada => p != null);
  if (paradas.length === 0) return null;

  const outros = (Array.isArray(o.outros) ? o.outros : [])
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const x = item as Record<string, unknown>;
      const valor = num(x.valor);
      if (valor == null || valor === 0) return null;
      return { descricao: texto(x.descricao) ?? "Outro custo", valor };
    })
    .filter((x): x is { descricao: string; valor: number } => x != null);

  return {
    titulo: texto(o.titulo),
    finalidade: texto(o.finalidade),
    origem: texto(o.origem),
    dataIda: dataIso(o.dataIda),
    pessoas: inteiro(o.pessoas, 1),
    pessoasPorQuarto: inteiro(o.pessoasPorQuarto, 1),
    transladoCustoTrajeto: num(o.transladoCustoTrajeto),
    transladoTrajetos: inteiro(o.transladoTrajetos, 0),
    voltaModal: modal(o.voltaModal),
    voltaDistanciaKm: num(o.voltaDistanciaKm),
    voltaPrecoPessoa: num(o.voltaPrecoPessoa),
    voltaPrecoTotal: num(o.voltaPrecoTotal),
    voltaPedagios: num(o.voltaPedagios),
    voltaVeiculos: inteiro(o.voltaVeiculos, 1),
    outros,
    paradas,
  };
}

/**
 * Separa o texto exibível, o cartão proposto e o sinal de encerramento.
 *
 * Mesma forma do `extrairCartaoDespesa` do Planejamento: os dois marcadores
 * convivem no fim da mensagem, e cortar no primeiro "[[" sem antes extrair o
 * cartão o perderia.
 */
export function extrairCartaoViagem(texto: string): {
  texto: string;
  cartao: CartaoViagem | null;
  podeFechar: boolean;
} {
  const m = RE_VIAGEM.exec(texto);
  const cartao = m ? parseCartaoViagem(m[1]) : null;
  const podeFechar = /\[\[\s*FECHAR\s*\]\]/i.test(texto);
  const idx = texto.indexOf("[[");
  const limpo = (idx >= 0 ? texto.slice(0, idx) : texto).trim();
  return { texto: limpo, cartao, podeFechar };
}

/**
 * Grupos que o motor conhece, para o prompt citá-los sem inventar nome.
 *
 * Reexportado daqui para a rota e o prompt lerem de um lugar só: grupo que a IA
 * nomeia e o motor não conhece não apareceria na abertura do custo.
 */
export const GRUPOS_CONHECIDOS = GRUPOS_VIAGEM;

// ─── Aplicar o cartão ao rascunho da tela ───────────────────────────────────

/**
 * O roteiro como a tela da viagem o edita. Estruturalmente igual ao
 * `ViagemInput` das actions — declarado aqui para a regra de mesclagem poder
 * morar num módulo PURO e testado (uma action `"use server"` não exporta tipo).
 */
export interface RoteiroEditavel {
  titulo: string;
  finalidade?: string | null;
  origem: string;
  dataIda?: string | null;
  pessoas: number;
  pessoasPorQuarto: number;
  transladoCustoTrajeto?: number | null;
  transladoTrajetos?: number | null;
  voltaModal?: string | null;
  voltaDistanciaKm?: number | null;
  voltaPrecoPessoa?: number | null;
  voltaPrecoTotal?: number | null;
  voltaPedagios?: number | null;
  voltaVeiculos?: number | null;
  outros?: Array<{ descricao: string; valor: number }>;
  paradas: Array<{
    cidade: string;
    noites: number;
    chegadaDe?: string | null;
    chegadaModal?: string | null;
    chegadaDistanciaKm?: number | null;
    chegadaPrecoPessoa?: number | null;
    chegadaPrecoTotal?: number | null;
    chegadaPedagios?: number | null;
    chegadaVeiculos?: number | null;
    diariaHotel?: number | null;
    localTrajetosDia?: number | null;
    localCustoTrajeto?: number | null;
    localDestino?: string | null;
    localEndereco?: string | null;
  }>;
}

/**
 * Mescla o cartão no rascunho.
 *
 * Duas regras, e as duas vieram da mesma preocupação — **leitura é sugestão, o
 * que o usuário digitou nunca é sobrescrito à toa**, igual ao OCR do Case:
 *
 *  - campo que o cartão NÃO trouxe (`null`) PRESERVA o que está na tela. A IA
 *    deixa vazio o que não sabe, e sobrescrever com vazio apagaria o preço que o
 *    gestor acabou de digitar;
 *  - as PARADAS são substituídas pelas do cartão, porque o cartão carrega o
 *    roteiro INTEIRO (é o que o prompt manda). Mesclar parada por parada daria um
 *    roteiro que não é nem o antigo nem o proposto.
 *
 * Consequência assumida: o cartão não consegue REMOVER a volta nem zerar um
 * campo. "Sem volta" e "não sei" chegam os dois como `null`, e indistinguíveis —
 * então o seguro é manter, e quem tira a volta é o gestor no formulário.
 */
export function aplicarCartao(atual: RoteiroEditavel, c: CartaoViagem): RoteiroEditavel {
  const manter = <T,>(novo: T | null | undefined, velho: T): T =>
    novo == null ? velho : novo;

  return {
    ...atual,
    titulo: c.titulo ?? atual.titulo,
    finalidade: c.finalidade ?? atual.finalidade ?? null,
    origem: c.origem ?? atual.origem,
    dataIda: c.dataIda ?? atual.dataIda ?? null,
    pessoas: manter(c.pessoas, atual.pessoas),
    pessoasPorQuarto: manter(c.pessoasPorQuarto, atual.pessoasPorQuarto),
    transladoCustoTrajeto: manter(c.transladoCustoTrajeto, atual.transladoCustoTrajeto ?? null),
    transladoTrajetos: manter(c.transladoTrajetos, atual.transladoTrajetos ?? null),
    voltaModal: manter(c.voltaModal as string | null, atual.voltaModal ?? null),
    voltaDistanciaKm: manter(c.voltaDistanciaKm, atual.voltaDistanciaKm ?? null),
    voltaPrecoPessoa: manter(c.voltaPrecoPessoa, atual.voltaPrecoPessoa ?? null),
    voltaPrecoTotal: manter(c.voltaPrecoTotal, atual.voltaPrecoTotal ?? null),
    voltaPedagios: manter(c.voltaPedagios, atual.voltaPedagios ?? null),
    voltaVeiculos: manter(c.voltaVeiculos, atual.voltaVeiculos ?? null),
    // Lista vazia no cartão não apaga os avulsos já digitados — ela só significa
    // que a conversa não tratou deles.
    outros: c.outros.length > 0 ? c.outros : (atual.outros ?? []),
    paradas: c.paradas.map((p) => ({ ...p })),
  };
}
