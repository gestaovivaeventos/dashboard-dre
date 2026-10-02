import { medianaDosPrecos } from "@/lib/viagens/calibragem";
import { chaveNome } from "@/lib/viagens/plano";
import type { FaixaReferencia, GrupoViagem } from "@/lib/viagens/custo/tipos";

// =============================================================================
// HISTÓRICO DE VIAGENS REALIZADAS (02/10/2026) — a melhor fonte de preço que o
// sistema tem.
//
// ── Por que isto passa à frente da busca na web ───────────────────────────
// A busca devolve um preço de MERCADO para uma rota. O histórico devolve o que
// ESTE time pagou de fato para ir ALI — já com os hábitos que nenhuma busca
// saberia (o dia em que costumam voar, o hotel que usam, quando vão de carro).
// Para destino que repete — e vários repetem —, "o ano passado + reajuste" é como
// orçamento se faz, e é auditável: o diretor lê "Recife custou R$ 1.180 por
// pessoa em 2026, +8%", em vez de um número que ninguém reconstrói.
//
// Também é o que tira do admin o trabalho que ele reclamou com razão: em vez de
// digitar o valor de dez faixas, ele sobe o que aconteceu e digita ~4
// percentuais.
//
// ── CUSTO SÓ SE REUSA EM UNIDADE ─────────────────────────────────────────
// Uma viagem de 4 pessoas / 3 noites não estima uma de 2 pessoas / 1 noite a
// partir do TOTAL. Então tudo aqui normaliza para a mesma unidade em que o motor
// cobra:
//
//  - passagem  → R$ por pessoa, SÓ IDA   (o motor lança ida e volta como dois trechos)
//  - hospedagem→ R$ por QUARTO por noite
//  - alimentação → R$ por pessoa por DIA (dias = noites + 1)
//
// ── A unidade da passagem tem um fator 2, e ele é a armadilha ────────────
// A planilha traz o total PAGO de passagem na viagem (ida e volta, todas as
// pessoas) — é o que um controle de viagem tem. A referência é por pessoa e só
// ida. Esquecer o ÷2 dobraria o orçamento de passagem inteiro, e sairia
// plausível. Há teste travando.
//
// ── MEDIANA entre observações, nunca a última nem a média ────────────────
// Uma ida atípica (evento caro, compra de última hora) não pode definir o número
// que o ano inteiro lê. Mesma regra da calibragem — e a mediana é a MESMA função,
// para não existirem duas no sistema.
//
// Módulo PURO e testado.
// =============================================================================

/** Uma viagem que já aconteceu, como a planilha do admin a descreve. */
export interface ViagemRealizada {
  cidade: string;
  /** Mês da viagem (1..12). Entra na premissa: passagem é sazonal. */
  mes: number | null;
  pessoas: number;
  noites: number;
  /** 1 = cada um no seu quarto. Ausente = 2, a convenção do módulo. */
  pessoasPorQuarto: number | null;
  /** Modal da ida. Carro e van NÃO alimentam referência de passagem. */
  modal: string | null;
  /**
   * DIÁRIAS da viagem = quartos × noites, somadas.
   *
   * Quando a planilha sabe esse número, ele é melhor do que `noites × quartos`
   * derivado de pessoas e ocupação — e não é raro: um controle de viagem lista uma
   * linha por reserva ("Hotel Ronin: 3 diárias", "Hotel - Renato e Humberto: 2
   * diárias"), e a soma é exata. Derivar daria errado justamente nos casos reais:
   * gente que fica menos dias que o resto do grupo, ou dois hotéis na mesma ida.
   *
   * `null` = a planilha não diz, e aí vale `noites × ceil(pessoas / porQuarto)`.
   */
  diarias: number | null;
  /** Total pago na viagem, por grupo de custo. `null` = não informado. */
  custoPassagem: number | null;
  custoHospedagem: number | null;
  custoAlimentacao: number | null;
  /**
   * Uber, táxi, transfer e estacionamento da viagem — UMA coluna, não duas.
   *
   * O motor separa `translado` (casa ↔ terminal) de `transporte_local` (o dia a dia
   * no destino), e com razão. Mas o controle de viagem escreve "Deslocamento de
   * uber", "Transfer" e "Estacionamento" sem dizer qual é qual, e dividir isso por
   * palpite produziria dois números errados em vez de um certo. Uma coluna honesta
   * vale mais: dela sai a sugestão de quanto reservar por pessoa por dia.
   */
  custoTransporteLocal: number | null;
}

