import type { ValidacaoEstado } from "@/lib/orcamento/validacao-diretoria";

// =============================================================================
// O FLUXO DA VIAGEM (06/10/2026) — o desenho que substituiu a estimativa.
//
// ── O que mudou, e por quê ────────────────────────────────────────────────
// Até aqui o sistema tentava PRECIFICAR a viagem: parâmetros, faixas por região,
// histórico do ano anterior, busca na web. Cada camada resolvia um pedaço e
// somava complexidade — e o dono do projeto disse o que importava: "está ficando
// muito pesado e complicado".
//
// O desenho novo não estima nada. A cotação é feita FORA (o admin usa IA no
// cowork, onde isso é rápido) e os valores entram na viagem por grupo de despesa.
// O sistema deixa de adivinhar preço e passa a fazer o que software faz bem:
// garantir que cada viagem esteja na mão de UMA pessoa a cada momento, e que o
// repasse entre elas não se perca.
//
// ── Cinco estados, UMA coluna ────────────────────────────────────────────
//
//   rascunho           gestor preenche. Ninguém mais mexe.
//   aguardando_cotacao o OK do gestor: os dados estão prontos para cotar.
//                      Ele ainda pode voltar atrás (Editar).
//   em_cotacao         o admin FECHOU. Daqui em diante só ele mexe, e é este
//                      estado que sai no .xls — ver `entraNaExportacao`.
//   cotada             os valores por grupo foram lançados.
//   em_aprovacao       seguiu para a diretoria; é só aqui que o ✓/✗/💬 aparece.
//
// UMA coluna, não quatro booleanos (`ok`, `travado`, `cotado`, `na_diretoria`):
// com booleanos existem combinações impossíveis (travado sem ok, cotado sem
// travar) e a tela passa a mostrar estado que o fluxo não produz.
//
// ── A decisão da diretoria NÃO é um estado daqui ─────────────────────────
// Ela vive em `orcamento_validacoes`, compartilhada com Pessoal, Média, Valor
// fixo e Planejamento. Duplicá-la aqui faria a mesma informação existir em dois
// lugares, e um dia eles divergem. `pendente/aprovado/reprovado/revisar` continuam
// significando o que significam nas outras telas — inclusive o `revisar`, que já é
// o único estado em que o gestor edita item decidido.
//
// ── Todo estado tem caminho de VOLTA ────────────────────────────────────
// Foi a lição do CICLO, removido em 24/09/2026 por prender empresa num estado sem
// saída pela tela. Fechar, cotar e seguir para a diretoria se desfazem, todos pelo
// admin. Sem isso, um clique errado em 50 linhas não tem conserto.
//
// Módulo PURO e testado.
// =============================================================================

export const ESTADOS_VIAGEM = [
  "rascunho",
  "aguardando_cotacao",
  "em_cotacao",
  "cotada",
  "em_aprovacao",
] as const;

export type EstadoViagem = (typeof ESTADOS_VIAGEM)[number];

export function ehEstadoViagem(v: unknown): v is EstadoViagem {
  return typeof v === "string" && (ESTADOS_VIAGEM as readonly string[]).includes(v);
}

/**
 * Estados antigos, de antes do fluxo.
 *
 * `enviada` era "o gestor terminou" no desenho anterior, e cai em
 * `aguardando_cotacao` — é o equivalente mais próximo e não inventa cotação que
 * não existe. A migration converte as linhas; isto cobre o que vier de leitura
 * antiga em cache.
 */
export function normalizarEstado(v: unknown): EstadoViagem {
  if (ehEstadoViagem(v)) return v;
  return v === "enviada" ? "aguardando_cotacao" : "rascunho";
}

export const ESTADO_VIAGEM_LABEL: Record<EstadoViagem, string> = {
  rascunho: "Rascunho",
  aguardando_cotacao: "Aguardando cotação",
  em_cotacao: "Em cotação",
  cotada: "Cotada",
  em_aprovacao: "Na diretoria",
};

/** Frase curta que diz de quem é a vez. É o que a tela mostra ao lado do estado. */
export const ESTADO_VIAGEM_DONO: Record<EstadoViagem, string> = {
  rascunho: "com o gestor",
  aguardando_cotacao: "esperando a Controladoria fechar",
  em_cotacao: "a Controladoria está cotando",
  cotada: "esperando seguir para a diretoria",
  em_aprovacao: "com a diretoria",
};

// ─── Quem pode o quê ─────────────────────────────────────────────────────────

