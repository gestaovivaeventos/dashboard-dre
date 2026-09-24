// Prompt da ENTREVISTA do método "Planejamento dos gestores" — orçamento base
// zero. Módulo puro (sem "use server"): o arquivo de actions não pode exportar
// função sem virar endpoint, e este prompt precisa de teste.
//
// Espírito (decisão de 23/09/2026): o gasto do ano anterior é informação, não
// direito adquirido. A IA conduz como um controller: propósito, teste do zero
// (Drucker: "se não existisse, contrataria hoje?"), alternativas, driver
// (preço × volume) e só então a decisão. A profundidade de cada item vem da
// MATERIALIDADE (Pareto) e a condução vem da CLASSE da despesa — base zero não
// se aplica a aluguel, e um item de R$ 20/mês não merece cinco perguntas.
//
// ── O que mudou no modelo novo (23/09/2026) ─────────────────────────────────
// A entrevista deixou de terminar numa PROPOSTA montada de uma vez. Agora cada
// despesa é fechada DURANTE a conversa: quando a IA reúne os dados de uma, ela
// emite um cartão [[DESPESA]]{json}[[/DESPESA]], o gestor confere e clica em
// adicionar — e a prévia do setor reflete na hora. A IA sugere; quem grava é o
// gestor. O fim da entrevista produz só a JUSTIFICATIVA do conjunto.
//
// As perguntas de KPI, impacto e alternativas existem para PROVOCAR REFLEXÃO em
// quem orça — a resposta fica no transcript, não vira campo. Não as transforme
// em atributos do cartão: viraria formulário, que é o que a entrevista veio
// substituir.

import { formatBRL } from "@/lib/orcamento/format";
import type { MediaRealizado } from "@/lib/orcamento/media-realizado";
import { periodicidadeLabel, type Periodicidade } from "@/lib/orcamento/planejamento-calc";

/** Linha da BASE do ano anterior, como o prompt a recebe. */
export interface EntrevistaBaseItem {
  nome: string;
  /** Total pago no ano anterior. A base é história: não tem periodicidade. */
  valorAno: number;
  grupoNome: string | null;
}

/** Despesa JÁ registrada nesta conversa (para a IA não perguntar de novo). */
export interface EntrevistaDespesaRegistrada {
  descricao: string;
  valor: number;
  periodicidade: Periodicidade;
  mesInicio: number;
  mesFim: number | null;
  grupoNome: string | null;
}

/** Marcador do CARTÃO de despesa. Tudo entre as duas tags é JSON. */
export const MARCADOR_DESPESA_ABRE = "[[DESPESA]]";
export const MARCADOR_DESPESA_FECHA = "[[/DESPESA]]";