/** Quantas pessoas por quarto quando a planilha não diz. */
export const PESSOAS_POR_QUARTO_HISTORICO = 2;

/**
 * Trechos de passagem numa viagem de ida e volta.
 *
 * O motor lança a ida e a volta como DOIS trechos, cada um cobrado por pessoa.
 * A planilha traz o total pago (as duas pernas, todas as pessoas), então a
 * referência por pessoa/só-ida divide por isto.
 */
export const TRECHOS_IDA_E_VOLTA = 2;

function positivo(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}

function inteiroMin1(v: number | null | undefined, padrao: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : padrao;
  return Math.max(1, n);
}

/** Quartos da viagem — a mesma conta do motor. */
export function quartosDaViagem(v: ViagemRealizada): number {
  const pessoas = inteiroMin1(v.pessoas, 1);
  const porQuarto = inteiroMin1(v.pessoasPorQuarto, PESSOAS_POR_QUARTO_HISTORICO);
  return Math.ceil(pessoas / porQuarto);
}

/** Carro e van: o custo é km × R$/km, nunca preço de passagem. */
export function modalCotavel(modal: string | null): boolean {
  return modal !== "carro" && modal !== "van";
}

export interface CustosUnitarios {
  /** R$ por pessoa, SÓ IDA. `null` quando não dá para dizer. */
  passagemPorPessoa: number | null;
  /** R$ por quarto por noite. */
  diariaPorQuarto: number | null;
  /** R$ por pessoa por dia (dias = noites + 1). */
  alimentacaoPorPessoaDia: number | null;
  /** Transporte local e translado, por pessoa por dia. */
  transporteLocalPorPessoaDia: number | null;
}

/**
 * Normaliza UMA viagem realizada para as unidades do motor.
 *
 * Viagem de carro/van não produz referência de passagem — ali o custo é
 * km × R$/km, e deixá-la entrar faria o dia em que alguém for de avião ao mesmo
 * destino sair com o custo do carro. A HOSPEDAGEM dela conta normalmente: hotel
 * é hotel, não importa como se chegou.
 */
export function custosUnitarios(v: ViagemRealizada): CustosUnitarios {
  const pessoas = inteiroMin1(v.pessoas, 1);
  const noites = Math.max(0, Math.round(v.noites ?? 0));
  const quartos = quartosDaViagem(v);

  const passagem = positivo(v.custoPassagem);
  const hospedagem = positivo(v.custoHospedagem);
  const alimentacao = positivo(v.custoAlimentacao);
  const local = positivo(v.custoTransporteLocal);
  // As diárias informadas vencem o derivado: elas JÁ são quartos × noites.
  const diarias = positivo(v.diarias) > 0 ? Math.round(positivo(v.diarias)) : noites * quartos;

  return {
    passagemPorPessoa:
      passagem > 0 && modalCotavel(v.modal)
        ? passagem / pessoas / TRECHOS_IDA_E_VOLTA
        : null,
    diariaPorQuarto: hospedagem > 0 && diarias > 0 ? hospedagem / diarias : null,
    alimentacaoPorPessoaDia:
      alimentacao > 0 ? alimentacao / (pessoas * (noites + 1)) : null,
    transporteLocalPorPessoaDia: local > 0 ? local / (pessoas * (noites + 1)) : null,
  };
}

export interface ReferenciaHistorico {
  cidade: string;
  cidadeChave: string;
  /** Mediana das observações, já em unidade. `null` = nenhuma observação útil. */
  passagemPorPessoa: number | null;
  diariaPorQuarto: number | null;
  alimentacaoPorPessoaDia: number | null;
  transporteLocalPorPessoaDia: number | null;
  /** Quantas viagens àquele destino entraram. */
  viagens: number;
  /** Quantas delas serviram à passagem (carro e van ficam fora). */
  viagensPassagem: number;
  /** Meses observados, em ordem — a premissa os diz, porque tarifa é sazonal. */
  meses: number[];
}

/**
 * Agrupa o histórico por destino e devolve a referência de cada um.
 *
 * A chave é o nome normalizado (sem acento, sem caixa), a mesma de `plano.ts` —
 * "São Luís" e "sao luis" são o mesmo destino, e duas chaves fariam a referência
 * se dividir em duas, cada uma com metade das observações.
 */