/**
 * O gestor edita os dados básicos em dois momentos, e só neles.
 *
 * Antes do fecho (rascunho, aguardando_cotacao) e quando a diretoria pede
 * REVISÃO — que é exatamente o pedido: "caso ele peça alguma modificação, a linha
 * da viagem desbloqueia para o gestor mexer nas informações básicas".
 *
 * `reprovado` não desbloqueia: reprovada fica bloqueada, e quem quiser retomá-la
 * pede ao admin. É a diferença entre "mude isso" e "não vai acontecer".
 */
export function gestorPodeEditar(estado: EstadoViagem, decisao: ValidacaoEstado): boolean {
  if (decisao === "revisar") return true;
  if (decisao === "aprovado" || decisao === "reprovado") return false;
  return estado === "rascunho" || estado === "aguardando_cotacao";
}

/**
 * O admin mexe nos dados básicos a partir do fecho.
 *
 * Antes disso a viagem é do gestor — e deixar o admin editar o rascunho dele
 * criaria duas pessoas escrevendo no mesmo lugar sem ninguém saber. A exceção é
 * `reprovado`/`aprovado`: ali a trava da validação manda, e ela já deixa admin e
 * diretoria passarem (é alçada, não fecho).
 */
export function adminPodeEditarBasico(estado: EstadoViagem): boolean {
  return estado === "em_cotacao" || estado === "cotada" || estado === "em_aprovacao";
}

/** Os valores por grupo são SEMPRE do admin, e só depois do fecho. */
export function podeLancarValores(estado: EstadoViagem): boolean {
  return estado === "em_cotacao" || estado === "cotada" || estado === "em_aprovacao";
}

/**
 * O ✓/✗/💬 da diretoria aparece só em `em_aprovacao`.
 *
 * "Nesse passo habilitam as aprovações da diretoria" — e o motivo é prático:
 * decidir sobre viagem sem cotação é decidir sobre zero.
 */
export function diretoriaPodeDecidir(estado: EstadoViagem): boolean {
  return estado === "em_aprovacao";
}

/** O .xls da cotação leva SÓ as fechadas. Ver `TRANSICOES` para o porquê. */
export function entraNaExportacao(estado: EstadoViagem): boolean {
  return estado === "em_cotacao";
}

/**
 * Por que o ✓/✗/💬 da diretoria NÃO aparece nesta linha — ou `null` quando aparece.
 *
 * Nas outras telas do orçamento a decisão está sempre na linha, porque não há
 * máquina de estados: o item existe, logo é decidível. Aqui ela só existe em
 * `em_aprovacao`, e a ausência SEM EXPLICAÇÃO faz quem olha concluir que a tela
 * quebrou — foi exatamente o que aconteceu em 07/10/2026, com cinco viagens
 * `cotada` e nenhum botão à vista.
 *
 * O texto diz o estado E o próximo passo, porque é o passo que falta, não o estado,
 * que a pessoa precisa saber.
 */
export function porQueSemDecisao(estado: EstadoViagem): string | null {
  switch (estado) {
    case "em_aprovacao":
      return null;
    case "cotada":
      return (
        "Cotada. A aprovação da diretoria abre quando a Controladoria clicar em " +
        "\u201cSeguir para a diretoria\u201d — até lá a viagem não entra na prévia do setor."
      );
    case "em_cotacao":
      return "Em cotação pela Controladoria. A diretoria decide depois de os valores entrarem.";
    case "aguardando_cotacao":
      return "Aguardando a Controladoria fechar e cotar. A diretoria decide depois disso.";
    default:
      return "Em rascunho. A diretoria decide depois do OK, do fecho e da cotação.";
  }
}

// ─── As transições ───────────────────────────────────────────────────────────

export type AcaoFluxo = "ok" | "editar" | "fechar" | "reabrir" | "seguir" | "voltar";

export type PapelFluxo = "gestor" | "admin";

interface Transicao {
  de: EstadoViagem;
  para: EstadoViagem;
  /** Quem pode disparar. Admin faz tudo o que o gestor faz. */
  por: PapelFluxo;
  rotulo: string;
}

/**
 * A tabela de transições — a fonte única do que a tela oferece e do que a action
 * aceita. Com as duas lendo daqui, não existe botão que a action recusa nem
 * caminho que a tela esconde.
 *
 * Por que `fechar` é separado de exportar: o download leva só o que está
 * `em_cotacao`. Se saísse do que tem apenas o OK do gestor, ele editaria depois e
 * a Controladoria cotaria um dado que mudou — sem nada avisar. Fechar passa a
 * significar "estes são os dados que eu vou cotar".
 */
