// O VOCABULÁRIO do custo de viagem — compartilhado pelo orçamento (planejar o
// ano) e, depois, pela cotação de compra.
//
// Mora em `src/lib/viagens/` e não em `src/lib/orcamento/` de propósito: o
// motor é o DONO do custo de viagem no sistema, e o Orçamento é só o primeiro
// a usá-lo. Pôr a regra dentro do módulo que a consome primeiro é o caminho
// certo para ela ser copiada no segundo.

/**
 * Os grupos em que o custo se separa na tela e na aprovação do diretor.
 *
 * Fixos e nomeados porque o diretor aprova a viagem INTEIRA olhando a abertura
 * — grupo livre faria duas viagens parecerem diferentes só pela escolha de
 * palavra de quem preencheu.
 *
 * `transporte_local` é separado de `translado` de propósito: translado é o
 * trajeto casa↔terminal (uma vez na ida e outra na volta), transporte local é
 * o do dia a dia na cidade (hotel↔unidade, hotel↔salão). Juntá-los esconderia
 * exatamente o custo que a escolha do hotel deveria otimizar.
 */
export const GRUPOS_VIAGEM = [
  "passagem",
  "translado",
  "transporte_local",
  "hospedagem",
  "alimentacao",
  "outros",
] as const;

export type GrupoViagem = (typeof GRUPOS_VIAGEM)[number];

export const GRUPO_LABEL: Record<GrupoViagem, string> = {
  passagem: "Passagem / deslocamento entre cidades",
  translado: "Translado (casa ↔ terminal)",
  transporte_local: "Transporte local no destino",
  hospedagem: "Hospedagem",
  alimentacao: "Alimentação",
  outros: "Outros custos",
};

/** Como se vai de um ponto ao próximo. */
export type ModalTrecho = "carro" | "onibus" | "aviao" | "van" | "outro";

export const MODAL_LABEL: Record<ModalTrecho, string> = {
  carro: "Carro",
  onibus: "Ônibus",
  aviao: "Avião",
  van: "Van / fretado",
  outro: "Outro",
};

/**
 * Um trecho entre dois pontos.
 *
 * O preço pode vir por DUAS vias, e a ordem importa: se `precoPorPessoa` (ou
 * `precoTotal`) foi informado, ele VENCE o cálculo por quilômetro. É o que
 * permite ao solicitante colar uma cotação que ele já tem em mãos sem brigar
 * com a estimativa — e é também por onde a cotação de compra vai entrar
 * depois, com preço real.
 */
export interface TrechoViagem {
  de: string;
  para: string;
  modal: ModalTrecho;
  /** Distância rodoviária, para carro/ônibus/van quando não há preço informado. */
  distanciaKm?: number | null;
  /** Preço por pessoa, já ida (um trecho). Vence o cálculo por km. */
  precoPorPessoa?: number | null;
  /** Preço fechado do trecho para o grupo todo. Vence tudo. */
  precoTotal?: number | null;
  /** Pedágios do trecho (só carro/van). */
  pedagios?: number | null;
  /** Quantos carros/vans, quando o modal é por veículo e não por pessoa. */
  veiculos?: number | null;
}

/** Uma cidade onde o grupo dorme, com o trecho que leva até ela. */
export interface ParadaViagem {
  cidade: string;
  noites: number;
  /** Como se CHEGA nesta parada (da origem, se for a primeira). */
  chegada: TrechoViagem;
  /**
   * Deslocamento do dia a dia naquela cidade: hotel ↔ unidade Viva, hotel ↔
   * salão do evento. É o custo que a escolha do hotel deveria minimizar.
   */
  transporteLocal?: {
    /** Quantos trajetos por dia (ida e volta a um destino = 2). */
    trajetosPorDia: number;
    /** Custo de UM trajeto, para o grupo todo. */
    custoPorTrajeto: number;
    /** Para que serve — vai para a linha, e o diretor lê. */
    destino?: string | null;
  } | null;
  /** Diária de hotel desta cidade, quando se sabe. Senão, o parâmetro. */
  diariaHotel?: number | null;
}