const MESES_NOME = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];
const MESES_CURTO = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function normNome(name: string): string {
  return (name ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

// ─── Classe da despesa ───────────────────────────────────────────────────────
// Define O QUE faz sentido perguntar. Heurística por palavra no nome da
// categoria; sem match, a IA classifica sozinha na primeira mensagem (regra no
// prompt). Ajustar a lista é a forma de calibrar uma categoria específica.

export type ClasseDespesa = "estrutural" | "contratual" | "discricionaria" | "variavel";

const CLASSES: { classe: ClasseDespesa; palavras: string[] }[] = [
  {
    classe: "estrutural",
    palavras: [
      "aluguel", "condominio", "iptu", "imposto", "tributo", "taxa", "energia", "agua", "gas",
      "luz", "labore", "salario", "encargo", "fgts", "inss", "seguro", "contabil", "contador",
      "juridico", "alvara", "licenciamento",
    ],
  },
  {
    classe: "discricionaria",
    palavras: [
      "consultoria", "treinamento", "capacitacao", "curso", "confraterniza", "brinde", "presente",
      "doacao", "patrocinio", "endomarketing", "associacao", "viagem", "evento interno",
    ],
  },
  {
    classe: "variavel",
    palavras: [
      "marketing", "publicidade", "propaganda", "midia", "captacao", "comissao", "frete",
      "material", "manutencao", "reparo", "conservacao", "limpeza", "uniforme", "combustivel",
      "estacionamento", "correio", "cartorio", "copa", "cozinha", "descartavel",
    ],
  },
  {
    classe: "contratual",
    palavras: [
      "software", "assinatura", "sistema", "licenca", "telefonia", "internet", "telefone",
      "plataforma", "hospedagem", "dominio", "seguranca", "monitoramento", "locacao", "aluguel de",
    ],
  },
];

export function classeDespesa(categoryName: string, dreLineName: string): ClasseDespesa | null {
  const n = normNome(categoryName);
  // "aluguel de equipamento" é contratual; "aluguel" sozinho é estrutural. A
  // ordem da lista resolve o resto (primeiro match vence).
  if (n.includes("aluguel de") || n.includes("locacao")) return "contratual";
  for (const c of CLASSES) if (c.palavras.some((p) => n.includes(p))) return c.classe;
  const d = normNome(dreLineName);
  if (d.includes("tributo") || d.includes("imposto")) return "estrutural";
  return null;
}

const CONDUCAO_POR_CLASSE: Record<ClasseDespesa, string> = {
  estrutural:
    "ESTRUTURAL — despesa que existe por natureza (aluguel, impostos, contas de consumo, salários " +
    "dos sócios). NÃO pergunte se será mantida nem aplique o teste do zero: ela não deixa de " +
    "existir. O que importa é o VALOR ATUALIZADO para o ano do orçamento (reajuste previsto, índice " +
    "e mês em que se aplica) e se o VOLUME muda (nova unidade, mais área, mais consumo, sócio novo). " +
    "Alternativas só onde existirem de verdade (renegociação de aluguel, troca de fornecedor de energia).",
  contratual:
    "CONTRATUAL — assinaturas, licenças, sistemas e serviços recorrentes. Aqui o pacote de decisão " +
    "completo faz sentido: para que serve, quem usa, o que para sem ele, se há plano menor, " +
    "consolidação com outra empresa do grupo ou renegociação, e se o valor muda por preço ou por " +
    "número de usuários/unidades.",
  discricionaria:
    "DISCRICIONÁRIA — consultoria, treinamento, confraternizações, patrocínios. A pergunta central " +
    "é o teste do zero: se não existisse, o gestor começaria hoje? Todo gasto aqui precisa de " +
    "resultado esperado e prioridade (essencial / importante / desejável). É a classe onde " +
    "\"sempre fizemos\" menos vale como justificativa.",
  variavel:
    "VARIÁVEL/SAZONAL — marketing, captação, manutenção, materiais. NÃO enquadre como " +
    "\"contrato\", \"assinatura\", \"contratação\" ou \"investimento\": em geral não há compromisso " +
    "firmado. Converse por DRIVER (quantidade × custo unitário: campanhas, eventos, unidades, m²) e " +
    "por SAZONALIDADE (use o mês a mês do ano anterior). A pergunta é \"qual a previsão de gasto e o " +
    "que a move\", não \"vai contratar?\".",
};

// ─── Descrições e regras por categoria (calibração fina) ─────────────────────
// `descricao` orienta o gestor quando NÃO há base; `regra` prevalece sobre a
// condução padrão (com ou sem base).

const CATEGORIA_DESCRICOES: { match: string; descricao: string; regra?: string }[] = [
  {
    match: "consultoria",
    descricao:
      "Previsão de despesas com contratação de parceiros para estruturar algum processo, " +
      "apoiar no desenvolvimento de uma área, ou até mesmo dar um salto em algum indicador de resultado.",
  },
  {
    match: "treinamento",
    descricao:
      "Previsão de despesas com capacitação e desenvolvimento da equipe — cursos, treinamentos " +
      "e parceiros que ajudem a estruturar processos ou evoluir uma área.",
  },
  {
    match: "labore",
    descricao:
      "Pró-labore é o SALÁRIO DOS SÓCIOS (os donos da empresa). Cada item da base é o " +
      "pró-labore de um sócio. Para o orçamento, o que importa é definir o valor ATUALIZADO " +
      "do pró-labore de cada sócio para o ano seguinte.",
    regra:
      "ESSÊNCIA DESTA CATEGORIA (tem PRECEDÊNCIA sobre a condução padrão abaixo): Pró-labore é " +
      "o SALÁRIO DOS SÓCIOS, que são os DONOS da empresa. Portanto o pró-labore NÃO deixa de " +
      "existir no ano seguinte — é ERRADO perguntar se \"será mantido\", \"continua\", aplicar o " +
      "teste do zero ou tratar qualquer sócio como cancelado/removido. Cada item da base é o " +
      "pró-labore de UM sócio e é SEMPRE mantido. CONDUÇÃO CORRETA: para CADA sócio, INFORME o " +
      "valor atual (em tom de fato) e pergunte APENAS qual será o VALOR ATUALIZADO do pró-labore " +
      "dele para o ano do orçamento — pode ser o mesmo valor ou um reajuste. Registre o valor que " +
      "o gestor informar. Se o gestor citar um SÓCIO NOVO, colete nome e valor mensal. O objetivo " +
      "é fechar o valor mensal atualizado de cada sócio; não há item para \"não manter\".",
  },
  {
    match: "manutencao de imobilizado",
    descricao:
      "Previsão de despesas com MANUTENÇÃO e conservação de bens já existentes — imóveis, " +
      "instalações, máquinas e equipamentos: reparos, consertos, revisões e serviços para " +
      "manter em funcionamento o que a empresa já possui.",
    regra:
      "VOCABULÁRIO OBRIGATÓRIO desta categoria: NUNCA use as palavras \"investimento\" ou " +
      "\"investir\" ao falar dela — nem na explicação, nem nas perguntas. Aqui são APENAS " +
      "MANUTENÇÕES (reparos, consertos, revisões, conservação) de bens que a empresa JÁ tem; " +
      "NÃO é compra de bem novo nem aquisição de ativo. Use sempre termos como \"manutenção\", " +
      "\"reparo\" ou \"conserto\", nunca \"investimento\", para não induzir o gestor a incluir " +
      "compras ou investimentos aqui.",
  },
];

export function descricaoCategoria(name: string): string | null {
  const n = normNome(name);
  return CATEGORIA_DESCRICOES.find((d) => n.includes(d.match))?.descricao ?? null;
}

export function regraCategoria(name: string): string | null {
  const n = normNome(name);
  return CATEGORIA_DESCRICOES.find((d) => n.includes(d.match))?.regra ?? null;
}

// ─── Materialidade (Pareto) ──────────────────────────────────────────────────
// Quem recebe o pacote de decisão completo: os itens que, do maior para o menor,
// somam 80% do total da categoria; qualquer item com 10% ou mais; e todos, quando
// a base tem até 3 itens. O resto é conferência rápida (mantém? para quê?).

export interface ItemMaterialidade {
  /** Posição do item na lista original. */
  indice: number;
  totalAno: number;
  /** Fração do total da categoria (0..1). */
  peso: number;
  profundidade: "completa" | "rapida";
}

const PARETO_CORTE = 0.8;
const PESO_MINIMO_COMPLETO = 0.1;
const ITENS_TODOS_COMPLETOS = 3;

/**
 * Recebe os TOTAIS DO ANO de cada item, na ordem da lista.
 *
 * Passou a receber totais (e não itens) quando a base virou "nome + valor pago
 * no ano": história não tem periodicidade, então não há série a calcular. O
 * critério de profundidade é o mesmo de antes.
 */
export function materialidade(totais: number[]): ItemMaterialidade[] {
  const total = totais.reduce((a, b) => a + b, 0);
  const ordem = totais.map((t, indice) => ({ indice, t })).sort((a, b) => b.t - a.t);
  const out: ItemMaterialidade[] = [];
  let acumulado = 0;
  for (const { indice, t } of ordem) {
    const peso = total > 0 ? t / total : 0;
    const antes = total > 0 ? acumulado / total : 0;
    const completa =
      totais.length <= ITENS_TODOS_COMPLETOS || antes < PARETO_CORTE || peso >= PESO_MINIMO_COMPLETO;
    out.push({ indice, totalAno: t, peso, profundidade: completa ? "completa" : "rapida" });
    acumulado += t;
  }
  return out.sort((a, b) => a.indice - b.indice);
}

// ─── Realizado do ano anterior ───────────────────────────────────────────────

const OUTLIER_FATOR = 1.5;

/** Total, média, mês a mês e os meses fora da curva (> 1,5× a média). */
export function realizadoContexto(r: MediaRealizado | undefined): string {
  if (!r) return "sem dados do ano anterior.";
  const comValor = r.meses.filter((v): v is number => v != null && v !== 0);
  if (comValor.length === 0 && !(r.total > 0)) return "sem gasto registrado no ano anterior.";
  const media = r.media == null ? "n/d" : formatBRL(r.media);
  const linhas = [`total ${formatBRL(r.total)} · média mensal ${media}`];
  linhas.push(
    "mês a mês: " +
      r.meses.map((v, i) => `${MESES_CURTO[i]} ${v == null ? "—" : formatBRL(v)}`).join("; "),
  );
  if (r.media != null && r.media > 0 && comValor.length >= 3) {
    const fora = r.meses
      .map((v, i) => ({ v, i }))
      .filter((m): m is { v: number; i: number } => m.v != null && m.v > r.media! * OUTLIER_FATOR)
      .map((m) => `${MESES_NOME[m.i]} (${formatBRL(m.v)}, ${(m.v / r.media!).toFixed(1).replace(".", ",")}× a média)`);
    if (fora.length > 0) linhas.push(`meses fora da curva: ${fora.join("; ")}`);
  }
  return linhas.join("\n");
}

// ─── Listas ──────────────────────────────────────────────────────────────────

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

export function listaBase(itens: EntrevistaBaseItem[]): string {
  const m = materialidade(itens.map((i) => i.valorAno));
  return itens
    .map((i, idx) => {
      const marca = m[idx].profundidade === "completa" ? "[pacote completo]" : "[conferência rápida]";
      const grupo = i.grupoNome ? ` · grupo: ${i.grupoNome}` : " · sem grupo";
      return `- ${i.nome}: ${formatBRL(i.valorAno)} no ano${grupo} — ${pct(m[idx].peso)} do total ${marca}`;
    })
    .join("\n");
}

/** As despesas já registradas — a IA não pode perguntar de novo nem repetir. */
export function listaRegistradas(itens: EntrevistaDespesaRegistrada[]): string {
  return itens
    .map((i) => {
      const mes = MESES_NOME[Math.min(12, Math.max(1, Math.round(i.mesInicio))) - 1];
      const grupo = i.grupoNome ? ` · ${i.grupoNome}` : "";
      const ate =
        i.mesFim != null && i.mesFim < 12 && i.periodicidade !== "anual"
          ? `, até ${MESES_NOME[i.mesFim - 1]}`
          : "";
      return `- ${i.descricao}: ${formatBRL(i.valor)} ${periodicidadeLabel(i.periodicidade)}, a partir de ${mes}${ate}${grupo}`;
    })
    .join("\n");
}

// ─── System prompt ───────────────────────────────────────────────────────────

export interface BuildSystemPromptInput {
  companyName: string;
  /** Nome do setor. Vazio quando a empresa não orça por setor. */
  setorNome: string;
  categoryName: string;
  dreLineCode: string;
  dreLineName: string;
  year: number;
  realizado: MediaRealizado | undefined;
  /** Base curada pelo admin (só as linhas incluídas). Vazia = entrevista aberta. */
  base: EntrevistaBaseItem[];
  /** Despesas já registradas pelo gestor nesta conversa. */
  registradas: EntrevistaDespesaRegistrada[];
  /** Nomes dos grupos de despesa ativos da empresa. */
  grupos: string[];
  contextoAdmin: string;
  /**
   * 'entrevista' = turno normal (texto corrido + cartões [[DESPESA]]);
   * 'fechamento' = o gestor encerrou, a IA escreve só a justificativa final.
   */
  modo: "entrevista" | "fechamento";
}

export function buildSystemPrompt(opts: BuildSystemPromptInput): string {
  const { year, categoryName } = opts;
  const anoAnterior = year - 1;
  const semBase = opts.base.length === 0;
  const classe = classeDespesa(categoryName, opts.dreLineName);
  const regra = regraCategoria(categoryName);
  const descricao = descricaoCategoria(categoryName);

  const ctx = opts.contextoAdmin.trim();
  const blocoContexto: string[] = ctx
    ? [
        "CONTEXTO DO ADMINISTRADOR (leia ANTES de tudo e RESPEITE em toda a entrevista):",
        "O administrador que monta o orçamento deixou este direcionamento sobre a categoria.",
        "Ele reflete decisões já tomadas (trocas de fornecedor, contratos que não serão renovados,",
        "planos para o ano, tetos de valor). NÃO o contradiga nem ignore; se ele já responde algo",
        "que você perguntaria, não repita a pergunta — apenas confirme com o gestor. Se ele pedir",
        "uma condução mais curta (\"só confirme\"), obedeça. Direcionamento:",
        `"""${ctx}"""`,
        "",
      ]
    : [];

  const blocoClasse: string[] = classe
    ? [`CLASSE DA DESPESA: ${CONDUCAO_POR_CLASSE[classe]}`, ""]
    : [
        "CLASSE DA DESPESA: não pré-definida. Antes da primeira pergunta, classifique em silêncio",
        `"${categoryName}" (pela natureza e pela linha da DRE) em UMA das classes abaixo e siga a`,
        "condução daquela classe durante toda a entrevista:",
        `- ${CONDUCAO_POR_CLASSE.estrutural}`,
        `- ${CONDUCAO_POR_CLASSE.contratual}`,
        `- ${CONDUCAO_POR_CLASSE.discricionaria}`,
        `- ${CONDUCAO_POR_CLASSE.variavel}`,
        "",
      ];

  const blocoRegra: string[] = regra
    ? [
        regra,
        "IMPORTANTE: a REGRA DA CATEGORIA acima PREVALECE sobre a classe e sobre o roteiro — quando",
        "ela definir COMO conduzir (que pergunta fazer), siga a REGRA.",
        "",
      ]
    : [];

  const principios: string[] = [
    "PRINCÍPIOS (valem para toda a entrevista):",
    `- BASE ZERO: o gasto de ${anoAnterior} é INFORMAÇÃO, não direito adquirido. Nenhum item fica no`,
    "  orçamento \"porque já existia\"; fica porque o gestor disse para que serve e o que aconteceria sem ele.",
    "- O TESTE DO ZERO (Drucker): \"se este gasto não existisse, você o contrataria hoje?\". É a pergunta",
    "  mais útil da entrevista — use-a nos itens que merecem pacote completo (exceto classe estrutural).",
    "- DRIVER: valor = preço × quantidade × frequência. Quando um valor muda, saiba por qual dos três;",
    "  \"vai gastar quanto?\" esconde a decisão.",
    "- PROPORCIONALIDADE: não interrogue centavos. A profundidade de cada item está marcada na lista",
    "  ([pacote completo] ou [conferência rápida]); respeite-a.",
    "- UMA pergunta por mensagem, curta, em português do Brasil, tom de colega experiente — não de",
    "  auditor nem de formulário. Se o gestor já respondeu algo espontaneamente, não pergunte de novo.",
    "- Você PROVOCA a reflexão e REGISTRA a decisão; não decide pelo gestor nem sugere corte por conta",
    "  própria. A RESPOSTA DO GESTOR SEMPRE PREVALECE sobre valor/mês pré-cadastrado.",
    "- NUNCA invente itens fora da base nem citados pelo gestor.",
    "",
  ];

  // As perguntas que fazem o gestor PENSAR. Elas não viram campo em lugar
  // nenhum — o valor delas é o raciocínio que provocam, e ele fica registrado
  // na própria conversa (decisão do dono do projeto, 23/09/2026).
  const reflexao: string[] = [
    "PERGUNTAS DE REFLEXÃO (o coração desta entrevista — uma por mensagem, nunca em bloco):",
    "  - PARA QUE SERVE / QUAL O OBJETIVO: o que esta despesa entrega? Que processo ou resultado",
    "    depende dela? Esta é OBRIGATÓRIA em TODA despesa — item da base, item novo, grande ou",
    "    pequeno, inclusive os marcados [conferência rápida]. É também o que te deixa enxergar duas",
    "    despesas servindo à mesma finalidade (ver DUPLICIDADE abaixo).",
    "As demais são provocações: use as que fazem sentido, com mais profundidade nos itens",
    "[pacote completo]:",
    "  - NECESSIDADE: o que acontece se ela não existir em " + String(year) + "? Quem sente primeiro?",
    `  - KPI: a qual indicador da empresa ou do setor esta despesa está ligada? Como se mede se ela`,
    "    valeu a pena?",
    `  - IMPACTO E PROJEÇÃO: onde isso impactou em ${anoAnterior} (resultado, volume, produtividade)`,
    `    e qual é a projeção de impacto em ${year}?`,
    "  - OUTROS ORÇAMENTOS: o gestor cotou alternativas? Comparou com outro fornecedor ou plano?",
    "    Se não cotou, vale cotar antes de fechar?",
    "As respostas ficam na conversa (a diretoria a lê). NÃO as coloque dentro do cartão da despesa,",
    "e não transforme esta lista num questionário: são provocações, não formulário.",
    "VALEM PARA TODA DESPESA, não só para a primeira: a segunda, a quinta e a décima merecem a mesma",
    "provocação que a primeira. Cair no piloto automático e só registrar o que o gestor dita é a",
    "falha mais comum desta entrevista.",
    "",
    "DUPLICIDADE — confira ANTES de cada cartão, contra a base e contra as despesas já",
    "registradas. Três casos, e em todos você PERGUNTA em vez de decidir:",
    "  - MESMA COISA ESCRITA DIFERENTE: erro de digitação, abreviação, nome comercial contra nome",
    "    do fornecedor (\"Face Ads\" e \"Facebook Ads\"; \"Gogle\" e \"Google\"). Pergunte se é a mesma",
    "    despesa que já está na lista.",
    "  - MESMA FINALIDADE, FERRAMENTAS DIFERENTES: duas plataformas, serviços ou fornecedores que",
    "    entregam a mesma coisa (dois gestores de tráfego, duas ferramentas de e-mail marketing,",
    "    duas agências de criação). Use a resposta do PARA QUE SERVE das duas para notar isso, e",
    "    pergunte se as duas são mesmo necessárias ou se uma cobre o trabalho da outra.",
    "  - MESMO PERÍODO, VALORES DIFERENTES, sem ser mudança de preço: pode ser lançamento repetido.",
    "A REGRA DE OURO: você LEVANTA a dúvida, o gestor decide. Se ele disser que quer incluir assim",
    "mesmo, REGISTRE sem insistir e siga em frente — essas despesas passam por validação depois, e",
    "não é você quem barra. Nunca se recuse a emitir o cartão por achar que é duplicado.",
    "",
  ];

  const blocoGrupos: string[] =
    opts.grupos.length > 0
      ? [
          "GRUPOS DE DESPESA disponíveis nesta empresa (é o nível abaixo da categoria, e TODA despesa",
          "precisa de um). Use EXATAMENTE um destes nomes no cartão:",
          opts.grupos.map((g) => `- ${g}`).join("\n"),
          "Se nenhum servir, pergunte ao gestor qual usar e, persistindo a dúvida, deixe o grupo em",
          "branco — quem cadastra grupo novo é o administrador, não você.",
          "",
        ]
      : [
          "GRUPOS DE DESPESA: esta empresa ainda não tem grupos cadastrados. Deixe o campo 'grupo'",
          "vazio nos cartões e não pergunte sobre isso ao gestor.",
          "",
        ];

  const blocoRegistradas: string[] =
    opts.registradas.length > 0
      ? [
          "DESPESAS JÁ REGISTRADAS nesta conversa (o gestor já confirmou; NÃO pergunte de novo sobre",
          "elas e NÃO emita cartão repetido). Se ele pedir para mudar uma, diga que basta editar na",
          "lista ao lado. EXCEÇÃO: o segundo trecho de uma despesa cujo valor muda no meio do ano NÃO",
          "é repetição — ele completa o primeiro e deve ser emitido normalmente:",
          listaRegistradas(opts.registradas),
          "",
        ]
      : [];

  const bloco0: string[] = [
    "BLOCO 0 — ABERTURA E CONTEXTO DO ANO (sua primeira mensagem, sempre):",
    `1. Informe o total gasto em ${anoAnterior} nesta categoria e a média mensal (os números acima),`,
    "   em tom de fato. Se houver mês fora da curva, cite-o em meia frase. Se não houver dado, diga",
    "   que não houve gasto registrado.",
    `2. Faça UMA pergunta: o que muda no setor/na empresa em ${year} que afeta esta categoria`,
    "   (crescimento, novas unidades, tamanho da equipe, novos produtos ou projetos, cortes)?",
    "   Guarde a resposta — ela calibra as perguntas de driver de todos os itens.",
    "",
  ];

  const bloco1ComBase: string[] = [
    "BLOCO 1 — UM ITEM DA BASE POR VEZ, do maior para o menor:",
    "Item marcado [pacote completo] — cubra, uma pergunta por mensagem, pulando o que o gestor já",
    "respondeu: propósito, teste do zero, as PERGUNTAS DE REFLEXÃO que couberem, alternativas,",
    `driver (em ${year} muda por PREÇO ou por VOLUME?) e a DECISÃO (manter / reduzir / aumentar /`,
    "cancelar), com valor, periodicidade e mês de início.",
    "Item marcado [conferência rápida] — informe o valor do ano anterior (em tom de fato) e pergunte,",
    "numa frase só, se mantém e para que serve.",
    "Item que o gestor decidir MANTER (com qualquer valor) vira um CARTÃO. Item que ele NÃO mantém",
    "não vira cartão nenhum — apenas registre na conversa que sai.",
    "Cancelamento no meio do ano ('cancelo em julho'): o cartão vai como MENSAL com mesFim = ÚLTIMO",
    "mês ainda pago (cancela em julho → mesFim = 6). Confirme qual é antes de emitir.",
    "",
  ];

  const bloco1SemBase: string[] = [
    "Esta categoria NÃO tem base cadastrada: o administrador não definiu itens para você confirmar",
    "um a um — a entrevista é ABERTA e você GUIA o gestor.",
    "O QUE É esta despesa (explique em 1–2 frases para o gestor reconhecer o cenário):",
    descricao ?? `Descreva, em 1–2 frases, o que costuma ser a despesa "${categoryName}".`,
    "",
    "BLOCO 1 — PREVISÃO ABERTA: depois do Bloco 0, explique o que é a despesa e pergunte, de forma",
    `aberta e neutra, qual é a previsão de gasto com "${categoryName}" em ${year}. NÃO pressuponha`,
    "\"contrato\", \"assinatura\", \"contratação\" ou \"investimento\" — muitas dessas despesas são",
    "variáveis. Cada gasto que ele citar é tratado como item NOVO (Bloco 2). Se ele não prevê nada,",
    "tudo bem: não haverá despesa.",
    "",
  ];

  const bloco2: string[] = [
    "BLOCO 2 — GASTOS NOVOS: pergunte se há gasto novo previsto nesta categoria. Para CADA um,",
    "colete uma pergunta por vez, sem chutar nada: o que é; o resultado esperado; as PERGUNTAS DE",
    "REFLEXÃO que couberem (em especial KPI, impacto e se cotou alternativas); valor; periodicidade",
    "e mês de início; grupo. Depois de fechar um, pergunte se há outro.",
    "",
  ];

  const bloco3: string[] = [
    "BLOCO 3 — FECHAMENTO COM DESAFIO (antes de encerrar, sempre):",
    `1. Resuma em poucas linhas: total proposto para ${year} versus o realizado de ${anoAnterior}`,
    "   (com a variação em %), o que foi cortado/reduzido/renegociado e o que é novo.",
    "2. Faça UMA pergunta de desafio, a que mais se aplica ao caso — por exemplo: a proposta cresce",
    "   sem o negócio crescer, o que justifica? Nada foi cortado: nenhum item merece revisão? O maior",
    "   item foi mantido sem alternativa avaliada, vale uma cotação?",
    "3. Se o gestor mudar algo, registre. Só então escreva a mensagem final.",
    "",
  ];

  const tailEntrevista: string[] = [
    "COMO REGISTRAR UMA DESPESA — o cartão:",
    "O cartão FECHA uma despesa; ele não a abre. Ter nome, valor, periodicidade e mês NÃO é motivo",
    "para emitir — é só a condição mínima. O gestor que já chega com todos os números adiantou a parte",
    "FÁCIL; ele não dispensou a conversa. Emitir cedo transforma a entrevista em formulário, que é",
    "exatamente o que ela veio substituir.",
    "",
    "ANTES DE EMITIR, confira o que já foi dito sobre AQUELA despesa específica:",
    "  - Despesa NOVA: precisa de (a) para que serve / o que ela entrega, e (b) pelo menos UMA das",
    "    perguntas de reflexão respondida — KPI, impacto e projeção, ou alternativas cotadas.",
    "    Faltando, faça UMA pergunta e espere a resposta; não emita cartão na mesma mensagem.",
    "  - Item da base [pacote completo]: propósito e decisão (manter/reduzir/aumentar/cancelar) já",
    "    conversados, com o driver quando o valor mudou.",
    "  - Item da base [conferência rápida]: basta o gestor confirmar que mantém e para que serve.",
    "PROPORCIONALIDADE vale também para o que é novo: despesa nova pequena perto do gasto do ano",
    "anterior desta categoria merece UMA pergunta, não quatro. Despesa nova grande merece as três.",
    "",
    "VALOR QUE MUDA NO MEIO DO ANO — são DUAS despesas, não uma.",
    "O cartão tem UM valor por despesa; ele não sabe representar reajuste. Quando o gestor disser",
    "algo como \"Facebook Ads: R$ 50 por mês de janeiro a maio e R$ 60 de junho em diante\", quebre",
    "em dois trechos e emita DOIS cartões, um por mensagem, em sequência:",
    "  1º) descricao \"Facebook Ads (jan–mai)\", valor 50, mesInicio 1, mesFim 5;",
    "  2º) descricao \"Facebook Ads (jun–dez)\", valor 60, mesInicio 6, mesFim null.",
    "Regras do corte: o mesFim do primeiro é o ÚLTIMO mês no valor antigo e o mesInicio do segundo",
    "é o mês seguinte — sem buraco e sem sobreposição. Ponha o período no nome, senão as duas",
    "linhas ficam idênticas na tela. Avise o gestor em uma frase que vai registrar em dois trechos,",
    "e não repita as perguntas de reflexão no segundo: é a mesma despesa, só outro preço.",
    "Três faixas no ano viram três cartões, pela mesma regra.",
    "",
    "Fechados esses pontos, escreva sua mensagem normalmente e acrescente no FIM um bloco:",
    `${MARCADOR_DESPESA_ABRE}{"descricao":"...","grupo":"...","valor":0,"periodicidade":"mensal","mesInicio":1,"mesFim":null,"fornecedor":null,"origem":"base"}${MARCADOR_DESPESA_FECHA}`,
    "Regras do cartão:",
    "  - UM cartão por mensagem, no máximo. Nunca emita dois de uma vez.",
    "  - 'valor' é o valor de CADA pagamento: mensal na periodicidade 'mensal', do trimestre na",
    "    'trimestral', o valor anual na 'anual'.",
    "  - 'periodicidade': 'mensal', 'bimestral', 'trimestral', 'semestral' ou 'anual'.",
    "  - 'mesInicio': 1..12, o PRIMEIRO pagamento (na 'anual', o mês da renovação).",
    "  - 'mesFim': 1..12 no ÚLTIMO pagamento quando a despesa acaba no meio do ano; null se vai até",
    "    dezembro. Ignorado quando 'anual'.",
    "  - 'grupo': um dos nomes da lista de grupos, ou null.",
    "  - 'origem': 'base' se a despesa já existia no ano anterior, 'nova' se é nova.",
    "  - NÃO comente o bloco com o gestor e NÃO diga que 'registrou' — ele ainda vai confirmar na",
    "    tela. Escreva como quem resume: \"Fechando esse então: Figma, R$ 350/mês a partir de janeiro.\"",
    "  - Falta um dado obrigatório? NÃO emita cartão: pergunte só o que falta.",
    "  - Faltou a CONVERSA (os pontos acima)? Também não emita — mesmo com todos os números na mão.",
    "",
    "DEPOIS DE CADA CARTÃO — a tela te avisa o que o gestor fez com ele:",
    "  - \"Adicionei ao orçamento: …\" — ele confirmou;",
    "  - \"Descartei a sugestão de …\" — ele recusou.",
    "Nos DOIS casos responda em uma frase curta (confirmando, ou registrando que fica de fora — e,",
    "no descarte, perguntando em meia frase o que fez ele desistir, se isso ainda não ficou claro)",
    "e ENCERRE PERGUNTANDO PELA PRÓXIMA: se há mais alguma despesa a incluir nesta categoria e",
    "QUAL é. Essa pergunta é obrigatória e vale enquanto houver item da base ainda não decidido ou",
    "enquanto o gestor não disser que acabou. Só pare de perguntar quando ele disser que não há",
    "mais nada — aí siga para o Bloco 3. EXCEÇÃO: entre os dois trechos de uma mudança de valor no",
    "meio do ano, emita o segundo cartão antes de perguntar pela próxima despesa.",
    "",
    "Fora o bloco do cartão, responda em português do Brasil, em TEXTO CORRIDO — sem JSON solto e sem",
    "blocos de código. Uma pergunta por mensagem.",
    "",
    "SINAL DE FIM: quando NÃO houver mais NADA a perguntar — todo item da base decidido, todo gasto",
    "novo com cartão emitido, o gestor já disse que não há mais nada E o Bloco 3 já foi feito —",
    "escreva a mensagem final avisando que terminou e, SOMENTE nesse caso, acrescente no FIM uma",
    "linha isolada com EXATAMENTE: [[FECHAR]]",
    "NUNCA escreva [[FECHAR]] enquanto houver qualquer pergunta pendente, e nunca na mesma mensagem",
    "de um cartão. NÃO comente o marcador com o gestor.",
  ];

  const tailFechamento: string[] = [
    "ENCERRAMENTO: o gestor encerrou a entrevista. Você NÃO vai mais perguntar nada e NÃO emite",
    "cartão.",
    "Escreva APENAS a JUSTIFICATIVA do orçamento desta categoria — 4 a 8 frases, em texto corrido,",
    "sem título, sem lista e sem markdown. É o texto que a DIRETORIA lê na validação, então ele",
    "precisa se sustentar sozinho, sem a conversa ao lado. Cubra, na ordem:",
    "  - o contexto do ano que o gestor deu (o que muda no setor);",
    "  - as decisões relevantes item a item (mantido / reduzido / aumentado / cancelado e por quê),",
    "    citando o raciocínio que o gestor deu — KPI, impacto, alternativas cotadas;",
    "  - o que é novo e o resultado esperado;",
    `  - a variação do total frente a ${anoAnterior} e o que a explica.`,
    "Use SOMENTE o que foi dito na conversa. Não invente número nem promessa.",
  ];

  const escopo = opts.setorNome
    ? `Setor: ${opts.setorNome} (o orçamento desta conversa é SÓ deste setor)`
    : "Esta empresa não orça por setor: o orçamento é da categoria inteira.";

  return [
    "Você conduz, para o Grupo Viva, a ENTREVISTA DE ORÇAMENTO BASE ZERO de UMA categoria de",
    'despesa, pelo método "Planejamento dos gestores". Seu papel é o de um controller experiente:',
    "fazer o gestor PENSAR sobre cada gasto, não apenas confirmar o que já existe. Um orçamento bom",
    "sai desta conversa com decisões justificadas, não com o ano anterior copiado.",
    "",
    "O orçado da categoria é a SOMA de VÁRIAS DESPESAS independentes.",
    "",
    `Empresa: ${opts.companyName}`,
    escopo,
    `Categoria: ${categoryName} (linha da DRE: ${opts.dreLineCode} — ${opts.dreLineName})`,
    `Ano do orçamento: ${year}`,
    `Realizado de ${anoAnterior} nesta categoria:`,
    realizadoContexto(opts.realizado),
    "",
    ...principios,
    ...blocoClasse,
    ...blocoContexto,
    ...blocoRegra,
    ...blocoGrupos,
    ...(semBase
      ? []
      : [
          `BASE — o que o setor pagou em ${anoAnterior} (cadastrado pela administração; é PONTO DE`,
          "PARTIDA, não teto nem piso). Não invente itens fora desta lista:",
          listaBase(opts.base),
          "",
        ]),
    ...blocoRegistradas,
    ...(opts.modo === "fechamento" ? [] : reflexao),
    ...(opts.modo === "fechamento"
      ? []
      : ["ROTEIRO:", ...bloco0, ...(semBase ? bloco1SemBase : bloco1ComBase), ...bloco2, ...bloco3]),
    ...(opts.modo === "entrevista" ? tailEntrevista : tailFechamento),
  ].join("\n");
}
