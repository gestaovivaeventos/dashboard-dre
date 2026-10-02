import { modalDaLinha } from "@/lib/viagens/colunas";
import type { ModalTrecho } from "@/lib/viagens/custo/tipos";

// =============================================================================
// A GRADE: uma linha por viagem (02/10/2026).
//
// ── Por que a grade existe ────────────────────────────────────────────────
// Um gestor de Consultoria orça ~50 viagens por ano, a destinos que quase não se
// repetem. O desenho anterior — uma conversa e um formulário de 40 campos por
// viagem — custava minutos por linha, o que dá horas. A grade pede QUATRO coisas
// por viagem (destino, mês, noites, pessoas) e deriva o resto.
//
// ── Uma viagem simples é UMA parada ───────────────────────────────────────
// Não há modelo novo: a linha da grade é escrita no mesmo `orcamento_viagens` +
// uma única `orcamento_viagem_paradas`. O motor, o retrato, os grupos e a
// validação continuam exatamente como estão — a grade é só um jeito rápido de
// escrever no modelo que já existe. O roteiro multi-destino segue existindo, pela
// tela da viagem, para a exceção.
//
// ── O que a grade NÃO pede, e de onde vem ────────────────────────────────
//   quartos        → ceil(pessoas / pessoasPorQuarto), com pessoasPorQuarto = 2
//   modal          → da faixa de passagem escolhida
//   trajetos/dia   → padrão do perfil (2 por dia, hotel ↔ compromisso)
//   translado      → 2 trajetos quando o modal é aéreo
//   preço          → da faixa; cotação real é refinamento opcional
//
// Módulo PURO e testado.
// =============================================================================

export interface LinhaViagemInput {
  /** Viagem existente; ausente = criar. */
  id?: string | null;
  /** Cidade de destino. É o mínimo da linha. */
  destino: string;
  /** Mês da partida, 1..12. `null` = ainda não definido (a linha fica rascunho). */
  mesIda: number | null;
  noites: number;
  pessoas: number;
  /** 1 = cada um no seu quarto; 2 = dividindo. Padrão 2. */
  pessoasPorQuarto?: number | null;
  /** Tipo da viagem — resolve a categoria da DRE pelo de-para. */
  tipoId: string;
  faixaPassagemId?: string | null;
  faixaHospedagemId?: string | null;
  /**
   * Modal do trecho. Vem da faixa por padrão; a linha pode sobrescrever (um
   * destino de 400 km com 4 pessoas pode compensar de carro).
   */
  modal?: string | null;
  /** Só pesa em carro/van, onde o custo é km × R$/km. */
  distanciaKm?: number | null;
  /** Uma linha: é o que o diretor lê para aprovar. */
  finalidade?: string | null;
  /** Deslocamento diário hotel ↔ compromisso. Padrão do perfil. */
  localTrajetosDia?: number | null;
  localCustoTrajeto?: number | null;
}

/** Quantos trajetos por dia entre hotel e compromisso, quando ninguém diz. */
export const TRAJETOS_DIA_PADRAO = 2;
/** Translado casa ↔ aeroporto, nas duas pontas. */
export const TRANSLADO_TRAJETOS_AEREO = 2;
export const PESSOAS_POR_QUARTO_PADRAO = 2;