export const TRANSICOES: Transicao[] = [
  { de: "rascunho", para: "aguardando_cotacao", por: "gestor", rotulo: "OK, pode cotar" },
  { de: "aguardando_cotacao", para: "rascunho", por: "gestor", rotulo: "Editar" },
  { de: "aguardando_cotacao", para: "em_cotacao", por: "admin", rotulo: "Fechar para cotação" },
  { de: "em_cotacao", para: "aguardando_cotacao", por: "admin", rotulo: "Reabrir ao gestor" },
  { de: "cotada", para: "em_aprovacao", por: "admin", rotulo: "Seguir para a diretoria" },
  { de: "em_aprovacao", para: "cotada", por: "admin", rotulo: "Voltar da diretoria" },
];

const ACAO_POR_TRANSICAO: Record<string, AcaoFluxo> = {
  "rascunho>aguardando_cotacao": "ok",
  "aguardando_cotacao>rascunho": "editar",
  "aguardando_cotacao>em_cotacao": "fechar",
  "em_cotacao>aguardando_cotacao": "reabrir",
  "cotada>em_aprovacao": "seguir",
  "em_aprovacao>cotada": "voltar",
};

/** Destino de uma ação a partir de um estado. `null` = ação não existe ali. */
export function destinoDaAcao(estado: EstadoViagem, acao: AcaoFluxo): EstadoViagem | null {
  for (const t of TRANSICOES) {
    if (t.de !== estado) continue;
    if (ACAO_POR_TRANSICAO[`${t.de}>${t.para}`] === acao) return t.para;
  }
  return null;
}

/** As ações que este papel pode disparar a partir deste estado. */
export function acoesDisponiveis(estado: EstadoViagem, papel: PapelFluxo): AcaoFluxo[] {
  return TRANSICOES.filter((t) => t.de === estado && (papel === "admin" || t.por === "gestor"))
    .map((t) => ACAO_POR_TRANSICAO[`${t.de}>${t.para}`])
    .filter((a): a is AcaoFluxo => Boolean(a));
}

export function rotuloDaAcao(acao: AcaoFluxo): string {
  const t = TRANSICOES.find((x) => ACAO_POR_TRANSICAO[`${x.de}>${x.para}`] === acao);
  return t?.rotulo ?? acao;
}

// ─── O que o OK exige ────────────────────────────────────────────────────────

export interface DadosBasicos {
  destino: string;
  uf: string | null;
  /** Cidade de partida DESTE trecho. Varia de linha para linha em viagem casada. */
  origem: string | null;
  mesIda: number | null;
  noites: number;
  pessoas: number;
  pessoasPorQuarto: number | null;
  modal: string | null;
  finalidade: string | null;
  tipoId: string | null;
}

/**
 * O que precisa estar preenchido para a viagem ir à cotação.
 *
 * Não é rigor de formulário: é o conjunto mínimo para alguém conseguir COTAR do
 * lado de fora. Sem mês não há tarifa; sem pessoas não há quantas passagens; sem
 * noites não há hotel. E a **finalidade** entra porque é o que o diretor lê para
 * aprovar — sem ela ele decide sobre um número sem saber para que serve.
 *
 * A ORIGEM é exigida junto com o destino (07/10/2026): um trecho é um par, e em
 * viagem casada a partida muda a cada perna — não dá para herdá-la de um cabeçalho
 * da grade. Faltando ela, quem cota escolhe uma por conta e ninguém vê que
 * escolheu.
 *
 * Devolve a primeira coisa que falta, não a lista: a tela aponta o próximo passo,
 * e cinco erros de uma vez em 50 linhas não se leem.
 */
export function faltaParaOk(d: DadosBasicos): string | null {
  if (!d.destino?.trim()) return "Informe o destino.";
  if (!d.origem?.trim()) return "Informe de onde este trecho parte — sem isso não há passagem para cotar.";
  if (d.mesIda == null) return "Escolha o mês da viagem.";
  if (!Number.isFinite(d.pessoas) || d.pessoas < 1) return "Informe quantas pessoas vão.";
  if (!Number.isFinite(d.noites) || d.noites < 0) return "Informe quantos dias de viagem.";
  if (!d.tipoId) return "Escolha o tipo da viagem.";
  if (!d.finalidade?.trim()) {
    return "Escreva em uma linha para que serve a viagem — é o que a diretoria lê para aprovar.";
  }
  return null;
}

// ─── Os valores da cotação ───────────────────────────────────────────────────

/**
 * Os grupos que recebem valor na cotação.
 *
 * São os mesmos do motor (`GRUPOS_VIAGEM`), e de propósito: é por eles que a
 * linha abre em árvore para o diretor, e é por eles que a Prévia e o drilldown já
 * somam. Grupo livre faria duas viagens parecerem diferentes pela escolha de
 * palavra de quem preencheu.
 */
