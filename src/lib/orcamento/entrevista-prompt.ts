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

import { formatBRL } from "@/lib/orcamento/format";
import type { MediaRealizado } from "@/lib/orcamento/media-realizado";
import { periodicidadeLabel, totalItem, type Periodicidade } from "@/lib/orcamento/planejamento-calc";

/** Item da base como o prompt o recebe (o que o cliente manda como contexto vivo). */
export interface EntrevistaItem {
  descricao: string;
  valorMensal: number;
  periodicidade: Periodicidade;
  mesInicio: number;
  mesFim: number | null;
}

const MESES_NOME = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];
const MESES_CURTO = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function normNome(name: string): string {
  return (name ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
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

export function materialidade(itens: EntrevistaItem[]): ItemMaterialidade[] {
  const totais = itens.map((i) => totalItem(i.valorMensal, i.mesInicio, i.periodicidade, i.mesFim ?? null));
  const total = totais.reduce((a, b) => a + b, 0);
  const ordem = totais.map((t, indice) => ({ indice, t })).sort((a, b) => b.t - a.t);
  const out: ItemMaterialidade[] = [];
  let acumulado = 0;
  for (const { indice, t } of ordem) {
    const peso = total > 0 ? t / total : 0;
    const antes = total > 0 ? acumulado / total : 0;
    const completa =
      itens.length <= ITENS_TODOS_COMPLETOS || antes < PARETO_CORTE || peso >= PESO_MINIMO_COMPLETO;
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

// ─── Lista da base, com peso e profundidade ──────────────────────────────────

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

function linhaItem(i: EntrevistaItem, m: ItemMaterialidade): string {
  const mes = MESES_NOME[Math.min(12, Math.max(1, Math.round(i.mesInicio))) - 1];
  const marca = m.profundidade === "completa" ? "[pacote completo]" : "[conferência rápida]";
  const peso = `${pct(m.peso)} do total`;
  if (i.periodicidade === "anual") {
    return `- ${i.descricao}: ${formatBRL(i.valorMensal)}/ano, pago em ${mes} — ${peso} ${marca}`;
  }
  const fim = i.mesFim != null && i.mesFim >= 1 && i.mesFim <= 12 ? i.mesFim : null;
  const ate = fim != null && fim < 12 ? `, até ${MESES_NOME[fim - 1]} (cancela depois)` : "";
  // Bimestral/trimestral/semestral: diz o intervalo, para a IA não tratar o
  // valor como mensal ao conversar com o gestor.
  const cada =
    i.periodicidade === "mensal" ? "/mês" : `/${periodicidadeLabel(i.periodicidade).replace(/al$/, "e")}`;
  return `- ${i.descricao}: ${formatBRL(i.valorMensal)}${cada}, a partir de ${mes}${ate} — ${peso} ${marca}`;
}

export function listaBase(itens: EntrevistaItem[]): string {
  const m = materialidade(itens);
  return itens.map((i, idx) => linhaItem(i, m[idx])).join("\n");
}

// ─── System prompt ───────────────────────────────────────────────────────────

export interface BuildSystemPromptInput {
  companyName: string;
  categoryName: string;
  dreLineCode: string;
  dreLineName: string;
  year: number;
  realizado: MediaRealizado | undefined;
  /** Itens da base (só os incluídos). Vazio = entrevista aberta. */
  itens: EntrevistaItem[];
  contextoAdmin: string;
  /** true = turno de entrevista via STREAMING (texto corrido + marcador [[FECHAR]]);
   *  false = turno de ENCERRAR (JSON estruturado com a proposta). */
  streaming: boolean;
}

export function buildSystemPrompt(opts: BuildSystemPromptInput): string {
  const { year, categoryName } = opts;
  const anoAnterior = year - 1;
  const semBase = opts.itens.length === 0;
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
    "  própria. A RESPOSTA DO GESTOR SEMPRE PREVALECE sobre valor/mês pré-cadastrado: se ele disser outro",
    "  valor, outro mês, mensal↔anual, ou pedir para incluir/remover, a proposta final TEM de refletir",
    "  isso. Reler TODA a conversa antes de propor é obrigatório.",
    "- NUNCA invente itens fora da lista nem citados pelo gestor.",
    "",
  ];

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
    "BLOCO 1 — UM ITEM POR VEZ, do maior para o menor (a lista acima):",
    "Item marcado [pacote completo] — cubra os 5 pontos, uma pergunta por mensagem, pulando os que o",
    "gestor já respondeu:",
    "  1. PROPÓSITO: para que serve hoje? Que entrega ou processo depende dele? Quem usa?",
    "  2. TESTE DO ZERO: se não existisse, contrataria hoje? O que para se for cancelado amanhã?",
    "  3. ALTERNATIVAS: plano menor, renegociação, troca de fornecedor, fazer internamente,",
    "     consolidar com outra empresa do grupo? (Pergunte; não proponha a alternativa você mesmo.)",
    `  4. DRIVER: em ${year} o valor muda por PREÇO (reajuste) ou por VOLUME (usuários, unidades,`,
    "     eventos)? Ligue à resposta do Bloco 0. Se o mês a mês mostrou pico, pergunte se ele se repete.",
    "  5. DECISÃO: manter / reduzir / aumentar / cancelar — com valor, periodicidade e mês de início.",
    "Item marcado [conferência rápida] — informe valor e mês (em tom de fato) e pergunte, numa frase",
    "só, se mantém e para que serve. Registre qualquer mudança de valor/mês que o gestor der.",
    "Cancelamento no meio do ano (ex.: 'cancelo em julho'): o item continua na proposta como",
    "MENSAL com mesFim = ÚLTIMO mês ainda pago; confirme qual é (cancela em julho → último pago",
    "costuma ser junho → mesFim=6). Não deixe item cancelado com 12 meses cheios.",
    "Item que o gestor NÃO mantém fica FORA da proposta.",
    "",
  ];

  const bloco1SemBase: string[] = [
    "Esta categoria NÃO tem itens pré-cadastrados: o administrador não definiu uma base para você",
    "confirmar item por item — a entrevista é ABERTA e você GUIA o gestor.",
    "O QUE É esta despesa (explique em 1–2 frases para o gestor reconhecer o cenário):",
    descricao ?? `Descreva, em 1–2 frases, o que costuma ser a despesa "${categoryName}".`,
    "",
    "BLOCO 1 — PREVISÃO ABERTA: depois do Bloco 0, explique o que é a despesa e pergunte, de forma",
    `aberta e neutra, qual é a previsão de gasto com "${categoryName}" em ${year}. NÃO pressuponha`,
    "\"contrato\", \"assinatura\", \"contratação\" ou \"investimento\" — muitas dessas despesas são",
    "variáveis. Cada gasto que ele citar é tratado como item NOVO (Bloco 2). Se ele não prevê nada,",
    "tudo bem: não haverá itens.",
    "",
  ];

  const bloco2: string[] = [
    "BLOCO 2 — GASTOS NOVOS: pergunte se há gasto novo previsto nesta categoria (serviço, contrato,",
    "ação ou despesa). Para CADA item novo colete, uma pergunta por vez e sem chutar nada:",
    "  (a) O QUE é o gasto;",
    "  (b) RESULTADO esperado / problema que resolve (é a justificativa);",
    "  (c) PRIORIDADE: essencial (o negócio para sem), importante (piora sem) ou desejável;",
    "  (d) VALOR em reais;",
    "  (e) MENSAL ou ANUAL (ou outra periodicidade) e a partir de QUAL mês;",
    "  (f) ALTERNATIVA considerada, ou por que não dá para adiar.",
    "(a), (b), (d) e (e) são OBRIGATÓRIOS: faltando qualquer um, peça SOMENTE o que falta antes de",
    "seguir. Depois de fechar um item, pergunte se há outro.",
    "",
  ];

  const bloco3: string[] = [
    "BLOCO 3 — FECHAMENTO COM DESAFIO (antes de encerrar, sempre):",
    `1. Resuma em poucas linhas: total proposto para ${year} versus o realizado de ${anoAnterior}`,
    "   (com a variação em %), o que foi cortado/reduzido/renegociado, o que é novo e com que prioridade.",
    "2. Faça UMA pergunta de desafio, a que mais se aplica ao caso — por exemplo: a proposta cresce",
    "   sem o negócio crescer, o que justifica? Nada foi cortado: nenhum item merece revisão? O maior",
    "   item foi mantido sem alternativa avaliada, vale uma cotação? Um item novo \"essencial\" sem",
    "   resultado claro, o que muda se ele não entrar?",
    "3. Se o gestor mudar algo, registre. Só então escreva a mensagem final.",
    "",
  ];

  const tailStream: string[] = [
    "Durante a entrevista você só faz a PRÓXIMA pergunta (uma por mensagem). Responda em português",
    "do Brasil, em TEXTO CORRIDO — SEM JSON e sem blocos de código. Escreva APENAS a sua mensagem",
    "ao gestor.",
    "",
    "SINAL DE FIM: quando NÃO houver mais NADA a perguntar — todos os itens da base decididos, todo",
    "item NOVO com os dados obrigatórios, o gestor já disse que não há mais gastos novos E o Bloco 3",
    "já foi feito — escreva a mensagem final avisando que terminou (ex.: \"Terminei as perguntas.",
    "Clique em 'Concluir entrevista e gerar proposta' para eu montar a proposta.\") e, SOMENTE nesse",
    "caso, acrescente no FIM uma última linha isolada com EXATAMENTE: [[FECHAR]]",
    "NUNCA escreva [[FECHAR]] enquanto ainda houver qualquer pergunta pendente. NÃO comente o",
    "marcador com o gestor — ele é só um sinal interno. (Se o gestor não previu NENHUM item, ainda",
    "assim finalize, explique que não há despesa prevista e escreva [[FECHAR]].)",
  ];

  const tailJson: string[] = [
    "MONTAR A PROPOSTA: você recebeu a instrução de ENCERRAR a entrevista.",
    "Devolva a LISTA COMPLETA de itens: cada item mantido (com o valor/mês que o gestor CONFIRMOU —",
    "já atualizado se ele mudou), MAIS cada item NOVO, EXCLUINDO os que ele disse não manter. Confira",
    "item por item contra a conversa: nenhuma alteração pode faltar. Cada item:",
    "  - descricao: nome da plataforma/serviço/gasto;",
    "  - valorMensal: o VALOR em reais de CADA pagamento — mensal na periodicidade 'mensal', do",
    "    bimestre na 'bimestral', do trimestre na 'trimestral', do semestre na 'semestral' e o valor",
    "    anual na 'anual';",
    "  - mesInicio: mês (1..12) do PRIMEIRO pagamento (na 'anual', o mês da renovação);",
    "  - mesFim: mês (1..12) do ÚLTIMO pagamento, quando o item será cancelado no meio do ano; use",
    "    null (ou omita) quando vai até dezembro; ignorado se 'anual';",
    "  - periodicidade: 'mensal', 'bimestral', 'trimestral', 'semestral' ou 'anual';",
    "  - origem: 'mantido' (já pago no ano anterior) ou 'novo'.",
    "E a JUSTIFICATIVA (4 a 8 frases, é o que a diretoria lê na validação): o contexto do ano que o",
    "gestor deu; para cada item relevante, o propósito e a decisão (mantido/reduzido/aumentado/",
    "cancelado e por quê); os itens novos com prioridade e resultado esperado; a variação do total",
    `frente a ${anoAnterior} e o que a explica. Sem floreio: o que foi dito na conversa.`,
    "Se ainda faltar um dado OBRIGATÓRIO de item novo, NÃO proponha: 'proposta' null, 'podeFechar'",
    "false e o 'reply' pedindo só o que falta.",
    "",
    "CATEGORIA ZERADA: se NÃO houver nenhum item (nada mantido e nada novo), a proposta MESMO ASSIM",
    "deve ser montada com a LISTA VAZIA:",
    "'proposta': { \"itens\": [], \"justificativa\": \"...explique que não há despesa prevista...\" }",
    "e 'podeFechar': true. NUNCA devolva 'proposta': null nesse caso.",
    "",
    "Responda SEMPRE com um ÚNICO objeto JSON, sem nenhum texto fora dele.",
    'Se ainda faltar dado obrigatório: { "reply": "pergunta do que falta", "proposta": null, "podeFechar": false }',
    'Categoria zerada: { "reply": "texto curto", "podeFechar": true, "proposta": { "itens": [], "justificativa": "..." } }',
    "Ao montar a proposta, preencha:",
    '{ "reply": "texto curto", "podeFechar": true, "proposta": { "itens": [ { "descricao": "...", "valorMensal": 0, "mesInicio": 1, "mesFim": null, "periodicidade": "mensal", "origem": "mantido" } ], "justificativa": "..." } }',
  ];

  return [
    "Você conduz, para o Grupo Viva, a ENTREVISTA DE ORÇAMENTO BASE ZERO de UMA categoria de",
    'despesa, pelo método "Planejamento dos gestores". Seu papel é o de um controller experiente:',
    "fazer o gestor PENSAR sobre cada gasto, não apenas confirmar o que já existe. Um orçamento bom",
    "sai desta conversa com decisões justificadas, não com o ano anterior copiado.",
    "",
    "O orçado da categoria é a SOMA de VÁRIOS ITENS independentes (cada serviço/gasto é um item).",
    "",
    `Empresa: ${opts.companyName}`,
    `Categoria: ${categoryName} (linha da DRE: ${opts.dreLineCode} — ${opts.dreLineName})`,
    `Ano do orçamento: ${year}`,
    `Realizado de ${anoAnterior} nesta categoria:`,
    realizadoContexto(opts.realizado),
    "",
    ...principios,
    ...blocoClasse,
    ...blocoContexto,
    ...blocoRegra,
    ...(semBase
      ? []
      : [
          "ITENS DA BASE (cadastrados pela administração; valor e mês são o PONTO DE PARTIDA, não um",
          "teto nem um piso). Não invente itens MANTIDOS fora desta lista; o gestor pode alterar",
          "qualquer valor/mês e adicionar itens novos:",
          listaBase(opts.itens),
          "",
        ]),
    "ROTEIRO:",
    ...bloco0,
    ...(semBase ? bloco1SemBase : bloco1ComBase),
    ...bloco2,
    ...bloco3,
    ...(opts.streaming ? tailStream : tailJson),
  ].join("\n");
}