function texto(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function inteiro(v: unknown, minimo: number, padrao: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return padrao;
  return Math.max(minimo, Math.round(n));
}

function numOuNulo(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * O que impede de GRAVAR a linha.
 *
 * Deliberadamente curto: a grade é preenchida de cima para baixo, e barrar por
 * campo incompleto faria o gestor perder as 49 linhas certas por causa de uma.
 * Sem destino não há viagem; o resto se completa depois. Quem cobra o conjunto é
 * o envio (`enviarViagem`), que exige mês e custo.
 */
export function validarLinhaViagem(l: LinhaViagemInput): string | null {
  if (!texto(l.destino)) return "Informe a cidade de destino.";
  if (!texto(l.tipoId)) return "Escolha o tipo da viagem.";
  if (l.mesIda != null && !(Number.isInteger(l.mesIda) && l.mesIda >= 1 && l.mesIda <= 12)) {
    return "Mês inválido.";
  }
  if (inteiro(l.noites, 0, 0) < 0) return "As noites não podem ser negativas.";
  if (inteiro(l.pessoas, 1, 1) < 1) return "A viagem tem de ter pelo menos uma pessoa.";
  return null;
}

/** Título padrão: o destino. O mês e as pessoas já aparecem no detalhe da Prévia. */
export function tituloDaLinha(l: LinhaViagemInput): string {
  return texto(l.destino) || "Viagem sem destino";
}

/** Quartos que a linha consome — a conta que o motor também faz. */
export function quartosDaLinha(l: LinhaViagemInput): number {
  const pessoas = inteiro(l.pessoas, 1, 1);
  const porQuarto = inteiro(l.pessoasPorQuarto, 1, PESSOAS_POR_QUARTO_PADRAO);
  return Math.ceil(pessoas / porQuarto);
}

/** O modal efetivo: o da linha, senão o da faixa, senão avião. */
export function modalDaLinhaDaGrade(
  l: LinhaViagemInput,
  modalDaFaixa: string | null | undefined,
): ModalTrecho {
  const escolhido = texto(l.modal) || texto(modalDaFaixa);
  return escolhido ? modalDaLinha(escolhido) : "aviao";
}

/**
 * As colunas de `orcamento_viagens` que a linha escreve.
 *
 * O TRANSLADO é derivado do modal: viagem aérea tem casa ↔ aeroporto nas duas
 * pontas, viagem de carro não tem. É uma suposição, e por isso o custo dela
 * aparece como linha própria na árvore — o diretor vê o que foi assumido.
 */
export function viagemRowDaLinha(
  l: LinhaViagemInput,
  modal: ModalTrecho,
  custoTransladoTrajeto: number | null,
): Record<string, unknown> {
  const aereo = modal === "aviao";
  return {
    titulo: tituloDaLinha(l),
    finalidade: texto(l.finalidade) || null,
    mes_ida: l.mesIda ?? null,
    pessoas: inteiro(l.pessoas, 1, 1),
    pessoas_por_quarto: inteiro(l.pessoasPorQuarto, 1, PESSOAS_POR_QUARTO_PADRAO),
    tipo_id: texto(l.tipoId),
    faixa_passagem_id: texto(l.faixaPassagemId) || null,
    faixa_hospedagem_id: texto(l.faixaHospedagemId) || null,
    translado_custo_trajeto: aereo ? custoTransladoTrajeto : null,
    translado_trajetos: aereo && custoTransladoTrajeto != null ? TRANSLADO_TRAJETOS_AEREO : null,
    // A VOLTA é sempre o mesmo modal da ida: o gestor respondeu "voltam direto".
    // Multi-destino e volta diferente são a exceção, pela tela da viagem.
    volta_modal: modal,
    volta_distancia_km: numOuNulo(l.distanciaKm),
    outros: [],
  };
}

/** A única parada da viagem simples. */
export function paradaRowDaLinha(
  l: LinhaViagemInput,
  origem: string,
  modal: ModalTrecho,
): Record<string, unknown> {
  const noites = inteiro(l.noites, 0, 0);
  const trajetos = numOuNulo(l.localTrajetosDia) ?? (noites > 0 ? TRAJETOS_DIA_PADRAO : null);
  return {
    ordem: 1,
    cidade: texto(l.destino),
    noites,
    chegada_de: texto(origem),
    chegada_modal: modal,
    chegada_distancia_km: numOuNulo(l.distanciaKm),
    // Preço fica VAZIO de propósito: ele vem da faixa no motor, ou de uma cotação
    // real depois. Gravar o valor da faixa aqui o congelaria, e mudar a faixa
    // deixaria de refletir nas viagens que ainda não foram fechadas.
    chegada_preco_pessoa: null,
    chegada_preco_total: null,
    chegada_pedagios: null,
    chegada_veiculos: null,
    diaria_hotel: null,
    local_trajetos_dia: trajetos,
    local_custo_trajeto: numOuNulo(l.localCustoTrajeto),
    local_destino: null,
    local_endereco: null,
  };
}

export interface ResultadoLinha {
  /** Índice da linha na grade — é como a tela aponta o erro. */
  indice: number;
  id?: string;
  erro?: string;
  custoTotal?: number;
}

export interface ResumoLote {
  gravadas: number;
  comErro: number;
  total: number;
}

/**
 * O resumo que a tela mostra depois do lote.
 *
 * A grade grava LINHA A LINHA e nunca derruba o lote: destino errado na linha 30
 * não pode custar as 49 certas. É a mesma regra da importação de planilha do plano
 * de cargos, e pelo mesmo motivo.
 */
export function resumirLote(resultados: readonly ResultadoLinha[]): ResumoLote {
  let gravadas = 0;
  let comErro = 0;
  for (const r of resultados) {
    if (r.erro) comErro += 1;
    else gravadas += 1;
  }
  return { gravadas, comErro, total: resultados.length };
}