export function referenciasPorDestino(
  viagens: readonly ViagemRealizada[],
): Map<string, ReferenciaHistorico> {
  const porChave = new Map<string, ViagemRealizada[]>();
  for (const v of viagens) {
    const cidade = (v.cidade ?? "").trim();
    if (!cidade) continue;
    const k = chaveNome(cidade);
    porChave.set(k, [...(porChave.get(k) ?? []), v]);
  }

  const out = new Map<string, ReferenciaHistorico>();
  for (const [k, lista] of Array.from(porChave.entries())) {
    const unitarios = lista.map(custosUnitarios);
    const meses = Array.from(
      new Set(
        lista
          .map((v) => v.mes)
          .filter((m): m is number => typeof m === "number" && m >= 1 && m <= 12),
      ),
    ).sort((a, b) => a - b);

    out.set(k, {
      // O nome exibido é o da observação mais recente escrita — o da primeira
      // linha serve: as variações são de grafia, e a chave já as uniu.
      cidade: (lista[0].cidade ?? "").trim(),
      cidadeChave: k,
      passagemPorPessoa: medianaDosPrecos(
        unitarios.map((u) => u.passagemPorPessoa ?? 0),
      ),
      diariaPorQuarto: medianaDosPrecos(unitarios.map((u) => u.diariaPorQuarto ?? 0)),
      alimentacaoPorPessoaDia: medianaDosPrecos(
        unitarios.map((u) => u.alimentacaoPorPessoaDia ?? 0),
      ),
      transporteLocalPorPessoaDia: medianaDosPrecos(
        unitarios.map((u) => u.transporteLocalPorPessoaDia ?? 0),
      ),
      viagens: lista.length,
      viagensPassagem: unitarios.filter((u) => u.passagemPorPessoa != null).length,
      meses,
    });
  }
  return out;
}

/**
 * O reajuste, em PERCENTUAL, por grupo de custo.
 *
 * Por grupo de custo e não um índice único porque tarifa aérea e diária de hotel
 * não sobem no mesmo ritmo — e são ~4 números, não ~50. É premissa do exercício,
 * guardada à parte do histórico: o histórico é FATO (não se corrige), o reajuste
 * se troca sem reimportar nada.
 */
export type ReajustesPorGrupo = Partial<Record<GrupoViagem, number>>;

export function percentualDoGrupo(r: ReajustesPorGrupo, grupo: GrupoViagem): number {
  const v = r[grupo];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Aplica o percentual. Zero devolve o próprio valor, sem arredondar à toa. */
export function reajustar(valor: number, percentual: number): number {
  if (!Number.isFinite(valor)) return 0;
  if (!Number.isFinite(percentual) || percentual === 0) return valor;
  return Math.round(valor * (1 + percentual / 100) * 100) / 100;
}

const MES_CURTO = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];

/**
 * O rótulo que vai para a PREMISSA, e ele carrega a conta inteira.
 *
 * "R$ 1.274 por pessoa" sem origem é o tipo de número que ninguém confere — o que
 * este motor existe para evitar. Então o rótulo diz de onde veio, de quantas
 * viagens, de que meses e com que reajuste. Os meses entram porque tarifa é
 * sazonal e aqui NÃO se modela sazonalidade (uma ou duas observações por destino
 * não sustentam isso): o sistema não finge que modela, ele mostra o mês da
 * observação para quem valida ver que está orçando julho com base em janeiro.
 */
export function rotuloDaReferencia(
  ref: ReferenciaHistorico,
  anoBase: number,
  percentual: number,
  observacoes: number,
): string {
  const partes: string[] = [`histórico de ${ref.cidade} em ${anoBase}`];
  if (observacoes > 1) partes.push(`mediana de ${observacoes} viagens`);
  if (ref.meses.length > 0) {
    partes.push(ref.meses.map((m) => MES_CURTO[m - 1]).join("/"));
  }
  if (percentual !== 0) {
    const sinal = percentual > 0 ? "+" : "";
    partes.push(`${sinal}${String(percentual).replace(".", ",")}%`);
  }
  return `${partes[0]} (${partes.slice(1).join(", ")})`.replace(" ()", "");
}

/**
 * A referência de PASSAGEM para o motor, já reajustada.
 *
 * Devolve o mesmo formato da faixa, com `origem: "historico"` — é o que permite
 * o motor continuar com UM slot de referência por grupo. Quem escolhe entre
 * histórico e faixa é o servidor, na hora de montar o retrato: o motor não
 * precisa saber que existem duas fontes, e não ganhou nível de precedência novo.
 */