export const GRUPOS_COTACAO = [
  "passagem",
  "translado",
  "transporte_local",
  "hospedagem",
  "alimentacao",
  "outros",
] as const;

export type GrupoCotacao = (typeof GRUPOS_COTACAO)[number];

export type ValoresCotacao = Partial<Record<GrupoCotacao, number | null>>;

/** Soma dos grupos — o custo da viagem passou a ser isto, e nada mais. */
export function totalCotado(v: ValoresCotacao): number {
  let total = 0;
  for (const g of GRUPOS_COTACAO) {
    const n = v[g];
    if (typeof n === "number" && Number.isFinite(n)) total += n;
  }
  return Math.round(total * 100) / 100;
}

/** Tem cotação quando ALGUM grupo tem valor. Zero em tudo = não cotada. */
export function temCotacao(v: ValoresCotacao): boolean {
  return totalCotado(v) > 0;
}

/**
 * O estado depois de lançar valores.
 *
 * É derivado, não um botão: lançar valor numa viagem fechada a torna `cotada`, e
 * zerar tudo a devolve para `em_cotacao`. Um botão "marcar como cotada" seria um
 * segundo lugar onde a mesma verdade poderia divergir do número.
 *
 * Em `em_aprovacao` o estado NÃO volta: a viagem já está com a diretoria, e
 * corrigir um valor ali não deve tirá-la da fila dela. O que avisa que o número
 * mudou é a decisão vencida pela edição, que já é regra do módulo.
 */
export function estadoAposValores(estado: EstadoViagem, v: ValoresCotacao): EstadoViagem {
  if (estado === "em_aprovacao") return estado;
  if (estado !== "em_cotacao" && estado !== "cotada") return estado;
  return temCotacao(v) ? "cotada" : "em_cotacao";
}

/**
 * O roteiro mudou depois de a cotação ter sido feita?
 *
 * Quando a diretoria pede revisão e o gestor muda noites ou destino, a cotação
 * que a Controladoria fez fica obsoleta. Os valores NÃO são apagados — pode ser
 * que só um grupo precise de ajuste —, mas a linha tem de dizer isso. É o mesmo
 * padrão do "extrato mudou depois do envio" dos relatórios do VB: o sistema não
 * decide por você, ele mostra que a base mudou.
 */
export function roteiroMudouDepoisDaCotacao(
  basicoAlteradoEm: string | null,
  cotadoEm: string | null,
): boolean {
  if (!basicoAlteradoEm || !cotadoEm) return false;
  const b = Date.parse(basicoAlteradoEm);
  const c = Date.parse(cotadoEm);
  if (!Number.isFinite(b) || !Number.isFinite(c)) return false;
  // Empate não conta: é artefato de relógio, não alteração.
  return b > c;
}

// ─── A leitura do conjunto ───────────────────────────────────────────────────

export type ContagemPorEstado = Record<EstadoViagem, number>;

export function contagemVazia(): ContagemPorEstado {
  return {
    rascunho: 0,
    aguardando_cotacao: 0,
    em_cotacao: 0,
    cotada: 0,
    em_aprovacao: 0,
  };
}

/**
 * Quantas viagens em cada estado.
 *
 * É o que vira os contadores no topo da grade — que também filtram. Com ~50
 * viagens elas nunca andam juntas: umas esperam OK, outras estão em cotação,
 * outras na diretoria. Uma tela em cinco passos sequenciais mentiria sobre isso;
 * o que serve é saber quantas estão em cada ponto e poder olhar só aquelas.
 */
export function contarPorEstado(
  linhas: ReadonlyArray<{ estado: EstadoViagem }>,
): ContagemPorEstado {
  const out = contagemVazia();
  for (const l of linhas) out[l.estado] += 1;
  return out;
}

/**
 * As que uma ação em LOTE alcançaria.
 *
 * Lê as `acoes` que o SERVIDOR já resolveu para cada linha — não recalcula
 * `acoesDisponiveis` a partir do papel. A diferença não é estilo: `acoes` embute o
 * escopo de SETOR e o fecho da finalização, que o papel sozinho não conhece.
 *
 * Era recalculado, e isso abria um buraco de desenho (07/10/2026): o DIRETOR (e o
 * Gerente Sócio) LÊ a empresa inteira mas só ESCREVE nos setores vinculados a ele,
 * então o botão de lote contava as 50 viagens visíveis e, ao clicar, 40 voltavam
 * recusadas com "você só pode alterar os setores vinculados a você". Nada era
 * gravado — a action confere setor por linha —, mas a tela oferecia o que o
 * servidor recusa, que é exatamente o que esta grade se proibiu de fazer.
 */
