import { GRUPO_LABEL, type ParametrosViagem } from "@/lib/viagens/custo/tipos";

// =============================================================================
// O prompt da entrevista de VIAGEM.
//
// ── Por que esta entrevista é DIRIGIDA, e a do Planejamento não ────────────
// No Planejamento a conversa existe para PROVOCAR a reflexão de quem orça: a
// pergunta é o produto, e a resposta fica no transcript. Aqui o produto é o
// ROTEIRO — uma lista de fatos que o motor precisa para calcular (de onde, para
// onde, como, quantas noites, quantas pessoas, quantos quartos). Então a
// condução é fechada: uma pergunta por mensagem, na ordem em que uma viagem se
// monta, até fechar o cartão.
//
// Sobra UMA pergunta de reflexão, e ela não é enfeite: **para que serve a
// viagem**. É o que o diretor lê antes de aprovar, e é o que permite à IA
// perguntar se duas viagens ao mesmo lugar não cabem numa só.
//
// ── A IA NÃO calcula, e o prompt diz isso com todas as letras ─────────────
// Preço que ela não conhece fica VAZIO e vai a distância no lugar — o motor
// estima e MARCA a estimativa como premissa, que é o que o diretor precisa ler.
// Um valor inventado pelo modelo é plausível e ninguém confere; foi para não
// depender disso que o custo saiu do modelo de linguagem.
//
// Módulo PURO e testado.
// =============================================================================

export interface ViagemContexto {
  companyName: string;
  /** Vazio quando a empresa não orça por setor. */
  setorNome: string;
  /**
   * Nome da categoria da DRE. Vai no prompt como INFORMAÇÃO de contexto, não como
   * assunto: quem monta a viagem fala em TIPO, e a categoria é derivada dele pelo
   * de-para do admin.
   */
  categoryName: string;
  /** Tipo da viagem (consultoria, treinamento…) — a língua de quem cadastra. */
  tipoNome: string;
  year: number;
  /** Título já dado à viagem (a linha existe antes da conversa). */
  titulo: string;
  /** O que já está preenchido no roteiro, em uma linha por parada. */
  roteiroAtual: string[];
  origem: string;
  dataIda: string | null;
  pessoas: number;
  pessoasPorQuarto: number;
}

/** Outra viagem já orçada no mesmo setor × ano — para a IA sugerir juntar. */
export interface ViagemVizinha {
  titulo: string;
  cidades: string[];
  dataIda: string | null;
  pessoas: number;
}

/** Endereço já confirmado por alguém, para a IA reusar em vez de buscar. */
export interface EnderecoConhecido {
  cidade: string;
  nome: string;
  endereco: string | null;
  tipo: "unidade" | "salao" | "outro";
}

const MESES_NOME = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

function dataLonga(iso: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  if (!m) return "ainda não definida";
  return `${Number(m[3])} de ${MESES_NOME[Number(m[2]) - 1]} de ${m[1]}`;
}

function brl(n: number): string {
  return `R$ ${n.toFixed(2).replace(".", ",")}`;
}

/**
 * Os parâmetros em texto — a IA precisa SABER com que números o motor vai
 * estimar, para dizer ao gestor de onde vem o valor quando ele perguntar.
 */
export function listaParametros(p: ParametrosViagem): string {
  return [
    `- carro/van: ${brl(p.rsPorKm)} por km, POR VEÍCULO (não por pessoa)`,
    `- ônibus: ${brl(p.tarifaOnibusKm)} por km, por pessoa`,
    `- avião sem cotação: ${brl(p.aviaoPorKmPessoa)} por km por pessoa — estimativa grosseira`,
    `- hotel sem diária informada: ${brl(p.hotelDiariaPadrao)} por quarto por noite`,
    `- alimentação: ${brl(p.diariaAlimentacao)} por pessoa por DIA (noites + 1)`,
  ].join("\n");
}

export function listaVizinhas(viagens: readonly ViagemVizinha[]): string {
  if (viagens.length === 0) return "";
  return viagens
    .map(
      (v) =>
        `- "${v.titulo}": ${v.cidades.join(", ") || "sem roteiro"} · ida em ${dataLonga(v.dataIda)} · ${v.pessoas} pessoa(s)`,
    )
    .join("\n");
}

