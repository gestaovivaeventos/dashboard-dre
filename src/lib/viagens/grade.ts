import { PESSOAS_POR_QUARTO_HISTORICO } from "@/lib/viagens/historico";
import { faltaParaOk, type DadosBasicos } from "@/lib/viagens/fluxo";

// =============================================================================
// A GRADE de viagens — a parte PURA (reescrita em 06/10/2026).
//
// ── O que esta versão deixou de fazer ─────────────────────────────────────
// Ela montava as colunas que o MOTOR de custo precisava: trechos, veículos,
// pedágios, translado derivado do modal, faixa de preço. Nada disso existe mais no
// caminho — o custo vem da cotação externa, lançada por grupo de despesa. O que
// sobrou é o que descreve a viagem para alguém conseguir cotá-la, e é curto:
// destino, UF, mês, noites, pessoas, ocupação, modal, tipo e finalidade.
//
// ── Falha POR LINHA, nunca pelo lote ─────────────────────────────────────
// Destino errado na linha 30 não pode custar as 49 certas, e a linha recusada volta
// com o ÍNDICE para a tela apontar onde foi. Mesma regra da importação do plano de
// cargos e dos grupos de despesa.
//
// Módulo PURO e testado.
// =============================================================================

export interface LinhaViagemInput {
  /** Viagem existente; ausente = criar. */
  id?: string | null;
  /** Cidade de destino. É o mínimo da linha. */
  destino: string;
  /** UF do destino — "São Paulo" e "São Paulo do Potengi" cotam muito diferente. */
  uf?: string | null;
  /** Mês da partida, 1..12. `null` = ainda não definido. */
  mesIda: number | null;
  noites: number;
  pessoas: number;
  /** 1 = cada um no seu quarto; 2 = dividindo. Padrão 2. */
  pessoasPorQuarto?: number | null;
  /** Tipo da viagem — resolve a categoria da DRE pelo de-para. */
  tipoId: string;
  /** Como o grupo vai (avião, ônibus, carro…). Informação para quem cota. */
  modal?: string | null;
  /** Uma linha: é o que a diretoria lê para aprovar. Obrigatória para dar OK. */
  finalidade?: string | null;
}

export const PESSOAS_POR_QUARTO_PADRAO = PESSOAS_POR_QUARTO_HISTORICO;

function texto(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function numOuNulo(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

function inteiro(v: unknown, minimo: number, padrao: number): number {
  // `null` e `""` são AUSÊNCIA e caem no padrão. Sem este teste, `Number(null)`
  // devolve 0 (não NaN) e o padrão nunca é usado: ocupação em branco virava 1
  // pessoa por quarto, dobrando os quartos que vão no .xls da cotação.
  if (v === null || v === undefined || v === "") return padrao;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return padrao;
  return Math.max(minimo, Math.round(n));
}

/**
 * O mínimo para GRAVAR um rascunho: o destino.
 *
 * É de propósito mais frouxo que `faltaParaOk`: montar 50 linhas leva várias idas
 * e vindas, e barrar a gravação a cada campo em branco obrigaria a preencher na
 * ordem do sistema. O rigor fica no OK, que é quando a viagem sai da mão do gestor.
 */
export function validarLinhaViagem(l: LinhaViagemInput): string | null {
  if (!texto(l.destino)) return "Informe o destino.";
  if (!texto(l.tipoId)) return "Escolha o tipo da viagem.";
  return null;
}

/** O que o OK exige, lido da mesma fonte que a tela usa para habilitar o botão. */
export function faltaParaOkDaLinha(l: LinhaViagemInput): string | null {
  const d: DadosBasicos = {
    destino: texto(l.destino),
    uf: texto(l.uf) || null,
    mesIda: l.mesIda ?? null,
    noites: inteiro(l.noites, 0, 0),
    pessoas: inteiro(l.pessoas, 1, 1),
    pessoasPorQuarto: numOuNulo(l.pessoasPorQuarto),
    modal: texto(l.modal) || null,
    finalidade: texto(l.finalidade) || null,
    tipoId: texto(l.tipoId) || null,
  };
  return faltaParaOk(d);
}

export function tituloDaLinha(l: LinhaViagemInput): string {
  const destino = texto(l.destino) || "Viagem";
  const uf = texto(l.uf);
  return uf ? `${destino} (${uf})` : destino;
}

/** Quartos da viagem — entra no .xls da cotação, que precisa saber quantos reservar. */
export function quartosDaLinha(l: LinhaViagemInput): number {
  const pessoas = inteiro(l.pessoas, 1, 1);
  const porQuarto = inteiro(l.pessoasPorQuarto, 1, PESSOAS_POR_QUARTO_PADRAO);
  return Math.ceil(pessoas / porQuarto);
}

/**
 * As colunas de `orcamento_viagens` que a linha escreve.
 *
 * Só dados BÁSICOS: o custo não passa por aqui. Os campos do desenho antigo
 * (`volta_*`, `translado_*`, `outros`) ficaram na tabela sem leitor — o translado
 * virou um grupo da cotação, que é onde ele de fato aparece agora.
 */
export function viagemRowDaLinha(l: LinhaViagemInput): Record<string, unknown> {
  return {
    titulo: tituloDaLinha(l),
    finalidade: texto(l.finalidade) || null,
    mes_ida: l.mesIda ?? null,
    pessoas: inteiro(l.pessoas, 1, 1),
    pessoas_por_quarto: inteiro(l.pessoasPorQuarto, 1, PESSOAS_POR_QUARTO_PADRAO),
    tipo_id: texto(l.tipoId),
    volta_modal: texto(l.modal) || null,
  };
}

/**
 * A única parada da viagem.
 *
 * Uma linha = uma cidade, por decisão de 06/10/2026: viagem que passa por duas
 * cidades vira duas linhas. É mais simples de entender e de cotar, e como quem
 * digita os valores é a Controladoria, a passagem contada uma vez só fica sob o
 * controle dela (lança numa linha e deixa a outra sem).
 */
export function paradaRowDaLinha(l: LinhaViagemInput, origem: string): Record<string, unknown> {
  return {
    ordem: 1,
    cidade: texto(l.destino),
    uf: texto(l.uf).toUpperCase().slice(0, 2) || null,
    noites: inteiro(l.noites, 0, 0),
    chegada_de: texto(origem) || null,
    chegada_modal: texto(l.modal) || null,
  };
}

export interface ResultadoLinha {
  /** Posição na lista enviada — é como a tela devolve o erro à linha certa. */
  indice: number;
  id?: string;
  erro?: string;
}

export interface ResumoLote {
  gravadas: number;
  comErro: number;
}

export function resumirLote(resultados: readonly ResultadoLinha[]): ResumoLote {
  let gravadas = 0;
  let comErro = 0;
  for (const r of resultados) {
    if (r.erro) comErro += 1;
    else gravadas += 1;
  }
  return { gravadas, comErro };
}