export function referenciaDePassagem(
  ref: ReferenciaHistorico | undefined | null,
  anoBase: number,
  reajustes: ReajustesPorGrupo,
): FaixaReferencia | null {
  if (!ref || ref.passagemPorPessoa == null) return null;
  const pct = percentualDoGrupo(reajustes, "passagem");
  return {
    nome: rotuloDaReferencia(ref, anoBase, pct, ref.viagensPassagem),
    valor: reajustar(ref.passagemPorPessoa, pct),
    origem: "historico",
  };
}

/** A referência de HOSPEDAGEM (diária por quarto), já reajustada. */
export function referenciaDeHospedagem(
  ref: ReferenciaHistorico | undefined | null,
  anoBase: number,
  reajustes: ReajustesPorGrupo,
): FaixaReferencia | null {
  if (!ref || ref.diariaPorQuarto == null) return null;
  const pct = percentualDoGrupo(reajustes, "hospedagem");
  return {
    nome: rotuloDaReferencia(ref, anoBase, pct, ref.viagens),
    valor: reajustar(ref.diariaPorQuarto, pct),
    origem: "historico",
  };
}

/**
 * O valor sugerido para uma FAIXA, a partir do histórico das cidades dela.
 *
 * É o segundo uso do histórico, e o que fecha o pedido do admin: ele não digita
 * as dez faixas — cada faixa recebe a mediana das cidades que apontam para ela e
 * que têm histórico. Destino sem histórico nenhum continua caindo na faixa, que
 * agora tem um número vindo de fato observado.
 *
 * A mediana é entre DESTINOS (não entre viagens): senão um destino com seis
 * observações pesaria seis vezes mais que outro com uma na definição de uma
 * referência que é regional.
 */
export function faixaSugeridaDoHistorico(
  refs: ReadonlyMap<string, ReferenciaHistorico>,
  cidadesDaFaixa: readonly string[],
  tipo: "passagem" | "hospedagem",
  anoBase: number,
  reajustes: ReajustesPorGrupo,
): { valor: number; destinos: string[] } | null {
  const usados: Array<{ cidade: string; valor: number }> = [];
  for (const cidade of cidadesDaFaixa) {
    const ref = refs.get(chaveNome(cidade));
    if (!ref) continue;
    const bruto = tipo === "passagem" ? ref.passagemPorPessoa : ref.diariaPorQuarto;
    if (bruto == null) continue;
    usados.push({ cidade: ref.cidade, valor: bruto });
  }
  if (usados.length === 0) return null;
  const mediana = medianaDosPrecos(usados.map((u) => u.valor));
  if (mediana == null) return null;
  const pct = percentualDoGrupo(reajustes, tipo === "passagem" ? "passagem" : "hospedagem");
  return {
    valor: reajustar(mediana, pct),
    destinos: usados.map((u) => u.cidade),
  };
}

/**
 * A diária de ALIMENTAÇÃO sugerida pelo histórico, para a empresa inteira.
 *
 * É parâmetro (política da empresa), não preço de mercado, então não é por
 * destino: a mediana de todos os destinos observados é a melhor leitura do que a
 * empresa de fato gastou por pessoa por dia. Só sugere — quem grava é o admin,
 * na tela de parâmetros.
 */
export function alimentacaoSugerida(
  refs: ReadonlyMap<string, ReferenciaHistorico>,
  reajustes: ReajustesPorGrupo,
): number | null {
  const valores = Array.from(refs.values())
    .map((r) => r.alimentacaoPorPessoaDia)
    .filter((v): v is number => v != null);
  const mediana = medianaDosPrecos(valores);
  if (mediana == null) return null;
  return reajustar(mediana, percentualDoGrupo(reajustes, "alimentacao"));
}

/**
 * Transporte local e translado sugeridos, por pessoa por dia.
 *
 * Mesma natureza da alimentação: é informação para quem preenche o campo de
 * translado/transporte local da viagem, não um valor que o motor aplique sozinho —
 * o motor pede trajetos × custo por trajeto, que é outra unidade. Sem o número a
 * pessoa chuta; com ele, parte do que o grupo de fato gastou.
 */
export function transporteLocalSugerido(
  refs: ReadonlyMap<string, ReferenciaHistorico>,
  reajustes: ReajustesPorGrupo,
): number | null {
  const valores = Array.from(refs.values())
    .map((r) => r.transporteLocalPorPessoaDia)
    .filter((v): v is number => v != null);
  const mediana = medianaDosPrecos(valores);
  if (mediana == null) return null;
  return reajustar(mediana, percentualDoGrupo(reajustes, "transporte_local"));
}