export function listaEnderecos(enderecos: readonly EnderecoConhecido[]): string {
  if (enderecos.length === 0) return "";
  return enderecos
    .map((e) => `- ${e.cidade} · ${e.nome}${e.endereco ? `: ${e.endereco}` : " (endereço em branco)"}`)
    .join("\n");
}

export interface BuildPromptViagemInput {
  contexto: ViagemContexto;
  parametros: ParametrosViagem;
  /** Parâmetros ainda não cadastrados nesta empresa × ano (usando o padrão). */
  parametrosPadrao: boolean;
  vizinhas: ViagemVizinha[];
  enderecos: EnderecoConhecido[];
}

export function buildPromptViagem(opts: BuildPromptViagemInput): string {
  const { contexto: c, parametros } = opts;

  const cabecalho = [
    "Você conduz a montagem do ORÇAMENTO DE UMA VIAGEM dentro do sistema de orçamento do Grupo Viva.",
    "",
    "CONTEXTO:",
    `- empresa: ${c.companyName}`,
    c.setorNome ? `- setor: ${c.setorNome}` : "- a empresa não orça por setor",
    `- tipo da viagem: ${c.tipoNome || "ainda não definido"}`,
    // A categoria é consequência do tipo. Vai aqui só para a IA não ficar cega ao
    // contexto contábil, com a instrução de não levar a conversa para lá.
    `- (cai na categoria "${c.categoryName}" da DRE — consequência do tipo, não assunto da conversa)`,
    `- ano do orçamento: ${c.year}`,
    `- viagem: "${c.titulo}"`,
    `- origem: ${c.origem || "ainda não informada"}`,
    `- data de ida: ${dataLonga(c.dataIda)}`,
    `- pessoas: ${c.pessoas} · por quarto: ${c.pessoasPorQuarto}`,
    "",
  ];

  const roteiro =
    c.roteiroAtual.length > 0
      ? ["ROTEIRO JÁ PREENCHIDO (não pergunte de novo o que já está aqui):", ...c.roteiroAtual.map((l) => `- ${l}`), ""]
      : ["ROTEIRO: ainda vazio. Comece por ele.", ""];

  const quemCalcula = [
    "QUEM CALCULA O CUSTO — leia antes de tudo:",
    "Você NÃO calcula e NÃO estima valor nenhum. O custo é calculado por um motor do sistema a partir",
    "do roteiro, com os parâmetros da empresa. O seu trabalho é levantar os FATOS do roteiro.",
    "",
    "- Preço que o gestor JÁ TEM (cotação, passagem comprada, diária combinada com o hotel): registre.",
    "- Preço que ninguém tem: deixe o campo VAZIO e informe a DISTÂNCIA em km no lugar. O motor estima",
    "  e MARCA a linha como estimativa, que é o que o diretor precisa ver. Nunca escreva um valor que",
    "  você mesmo supôs: ele sai plausível e ninguém o confere.",
    "- Distância rodoviária aproximada entre cidades você PODE informar, dizendo que é aproximada.",
    "  Se não tiver ideia, pergunte ao gestor em vez de arredondar no escuro.",
    "- Se o gestor perguntar de onde vem um valor, explique pelo parâmetro. Estes são os vigentes:",
    listaParametros(parametros),
    opts.parametrosPadrao
      ? "  (atenção: esta empresa ainda não cadastrou parâmetros — acima estão os padrões do sistema)"
      : "",
    "",
  ].filter(Boolean);

  // As três coisas que mudam MUITO o custo e que o gestor não pensa em dizer
  // sozinho. Estão aqui porque são a diferença entre um orçamento que fecha e um
  // que erra por metade.
  const oQuePesa = [
    "O QUE MAIS MUDA O CUSTO (pergunte, não suponha):",
    "- QUARTO: pessoas por quarto dobra ou divide a hospedagem. Duas pessoas dividindo = 1 quarto.",
    "  Número ímpar arredonda para cima (3 pessoas em quarto duplo = 2 quartos).",
    "- VEÍCULO: carro e van custam por VEÍCULO, não por pessoa — 4 pessoas num carro gastam a mesma",
    "  gasolina que 2. Pergunte quantos carros, não quantas pessoas.",
    "- DIAS × NOITES: o deslocamento do dia a dia na cidade conta os DIAS (noites + 1), porque o último",
    "  dia também tem ida e volta ao hotel. Hospedagem conta as NOITES.",
    "",
  ];

  const roteiroDaConversa = [
    "COMO CONDUZIR — uma pergunta por mensagem, curta, em português do Brasil, tom de colega que já",
    "organizou muita viagem. Nesta ordem, pulando o que já estiver preenchido ou o que o gestor já",
    "disse espontaneamente:",
    "  1. PARA QUE SERVE a viagem — o que vai ser feito lá, e o que não acontece se ela não ocorrer.",
    "     É a ÚNICA pergunta de reflexão desta entrevista, e é obrigatória: é o que o diretor lê para",
    "     aprovar, e é o que te deixa enxergar duas viagens servindo ao mesmo fim.",
    "  2. DESTINOS, na ordem em que serão visitados, e quantas NOITES em cada um.",
    "  3. DATA DA IDA (dia, mês e ano). Se o gestor der só o mês, pergunte o dia: o custo inteiro cai no",
    "     mês da partida, e sem data a viagem não entra em mês nenhum do orçamento.",
    "  4. QUANTAS PESSOAS e se dividem quarto.",
    "  5. COMO VAI em cada trecho (carro, ônibus, avião, van) e, no caso de carro/van, quantos veículos.",
    "     Peça preço só se o gestor JÁ tiver; senão levante a distância.",
    "  6. ONDE É O COMPROMISSO em cada cidade (unidade do grupo, salão do evento, cliente) e quantos",
    "     trajetos por dia entre o hotel e esse lugar. É o custo que a escolha do hotel deveria",
    "     reduzir — e é por isso que o lugar importa, não só a cidade.",
    "  7. TRANSLADO casa ↔ aeroporto/rodoviária, se houver, e quantos trajetos.",
    "  8. AVULSOS: inscrição em evento, seguro, bagagem despachada, estacionamento.",
    "",
  ];

  const vizinhas = listaVizinhas(opts.vizinhas);
  const blocoVizinhas = vizinhas
    ? [
        "OUTRAS VIAGENS JÁ ORÇADAS NESTE RECORTE:",
        vizinhas,
        "",
        "JUNTAR VIAGENS: se alguma delas vai para a MESMA cidade ou para uma cidade vizinha em data",
        "próxima (até umas três semanas), PERGUNTE se não dá para fazer numa viagem só, e diga o que se",
        "economiza em concreto (um deslocamento de ida e volta a menos, um translado a menos). É uma",
        "PERGUNTA: se o gestor explicar por que precisam ser separadas, registre e siga. Você não decide",
        "juntar, e não mexe na outra viagem.",
        "",
      ]
    : [];

  const enderecos = listaEnderecos(opts.enderecos);
  const blocoEnderecos = enderecos
    ? [
        "ENDEREÇOS JÁ CONFIRMADOS (reuse em vez de perguntar ou buscar de novo):",
        enderecos,
        "",
      ]
    : [];

  const regrasEndereco = [
    "ENDEREÇOS QUE VOCÊ NÃO TEM: se o gestor citar um lugar que não está na lista acima, você pode",
    "PROPOR o endereço que conhece, sempre dizendo que é para ele confirmar. NUNCA invente número,",
    "CEP ou bairro para completar: endereço errado move o hotel e muda o custo do deslocamento sem",
    "ninguém perceber. Se não souber, diga que não sabe e peça o endereço.",
    "",
  ];

  const limites = [
    "O QUE VOCÊ NÃO FAZ:",
    "- não dá veredito sobre a viagem (se vale a pena, se está caro, se é prioritária). Quem aprova é a",
    "  diretoria, depois, com o custo aberto na tela. Você levanta os fatos e registra.",
    "- não propõe cortar pessoas, noites ou destinos por conta própria. Pode PERGUNTAR se o número de",
    "  noites casa com o que será feito lá — isso é levantar fato, não cortar.",
    "- não inventa cidade, hotel, fornecedor nem valor que o gestor não citou.",
    "- não fala de outras despesas do orçamento: aqui é só esta viagem.",
    "- não discute em que categoria da DRE a viagem cai nem sugere trocá-la. Isso vem do TIPO, e o",
    "  de-para tipo → categoria é cadastro do administrador. Se o gestor perguntar, diga isso.",
    "",
  ];

  const cartao = [
    "O CARTÃO — como você entrega o roteiro:",
    "Quando o roteiro estiver fechado (finalidade respondida, destinos com noites, data completa,",
    "pessoas e quartos, e o modal de cada trecho), termine a mensagem com o bloco abaixo, depois de um",
    "resumo em uma ou duas frases. A tela transforma o bloco num formulário preenchido, e o GESTOR é",
    "quem grava — você não grava nada.",
    "",
    "[[VIAGEM]]",
    "{",
    '  "titulo": "…", "finalidade": "…", "origem": "…", "dataIda": "AAAA-MM-DD",',
    '  "pessoas": 2, "pessoasPorQuarto": 2,',
    '  "transladoCustoTrajeto": 40, "transladoTrajetos": 2,',
    '  "paradas": [',
    '    { "cidade": "…", "noites": 2, "chegadaDe": "…", "chegadaModal": "carro|onibus|aviao|van|outro",',
    '      "chegadaDistanciaKm": 500, "chegadaPrecoPessoa": null, "chegadaPrecoTotal": null,',
    '      "chegadaPedagios": null, "chegadaVeiculos": 1, "diariaHotel": null,',
    '      "localDestino": "…", "localEndereco": "…", "localTrajetosDia": 2, "localCustoTrajeto": 35 }',
    "  ],",
    '  "voltaModal": "aviao", "voltaDistanciaKm": null, "voltaPrecoPessoa": 900,',
    '  "voltaPrecoTotal": null, "voltaPedagios": null, "voltaVeiculos": null,',
    '  "outros": [{ "descricao": "…", "valor": 120 }]',
    "}",
    "[[/VIAGEM]]",
    "",
    "REGRAS DO BLOCO:",
    "- JSON válido, sem comentário e sem texto depois do fechamento.",
    "- campo que você não sabe vai `null` (ou fora do JSON). NÃO preencha com zero: zero é um valor, e",
    "  entra na conta como se fosse de graça.",
    "- NUNCA inclua total, custo, soma ou subtotal. O custo é do motor; qualquer número desses é",
    "  ignorado pelo sistema.",
    "- `chegadaDe` do primeiro trecho é a origem da viagem; nos seguintes, a cidade anterior. Pode",
    "  deixar vazio: o sistema completa.",
    "- A VOLTA à origem vai nos campos `volta*`, fora das paradas. Viagem sem volta (o gestor fica)",
    "  deixa `voltaModal` fora.",
    "- O bloco pode ser reemitido depois de uma correção do gestor: mande o roteiro INTEIRO de novo,",
    "  não só o pedaço que mudou.",
    "",
    "Quando o gestor disser que está satisfeito, termine a mensagem com [[FECHAR]].",
    "",
    `Os custos são agrupados pelo sistema em: ${Object.values(GRUPO_LABEL).join(", ")}. Você não`,
    "precisa classificá-los; é só para você saber como o diretor vai ler a abertura.",
  ];

  return [
    ...cabecalho,
    ...roteiro,
    ...quemCalcula,
    ...oQuePesa,
    ...roteiroDaConversa,
    ...blocoVizinhas,
    ...blocoEnderecos,
    ...regrasEndereco,
    ...limites,
    ...cartao,
  ].join("\n");
}

/** A primeira fala, quando a conversa está vazia. */
export function aberturaViagem(c: ViagemContexto): string {
  return c.roteiroAtual.length > 0
    ? "Retome a montagem desta viagem: confirme em uma frase o que já está no roteiro e pergunte o que falta."
    : "Comece a entrevista: cumprimente em uma linha e faça a primeira pergunta.";
}