export function alvosDoLote<T extends { estado: EstadoViagem; acoes: readonly AcaoFluxo[] }>(
  linhas: readonly T[],
  acao: AcaoFluxo,
): T[] {
  return linhas.filter((l) => l.acoes.includes(acao) && destinoDaAcao(l.estado, acao));
}

// ─── O retrato do custo ──────────────────────────────────────────────────────

export interface GrupoDoRetrato {
  grupo: GrupoCotacao;
  label: string;
  total: number;
  linhas: Array<{ descricao: string; valor: number }>;
}

export interface RetratoCotacao {
  custo_total: number;
  /** 12 posições: o custo inteiro no mês da partida. */
  meses: number[];
  /** A árvore que o diretor abre na linha. */
  grupos: GrupoDoRetrato[];
  premissas: string[];
}

function brl(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function dataCurta(iso: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

/**
 * O custo da viagem, montado dos valores cotados.
 *
 * ── Isto substituiu o motor de estimativa ────────────────────────────────
 * Não há mais R$/km, faixa por região, histórico nem busca na web: o número é a
 * soma do que a Controladoria cotou. O que o motor fazia de útil e que continua
 * aqui são as três coisas que a Prévia e o diretor consomem — o total, o mês em que
 * ele cai, e a abertura por grupo.
 *
 * ── O custo inteiro cai no MÊS DA PARTIDA ────────────────────────────────
 * Mesmo quando a viagem atravessa a virada do mês. A DRE é caixa, e passagem e
 * hotel são pagos antes de viajar; ratear por noite jogaria para fevereiro dinheiro
 * que saiu em janeiro. Regra mantida do desenho anterior.
 *
 * ── A premissa diz DE QUANDO é o número ──────────────────────────────────
 * Sem a data-base, seis meses adiante ninguém sabe se a tarifa era de alta ou baixa
 * estação — e o diretor aprova um valor sem saber o que ele representa.
 */
export function retratoDaCotacao(opts: {
  valores: ValoresCotacao;
  mesIda: number | null;
  cotadoEm: string | null;
  dataBase: string | null;
  observacao: string | null;
  /** Rótulo legível de cada grupo (vem de `GRUPO_LABEL`, do motor). */
  labels: Record<GrupoCotacao, string>;
  roteiroMudou?: boolean;
}): RetratoCotacao {
  const grupos: GrupoDoRetrato[] = [];
  for (const g of GRUPOS_COTACAO) {
    const v = opts.valores[g];
    if (typeof v !== "number" || !Number.isFinite(v) || v === 0) continue;
    const valor = Math.round(v * 100) / 100;
    grupos.push({
      grupo: g,
      label: opts.labels[g],
      total: valor,
      // Uma linha por grupo: a cotação é externa e vem agregada, então inventar
      // sublinhas ("passagem × 2 pessoas") descreveria uma conta que não foi a que
      // produziu o número.
      linhas: [{ descricao: `${opts.labels[g]} (cotado)`, valor }],
    });
  }

  const total = totalCotado(opts.valores);
  const meses = Array.from({ length: 12 }, () => 0);
  if (opts.mesIda != null && opts.mesIda >= 1 && opts.mesIda <= 12) {
    meses[opts.mesIda - 1] = total;
  }

  const premissas: string[] = [];
  if (total > 0) {
    const quando = dataCurta(opts.cotadoEm);
    const base = dataCurta(opts.dataBase);
    premissas.push(
      `Valores COTADOS pela Controladoria${quando ? ` em ${quando}` : ""}` +
        `${base ? `, para a data-base ${base}` : ""} — ${brl(total)} no total. ` +
        "Não há estimativa do sistema neste número.",
    );
    if (opts.observacao?.trim()) premissas.push(`Fonte da cotação: ${opts.observacao.trim()}`);
  } else {
    premissas.push(
      "Viagem AGUARDANDO COTAÇÃO: entra com zero até a Controladoria lançar os valores. " +
        "O cadastro está completo; o que falta é o preço.",
    );
  }
  if (opts.mesIda == null) {
    premissas.push("Sem mês definido, o custo não cai em mês nenhum do orçamento.");
  }
  if (opts.roteiroMudou) {
    premissas.push(
      "ATENÇÃO: o roteiro foi alterado DEPOIS da cotação — os valores podem não " +
        "corresponder mais ao que está cadastrado.",
    );
  }

  return { custo_total: total, meses, grupos, premissas };
}