/** A viagem como o solicitante a descreve. */
export interface ViagemSpec {
  /** Cidade de partida e de retorno. */
  origem: string;
  /** Na ordem do roteiro. Vazio = viagem de ida e volta no mesmo dia. */
  paradas: ParadaViagem[];
  /** O trecho de volta à origem. */
  volta: TrechoViagem | null;
  /**
   * MÊS da partida (1..12) — é ele que define em que mês do orçamento a viagem
   * cai.
   *
   * Era uma data ISO completa até 02/10/2026, e virou mês a pedido: no orçamento
   * ninguém sabe o dia. A data exigia um dia que o gestor inventava, e um dia
   * inventado parece informação. `null` = mês ainda não definido.
   */
  mesIda: number | null;
  pessoas: number;
  /**
   * Quantas pessoas por quarto. 1 = cada um no seu; 2 = dividindo.
   * Explícito porque muda a hospedagem em até 2×, e era justamente o que o
   * modelo antigo fixava em `ceil(pessoas / 2)` sem perguntar.
   */
  pessoasPorQuarto: number;
  /** Translado casa↔terminal, nas duas pontas. Custo de UM trajeto, do grupo. */
  translado?: { custoPorTrajeto: number; trajetos: number } | null;
  /** Linhas avulsas que não cabem em grupo nenhum (inscrição, seguro, bagagem). */
  outros?: Array<{ descricao: string; valor: number }>;
  /**
   * FAIXA de passagem: valor de referência por pessoa, SÓ IDA, curado pelo admin
   * (`orcamento_viagem_faixas`). Entra quando ninguém cotou o trecho — e só em
   * avião/ônibus/outro: carro e van têm o km, que é o driver real do custo deles.
   *
   * O nome vem junto porque a premissa precisa DIZER de qual faixa o número saiu.
   * "R$ 620 por pessoa" sem a origem é o tipo de valor que ninguém consegue
   * conferir, que é o que este motor existe para evitar.
   */
  faixaPassagem?: FaixaReferencia | null;
  /** FAIXA de hospedagem: diária por QUARTO, quando a parada não tem diária própria. */
  faixaHospedagem?: FaixaReferencia | null;
}

/**
 * Um valor de referência, com o nome de onde ele veio.
 *
 * `origem` existe para a PREMISSA usar o verbo certo: "usou a faixa X" e "usou o
 * histórico de X" descrevem confianças diferentes, e quem valida precisa
 * distinguir número curado por região de número observado naquele destino.
 *
 * O motor continua com UM slot de referência por grupo: quem escolhe entre
 * histórico e faixa é o servidor, ao montar o retrato. Um nível de precedência
 * novo dentro do motor não compraria nada e teria de ser mantido em dois lugares.
 */
export interface FaixaReferencia {
  nome: string;
  valor: number;
  /** Ausente = faixa (era a única fonte até 02/10/2026). */
  origem?: "faixa" | "historico";
}

/**
 * Os parâmetros da estimativa — DOIS, e só dois.
 *
 * ── Por que não há R$/km de avião nem de ônibus (01/10/2026) ───────────────
 * Havia, e era um default ruim: passagem aérea tem sazonalidade enorme, e um
 * R$/km não distingue janeiro de julho, nem rota concorrida de rota sem
 * concorrência. Um número assim sai plausível e ninguém consegue reconstruí-lo —
 * exatamente o defeito que este motor existe para evitar.
 *
 * Preço de mercado passou a vir de BUSCA (`src/lib/viagens/precos/`), que é
 * referência de verdade: a rota, o mês, a fonte. Trecho sem preço e sem busca
 * entra com custo ZERO e premissa alta, em vez de um valor inventado.
 *
 * Ficam só os dois que a EMPRESA define, e que não são preço de mercado:
 *
 *  - `diariaAlimentacao`: política da empresa, não cotação;
 *  - `rsPorKm`: carro PRÓPRIO — aqui o km é o driver real do custo (combustível e
 *    desgaste são proporcionais à distância) e a empresa tem o valor dela.
 *
 * As colunas dos parâmetros removidos continuam na tabela, sem leitor — mesma
 * convenção das outras colunas mortas do módulo. Não as recrie no cálculo.
 */
export interface ParametrosViagem {
  /** Carro/van próprios: R$ por km, POR VEÍCULO (não por pessoa). */
  rsPorKm: number;
  /** Alimentação por pessoa por DIA. Política da empresa. */
  diariaAlimentacao: number;
}

export interface LinhaCusto {
  /** Explica a conta: "Hotel: 2 noites × R$ 250,00 × 2 quarto(s)". */
  descricao: string;
  valor: number;
}

export interface GrupoCusto {
  grupo: GrupoViagem;
  label: string;
  linhas: LinhaCusto[];
  total: number;
}

export interface ResultadoViagem {
  grupos: GrupoCusto[];
  total: number;
  /** 12 posições: o custo cai no mês da PARTIDA (ver o motor). */
  meses: number[];
  /**
   * O que foi ASSUMIDO por falta de dado — endereço aproximado, diária padrão,
   * preço de voo estimado por km. O diretor precisa ver isso antes de aprovar:
   * é a diferença entre um número cotado e um número arbitrado.
   */
  premissas: string[];
  /** Noites e dias calculados, para a tela não recontar por conta própria. */
  noites: number;
  dias: number;
  quartos: number;
}
