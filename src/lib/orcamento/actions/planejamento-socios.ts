"use server";

import { revalidatePath } from "next/cache";
import { generateText, type ModelMessage } from "ai";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { getOrcamentoAdmin } from "@/lib/orcamento/auth";
import { isSchemaMissing } from "@/lib/orcamento/errors";
import { isValidBudgetYear } from "@/lib/orcamento/years";
import { getCategoriaMetodo } from "@/lib/orcamento/actions/categoria-metodo";
import {
  fetchRealizados,
  mesesFechados,
  resumirRealizado,
  REALIZADO_VAZIO,
  type MediaRealizado,
} from "@/lib/orcamento/media-realizado";
import { formatBRL } from "@/lib/orcamento/format";
import { resolveAiProvider, logResolvedUsage } from "@/lib/ai/provider";
import {
  categoriaTotal,
  type Periodicidade,
  type PlanejamentoItem,
  type PlanejamentoItemProposto,
  type PlanejamentoMensagem,
  type PlanejamentoProposta,
  type PlanejamentoRealizadoItem,
} from "@/lib/orcamento/planejamento-calc";

const PATH = "/orcamento";

// ─── Tipos de retorno ──────────────────────────────────────────────────────────

export interface PlanejamentoListItem {
  categoryCode: string;
  categoryName: string;
  dreLineCode: string;
  dreLineName: string;
  /** Etapa 1 (base) finalizada pelo admin. */
  baseSalva: boolean;
  /** Existe proposta da entrevista (Etapa 3). */
  temProposta: boolean;
  /** Proposta confirmada (congelada, vai para a Prévia). */
  propostaConfirmada: boolean;
  itemCount: number;
  /** Total da PROPOSTA (0 se ainda não há proposta). */
  totalOrcado: number;
  realizadoAnterior: { total: number; media: number | null } | null;
}

export interface PlanejamentoCategoriaDetalhe {
  categoryCode: string;
  categoryName: string;
  dreLineCode: string;
  dreLineName: string;
  /** ETAPA 1 — itens da BASE (o que a IA considera). */
  itens: PlanejamentoItem[];
  /** Etapa 1 finalizada (habilita a entrevista). */
  baseSalva: boolean;
  /** ETAPA 1 — contexto livre que o admin escreve para orientar a IA. */
  contextoAdmin: string;
  /** ETAPA 2 — transcript da entrevista. */
  conversa: PlanejamentoMensagem[];
  /** ETAPA 3 — proposta final vinda da entrevista (null enquanto não existe). */
  proposta: PlanejamentoProposta | null;
  /** Proposta confirmada pelo gestor (congelada). */
  propostaConfirmada: boolean;
  realizadoAnterior: { total: number; media: number | null } | null;
  /** Pagamentos do ano anterior por fornecedor (para semear/mostrar a referência). */
  realizadoItens: PlanejamentoRealizadoItem[];
}

/** Item enxuto que o cliente manda como contexto vivo para a IA. */
export interface PlanejamentoContextoItem {
  descricao: string;
  valorMensal: number;
  periodicidade: Periodicidade;
  mesInicio: number;
  mesFim: number | null;
}

/**
 * Contexto FIXO do prompt (linha da DRE + realizado do ano anterior) que o
 * cliente já tem em `detalhe` e NÃO muda durante a conversa. Quando enviado,
 * a entrevista pula as duas queries pesadas por turno (catálogo de categorias
 * + realizado da Omie), que só existiam para remontar esta mesma informação.
 */
export interface PlanejamentoPromptContexto {
  dreLineCode: string;
  dreLineName: string;
  realizadoTotal: number;
  realizadoMedia: number | null;
}

interface CategoriaRow {
  category_code: string;
  category_name: string | null;
  justificativa: string | null;
  conversa: unknown;
  status: string | null;
  base_salva: boolean | null;
  contexto_admin: string | null;
  proposta: unknown;
  proposta_confirmada: boolean | null;
}
interface ItemRow {
  id: string;
  category_code: string;
  descricao: string;
  valor_mensal: number | string | null;
  mes_inicio: number | string | null;
  mes_fim: number | string | null;
  periodicidade: string | null;
  origem: string | null;
  fornecedor: string | null;
  incluir: boolean | null;
}

/** Mês opcional (1..12) ou null quando ausente/inválido. */
function optMes(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 && n <= 12 ? Math.round(n) : null;
}

// ─── Helpers puros ─────────────────────────────────────────────────────────────

function sanitizeConversa(raw: unknown): PlanejamentoMensagem[] {
  if (!Array.isArray(raw)) return [];
  const out: PlanejamentoMensagem[] = [];
  raw.forEach((m) => {
    if (m && typeof m === "object") {
      const role = (m as { role?: unknown }).role;
      const content = (m as { content?: unknown }).content;
      if ((role === "user" || role === "assistant") && typeof content === "string") {
        out.push({ role, content });
      }
    }
  });
  return out;
}

function toPeriodicidade(v: unknown): Periodicidade {
  return v === "anual" ? "anual" : "mensal";
}

function rowToItem(r: ItemRow): PlanejamentoItem {
  const valor = Number(r.valor_mensal);
  const mes = Number(r.mes_inicio);
  return {
    id: r.id,
    descricao: r.descricao,
    valorMensal: Number.isFinite(valor) && valor > 0 ? valor : 0,
    mesInicio: Number.isFinite(mes) ? Math.min(12, Math.max(1, Math.round(mes))) : 1,
    mesFim: optMes(r.mes_fim),
    periodicidade: toPeriodicidade(r.periodicidade),
    origem: r.origem === "mantido" ? "mantido" : "novo",
    fornecedor: r.fornecedor ?? null,
    incluir: r.incluir !== false,
  };
}

function sanitizeItensProposta(raw: unknown): PlanejamentoItemProposto[] {
  if (!Array.isArray(raw)) return [];
  const out: PlanejamentoItemProposto[] = [];
  raw.forEach((it) => {
    if (!it || typeof it !== "object") return;
    const o = it as Record<string, unknown>;
    const descricao = String(o.descricao ?? "").trim();
    if (!descricao) return;
    const valor = Number(o.valorMensal ?? o.valor_mensal ?? o.valor ?? 0);
    const mes = Number(o.mesInicio ?? o.mes_inicio ?? 1);
    out.push({
      descricao,
      valorMensal: Number.isFinite(valor) && valor > 0 ? valor : 0,
      mesInicio: Number.isFinite(mes) ? Math.min(12, Math.max(1, Math.round(mes))) : 1,
      mesFim: optMes(o.mesFim ?? o.mes_fim),
      periodicidade: toPeriodicidade(o.periodicidade),
      origem: o.origem === "mantido" ? "mantido" : "novo",
      fornecedor: typeof o.fornecedor === "string" ? o.fornecedor : null,
      incluir: o.incluir !== false,
    });
  });
  return out;
}

/** Lê a proposta persistida (jsonb) da coluna `proposta`. Uma proposta com
 * `itens: []` (categoria ZERADA — ex.: Bônus sem sócio mantido) é VÁLIDA e deve
 * ser retornada (resultado zero), NÃO tratada como "sem proposta". Só devolve
 * null quando a coluna não é uma proposta (null/sem `itens` array). */
function parsePropostaColumn(raw: unknown): PlanejamentoProposta | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as { itens?: unknown; justificativa?: unknown };
  if (!Array.isArray(o.itens)) return null;
  return {
    itens: sanitizeItensProposta(o.itens),
    justificativa: typeof o.justificativa === "string" ? o.justificativa : "",
  };
}

/** Total anual de uma proposta (soma das séries de cada item). */
function propostaTotal(p: PlanejamentoProposta | null): number {
  if (!p) return 0;
  return categoriaTotal(
    p.itens.map((i) => ({
      valorMensal: i.valorMensal,
      mesInicio: i.mesInicio,
      periodicidade: i.periodicidade,
      mesFim: i.mesFim ?? null,
    })),
  );
}

function parseAiReply(text: string): {
  reply: string;
  proposta: PlanejamentoProposta | null;
  podeFechar: boolean;
} {
  let t = (text ?? "").trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) t = t.slice(start, end + 1);

  let obj: unknown;
  try {
    obj = JSON.parse(t);
  } catch {
    return {
      reply: (text ?? "").trim() || "Pode me contar um pouco mais sobre essa despesa?",
      proposta: null,
      podeFechar: false,
    };
  }

  const reply =
    obj && typeof obj === "object" && typeof (obj as { reply?: unknown }).reply === "string"
      ? ((obj as { reply: string }).reply as string)
      : "";

  const rawProposta = obj && typeof obj === "object" ? (obj as { proposta?: unknown }).proposta : null;
  let proposta: PlanejamentoProposta | null = null;
  // A proposta é aceita quando vem um OBJETO com `itens` array — MESMO vazio.
  // itens:[] = categoria ZERADA (ex.: Bônus sem sócio mantido), que é um
  // resultado LEGÍTIMO e precisa fechar a Etapa 3. Só `proposta: null` (ainda
  // perguntando / falta dado) NÃO gera proposta.
  if (rawProposta && typeof rawProposta === "object" && Array.isArray((rawProposta as { itens?: unknown }).itens)) {
    const itens = sanitizeItensProposta((rawProposta as { itens?: unknown }).itens);
    const justificativa = (rawProposta as { justificativa?: unknown }).justificativa;
    proposta = { itens, justificativa: typeof justificativa === "string" ? justificativa : "" };
  }

  const flagFechar =
    typeof obj === "object" && obj !== null && (obj as { podeFechar?: unknown }).podeFechar === true;
  const podeFechar = flagFechar || proposta != null;

  return { reply: reply || "…", proposta, podeFechar };
}

function realizadoMensalContexto(r: MediaRealizado | undefined): string {
  if (!r) return "sem dados do ano anterior.";
  const media = r.media == null ? "n/d" : formatBRL(r.media);
  return `total ${formatBRL(r.total)} · média mensal ${media}`;
}

/** Lista que guia a IA: o que o admin já selecionou (contexto vivo) ou, na
 * falta, todos os fornecedores do ano anterior. */
const MESES_NOME = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

function considerarContexto(
  itensContexto: PlanejamentoContextoItem[],
  realizadoItens: PlanejamentoRealizadoItem[],
): string {
  if (itensContexto.length > 0) {
    return itensContexto
      .map((i) => {
        const mes = MESES_NOME[Math.min(12, Math.max(1, Math.round(i.mesInicio))) - 1];
        if (i.periodicidade === "anual") {
          return `- ${i.descricao}: ${formatBRL(i.valorMensal)}/ano, pago em ${mes}`;
        }
        const fim = i.mesFim != null && i.mesFim >= 1 && i.mesFim <= 12 ? i.mesFim : null;
        const ate = fim != null && fim < 12 ? `, até ${MESES_NOME[fim - 1]} (cancela depois)` : "";
        return `- ${i.descricao}: ${formatBRL(i.valorMensal)}/mês, a partir de ${mes}${ate}`;
      })
      .join("\n");
  }
  if (realizadoItens.length === 0) return "Sem fornecedores do ano anterior.";
  return realizadoItens
    .map(
      (c) =>
        `- ${c.fornecedor}: ${c.media == null ? "n/d" : formatBRL(c.media)}/mês (média dos meses fechados; ` +
        `${c.lancamentos} lançamento(s), total ${formatBRL(c.total)} no ano)`,
    )
    .join("\n");
}

async function resolvePlanejamentoProvider() {
  try {
    return await resolveAiProvider({ forceProvider: "gemini", capability: "text" });
  } catch {
    return await resolveAiProvider({ capability: "text" });
  }
}

/** Descrição do que é a despesa, para orientar o gestor quando NÃO há base.
 * O admin pode ampliar; sem match, a IA descreve a partir do nome.
 * `regra` é uma calibração de vocabulário/condução específica da categoria
 * (aplicada com ou sem base). */
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
      "existir no ano seguinte — é ERRADO perguntar se \"será mantido\", \"continua\" ou tratar " +
      "qualquer sócio como cancelado/removido. Cada item da base é o pró-labore de UM sócio e é " +
      "SEMPRE mantido. CONDUÇÃO CORRETA: para CADA sócio, INFORME o valor atual (em tom de fato) e " +
      "pergunte APENAS qual será o VALOR ATUALIZADO do pró-labore dele para o ano do orçamento — " +
      "pode ser o mesmo valor ou um reajuste. Registre o valor que o gestor informar. Se o gestor " +
      "citar um SÓCIO NOVO, colete nome e valor mensal. O objetivo é fechar o valor mensal " +
      "atualizado de cada sócio; não há item para \"não manter\".",
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

function normNomeDescricao(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function descricaoCategoria(name: string): string | null {
  const n = normNomeDescricao(name);
  return CATEGORIA_DESCRICOES.find((d) => n.includes(d.match))?.descricao ?? null;
}

/** Regra de calibração específica da categoria (vocabulário/condução), se houver. */
function regraCategoria(name: string): string | null {
  const n = normNomeDescricao(name);
  return CATEGORIA_DESCRICOES.find((d) => n.includes(d.match))?.regra ?? null;
}

function buildSystemPrompt(opts: {
  companyName: string;
  categoryName: string;
  dreLineCode: string;
  dreLineName: string;
  year: number;
  realizado: MediaRealizado | undefined;
  considerar: string;
  semBase: boolean;
  descricaoCategoria: string | null;
  regraCategoria: string | null;
  contextoAdmin: string;
  /** true = turno de entrevista via STREAMING (texto corrido + marcador [[FECHAR]]);
   *  false = turno de ENCERRAR (JSON estruturado com a proposta). */
  streaming: boolean;
}): string {
  const { year, categoryName } = opts;

  // Contexto livre que o admin escreveu na Etapa 1 (direcionamento p/ a IA).
  const ctx = opts.contextoAdmin.trim();
  const blocoContexto: string[] = ctx
    ? [
        "CONTEXTO DO ADMINISTRADOR (leia ANTES de tudo e RESPEITE em toda a entrevista):",
        "O administrador que monta o orçamento deixou este direcionamento sobre a categoria.",
        "Interprete-o e conduza as perguntas de forma CONDIZENTE com ele — ele reflete decisões",
        "já tomadas (trocas de fornecedor, contratos que não serão renovados, planos para o ano,",
        "tetos de valor etc.). NÃO o contradiga nem ignore; se ele já responde algo que você",
        "perguntaria, não repita a pergunta — apenas confirme com o gestor. Direcionamento:",
        `"""${ctx}"""`,
        "",
      ]
    : [];

  // Se a categoria tem uma REGRA própria (ex.: pró-labore), a condução dela
  // PREVALECE — pode até trocar o tipo de pergunta ("mantém?" → "qual o valor
  // atualizado?"). A condução padrão abaixo é o caso geral.
  const precedenciaRegra = opts.regraCategoria
    ? "IMPORTANTE: a REGRA DA CATEGORIA logo acima PREVALECE sobre a condução padrão a seguir — " +
      "quando ela definir COMO conduzir (que pergunta fazer), siga a REGRA, não o passo padrão."
    : "";

  // Bloco de CONDUÇÃO — muda conforme haja ou não uma base cadastrada.
  const comBase: string[] = [
    ...(precedenciaRegra ? [precedenciaRegra, ""] : []),
    "Itens JÁ CADASTRADOS pela administração para esta categoria (valor e mês são o",
    "PONTO DE PARTIDA — o padrão, não um teto). NÃO invente itens MANTIDOS fora desta",
    "lista, mas o gestor PODE alterar qualquer valor/mês e PODE adicionar itens novos:",
    opts.considerar,
    "",
    "REGRA DE PRECEDÊNCIA (a mais importante): a RESPOSTA DO GESTOR na conversa SEMPRE",
    "vence o valor/mês pré-cadastrado. Se o gestor disser um valor diferente, um mês",
    "diferente, mensal↔anual, ou pedir para incluir/remover um item, a proposta final",
    "TEM de refletir exatamente isso. NUNCA descarte, esqueça ou 'volte ao padrão' uma",
    "mudança que o gestor declarou — reler TODA a conversa antes de propor é obrigatório.",
    "",
    "Como conduzir a ENTREVISTA (uma pergunta por vez, em português do Brasil):",
    "1. Para CADA item da lista acima, a ÚNICA dúvida é se ele será MANTIDO em",
    `   ${year}. INFORME ao gestor o valor e o mês pré-cadastrados (em tom de`,
    '   FATO, nunca como pergunta) e pergunte apenas: "este item será mantido em ' + year + '?".',
    "   NÃO pergunte o valor nem o mês por padrão. MAS se o gestor, ao responder,",
    "   informar um valor/mês/período diferente (ex.: 'sim, mas mude para R$ 40/mês'),",
    "   REGISTRE o valor NOVO que ele deu e confirme de volta o valor atualizado.",
    "   Se o gestor disser que o item NÃO será mantido, ele fica FORA da proposta.",
    "   Se disser que será CANCELADO no meio do ano (ex.: 'cancelo o SERASA em julho'),",
    "   o item continua na proposta como MENSAL, mas você define o mesFim = ÚLTIMO mês",
    "   que ainda será pago. Confirme com o gestor qual é o último mês pago (ex.: se",
    "   cancela em julho, o último pago costuma ser junho → mesFim=6). Não deixe um item",
    "   cancelado com os 12 meses cheios.",
    "2. Depois pergunte se o gestor prevê algum GASTO NOVO nesta categoria (um novo contrato,",
    "   serviço ou despesa — sem forçar o rótulo de \"contratação\"). Para CADA item novo,",
    "   você OBRIGATORIAMENTE precisa dos 5 dados abaixo antes de aceitá-lo:",
    "   (a) NOME/DESCRIÇÃO do gasto (plataforma, serviço ou ação);",
    "   (b) VALOR em reais;",
    "   (c) se é despesa MENSAL ou ANUAL;",
    "   (d) a partir de QUAL MÊS entra no orçamento;",
    "   (e) a JUSTIFICATIVA (para que serve).",
    "   Se o gestor omitir QUALQUER um desses 5 pontos, NÃO prossiga: repita a pergunta",
    "   pedindo SOMENTE o(s) dado(s) que ainda faltam, listando-os, e só siga quando",
    "   TODOS os 5 estiverem respondidos. Nunca preencha por conta própria nem 'chute'",
    "   valor, mês ou justificativa de um item novo.",
    "3. NUNCA invente itens fora da lista acima nem citados pelo gestor.",
  ];

  const semBase: string[] = [
    ...(precedenciaRegra ? [precedenciaRegra, ""] : []),
    "Esta categoria NÃO tem itens pré-cadastrados: o administrador NÃO definiu uma base de",
    "contratos/assinaturas para você considerar. Portanto NÃO existe lista para confirmar",
    "item por item — a entrevista é ABERTA, e você deve GUIAR o gestor.",
    "",
    "O QUE É esta despesa (explique ao gestor para ele reconhecer o cenário):",
    opts.descricaoCategoria
      ? opts.descricaoCategoria
      : `Descreva, em 1–2 frases, o que costuma ser a despesa "${categoryName}" para orientar o gestor.`,
    "",
    "Como conduzir a ENTREVISTA (uma pergunta por vez, em português do Brasil):",
    "1. ABRA explicando em 1–2 frases o que é esse tipo de despesa (use a descrição acima),",
    `   e então pergunte de forma ABERTA e NEUTRA qual é a PREVISÃO DE GASTOS do gestor com`,
    `   "${categoryName}" em ${year}. NÃO pressuponha que o gasto é um "investimento", uma`,
    `   "contratação", um "contrato" ou uma "assinatura" — muitas dessas despesas são`,
    `   variáveis/sazonais e não têm essa forma. Pergunte pela previsão de gasto, não por uma`,
    `   decisão de contratar/investir (salvo se o próprio gestor descrever a despesa assim).`,
    "2. Se o gestor previr algum gasto (ou já citar algo), trate como ITEM e colete os 4",
    "   dados OBRIGATÓRIOS abaixo, um de cada vez, sem chutar nada:",
    "   (a) O QUE é o gasto (a ação/serviço/despesa — sem forçar o rótulo de \"contratação\");",
    "   (b) VALOR previsto em reais;",
    "   (c) será despesa MENSAL ou ANUAL e a partir de QUAL mês (se for pontual/sazonal, use",
    "       o mês do gasto);",
    "   (d) a JUSTIFICATIVA (para que serve / por que esse gasto).",
    "   Faltando QUALQUER um, peça SOMENTE o que falta e não avance. Pode haver mais de um",
    "   item — depois de fechar um, pergunte se há outro.",
    "3. Se o gestor disser que NÃO pretende nada nesta categoria, tudo bem: não haverá itens.",
    "4. NUNCA invente itens que o gestor não citou.",
  ];

  // RABO do prompt — muda conforme o turno:
  //  - streaming (entrevista): texto corrido + marcador [[FECHAR]] para sinalizar fim.
  //  - json (encerrar): objeto JSON com a proposta estruturada.
  const tailStream: string[] = [
    "Durante a entrevista você só faz a PRÓXIMA pergunta (uma por vez). Responda em português",
    "do Brasil, em TEXTO CORRIDO — SEM JSON e sem blocos de código. Escreva APENAS a sua",
    "mensagem ao gestor.",
    "",
    "SINAL DE FIM: quando NÃO houver mais NADA a perguntar — todos os itens da base",
    "confirmados/alterados/cancelados/não-mantidos, todo item NOVO com os dados obrigatórios",
    "completos, e o gestor já indicou que não há mais contratações — escreva a mensagem final",
    "avisando que terminou (ex.: \"Terminei as perguntas. Clique em 'Concluir entrevista e",
    "gerar proposta' para eu montar a proposta.\") e, SOMENTE nesse caso, acrescente no FIM",
    "uma última linha isolada com EXATAMENTE: [[FECHAR]]",
    "NUNCA escreva [[FECHAR]] enquanto ainda houver qualquer pergunta pendente. NÃO comente o",
    "marcador com o gestor — ele é só um sinal interno. (Se o gestor não previu NENHUM item,",
    "ainda assim finalize, explique que não há despesa prevista e escreva [[FECHAR]].)",
  ];

  const tailJson: string[] = [
    "MONTAR A PROPOSTA: você recebeu a instrução de ENCERRAR a entrevista.",
    "Devolva a LISTA COMPLETA de itens: cada item mantido (com o valor/mês que o gestor",
    "CONFIRMOU — já atualizado se ele mudou), MAIS cada item NOVO pedido, EXCLUINDO os que",
    "ele disse não manter. Confira item por item contra a conversa: nenhuma alteração pode",
    "faltar. Cada item:",
    "  - descricao: nome da plataforma/serviço;",
    "  - valorMensal: o VALOR em reais — mensal quando periodicidade='mensal', ou o valor",
    "    ANUAL quando periodicidade='anual';",
    "  - mesInicio: mês (1..12) — início da recorrência (mensal) OU mês da renovação (anual);",
    "  - mesFim: mês (1..12) do ÚLTIMO pagamento quando o item é MENSAL e será cancelado",
    "    no meio do ano; use null (ou omita) quando vai até dezembro; ignorado se anual;",
    "  - periodicidade: 'mensal' ou 'anual';",
    "  - origem: 'mantido' (já pago no ano anterior) ou 'novo'.",
    "E uma justificativa curta (2 a 4 frases) com as premissas. Se ainda faltar um dado",
    "OBRIGATÓRIO de item novo, NÃO proponha: 'proposta' null, 'podeFechar' false e o 'reply'",
    "pedindo só o que falta.",
    "",
    "CATEGORIA ZERADA: se NÃO houver nenhum item (nada mantido e nada novo — ex.: nenhum",
    "sócio manteve o bônus), a proposta MESMO ASSIM deve ser montada com a LISTA VAZIA:",
    "'proposta': { \"itens\": [], \"justificativa\": \"...explique que não há despesa prevista...\" }",
    "e 'podeFechar': true. NUNCA devolva 'proposta': null nesse caso — itens:[] é o resultado",
    "correto (orçamento zero para a categoria) e precisa fechar a etapa.",
    "",
    "Responda SEMPRE com um ÚNICO objeto JSON, sem nenhum texto fora dele.",
    'Se ainda faltar dado obrigatório: { "reply": "pergunta do que falta", "proposta": null, "podeFechar": false }',
    'Categoria zerada: { "reply": "texto curto", "podeFechar": true, "proposta": { "itens": [], "justificativa": "..." } }',
    "Ao montar a proposta, preencha:",
    '{ "reply": "texto curto", "podeFechar": true, "proposta": { "itens": [ { "descricao": "...", "valorMensal": 0, "mesInicio": 1, "mesFim": null, "periodicidade": "mensal", "origem": "mantido" } ], "justificativa": "..." } }',
  ];

  return [
    'Você ajuda o gestor financeiro do Grupo Viva a montar o ORÇAMENTO ANUAL de UMA',
    'categoria de despesa pelo método "Planejamento dos sócios".',
    "",
    "IMPORTANTE: o orçado da categoria é a SOMA de VÁRIOS ITENS independentes (cada",
    "contratação/serviço é um item próprio).",
    "",
    `Empresa: ${opts.companyName}`,
    `Categoria: ${categoryName} (linha da DRE: ${opts.dreLineCode} — ${opts.dreLineName})`,
    `Ano do orçamento: ${year}`,
    `Realizado do ano anterior (${year - 1}) nesta categoria: ${realizadoMensalContexto(opts.realizado)}`,
    "",
    `ABERTURA (regra fixa): a sua PRIMEIRA mensagem deve SEMPRE começar informando ao gestor o`,
    `TOTAL gasto nesta categoria no ano anterior (${year - 1}) — o valor "total" acima (mesmo`,
    `sem base cadastrada; se não houver dado, diga que não houve gasto registrado). Só DEPOIS`,
    `siga a condução abaixo.`,
    "",
    "INTERPRETE A CATEGORIA ANTES DE PERGUNTAR (regra permanente, vale para QUALQUER",
    `categoria): entenda a ESSÊNCIA do que é "${categoryName}" — pela natureza da despesa`,
    `e pela linha da DRE (${opts.dreLineCode} — ${opts.dreLineName}) — e avalie se cada`,
    "pergunta é PERTINENTE a esse tipo de despesa. Nem toda categoria aceita as mesmas",
    "perguntas. Há despesas ESTRUTURAIS/obrigatórias que continuam por natureza (ex.:",
    "salário dos sócios, impostos, aluguel, contas de consumo): para essas NÃO faz sentido",
    "perguntar se 'serão mantidas' — elas não deixam de existir; o que importa é o VALOR",
    "ATUALIZADO para o próximo ano. Há despesas OPCIONAIS/discricionárias (ex.: assinaturas,",
    "consultorias, treinamentos): para essas cabe perguntar se serão mantidas e se há algo",
    "novo. Há ainda despesas VARIÁVEIS/SAZONAIS que NÃO têm forma de contrato, assinatura,",
    "contratação nem investimento (ex.: captação de clientes, marketing, ações e campanhas",
    "pontuais): para essas NÃO enquadre o gasto como \"investimento\", \"contratação\",",
    "\"contrato\" ou \"assinatura\" por padrão — esse vocabulário sugere um compromisso firmado",
    "que muitas vezes não existe e confunde o gestor. Pergunte de forma ABERTA e NEUTRA qual é",
    "a PREVISÃO DE GASTOS na categoria (\"quanto pretende gastar\", \"qual a previsão de gasto\"),",
    "e só use \"contratar\"/\"assinar\" quando o próprio gestor descrever a despesa assim.",
    "Ajuste as perguntas ao que faz sentido para ESTA categoria e NÃO faça perguntas",
    "que soariam absurdas ao gestor dado o que a despesa é. (Se houver uma REGRA DA",
    "CATEGORIA logo abaixo, ela já traz essa interpretação pronta — siga-a.)",
    "",
    ...blocoContexto,
    ...(opts.regraCategoria ? [opts.regraCategoria, ""] : []),
    ...(opts.semBase ? semBase : comBase),
    "",
    ...(opts.streaming ? tailStream : tailJson),
  ].join("\n");
}

async function fetchRealizadoItens(
  supabase: Awaited<ReturnType<typeof createClient>>,
  companyId: string,
  baseYear: number,
  categoryCode: string,
): Promise<PlanejamentoRealizadoItem[]> {
  const fechados = mesesFechados(baseYear);
  const { data, error } = await supabase.rpc("orcamento_planejamento_realizado_itens", {
    p_company_id: companyId,
    p_base_year: baseYear,
    p_category_code: categoryCode,
    p_meses_fechados: fechados,
  });
  if (error) return [];
  return ((data ?? []) as Array<{
    fornecedor: string;
    total: number | string;
    total_fechado: number | string | null;
    lancamentos: number | string;
  }>).map((r) => {
    const total = Number(r.total) || 0;
    const totalFechado = Number(r.total_fechado) || 0;
    return {
      fornecedor: String(r.fornecedor),
      total,
      media: fechados > 0 && totalFechado > 0 ? totalFechado / fechados : null,
      lancamentos: Number(r.lancamentos) || 0,
    };
  });
}

// ─── Categorias IRMÃS (a divisão "(*)" é interna à contabilidade) ────────────────
// Ex.: "Manutenção de Imobilizado" e "Manutenção de Imobilizado (*)" são duas
// categorias Omie (dois códigos) com o MESMO nome a menos do sufixo " (*)". Para
// o gestor, o realizado do ano anterior é o TOTAL das duas. Só o realizado que a
// IA mostra agrega os irmãos — o mapeamento/DRE/Prévia continuam por código.

/** Nome sem o sufixo " (*)" (e sem acento/caixa), para casar irmãos. */
function normNomeCategoria(s: string): string {
  return s
    .replace(/\s*\(\*\)\s*$/i, "")
    .trim()
    .toLocaleLowerCase("pt-BR");
}

/** A categoria é a "gêmea (*)" (subdivisão contábil interna), não a canônica? */
function ehCategoriaEstrela(name: string): boolean {
  return /\(\*\)\s*$/.test((name ?? "").trim());
}

/** Códigos de todas as categorias irmãs (mesmo nome-base), incluindo a própria. */
function codigosIrmaos(
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
 * TOTAL gasto no ano inteiro (todos os meses com dado, não só os fechados)
 * somando os códigos irmãos. É o "total gasto no ano anterior" que o gestor
 * espera — diferente do total de MESES FECHADOS usado pela Média. `abs` porque
 * despesa pode vir com sinal negativo em financial_entries.
 */
function totalGastoAno(map: Map<string, MediaRealizado>, codes: string[]): number {
  let soma = 0;
  for (const code of codes) {
    const r = map.get(code);
    if (!r) continue;
    for (let i = 0; i < 12; i += 1) soma += r.meses[i] ?? 0;
  }
  return Math.round(Math.abs(soma) * 100) / 100;
}

/** Soma o realizado (mês a mês) de vários códigos num único MediaRealizado. */
function combinarRealizados(
  map: Map<string, MediaRealizado>,
  codes: string[],
  baseYear: number,
): MediaRealizado {
  const meses = Array<number | null>(12).fill(null);
  let algum = false;
  for (const code of codes) {
    const r = map.get(code);
    if (!r) continue;
    algum = true;
    for (let i = 0; i < 12; i += 1) {
      const v = r.meses[i];
      if (v != null) meses[i] = (meses[i] ?? 0) + v;
    }
  }
  if (!algum) return REALIZADO_VAZIO;
  return resumirRealizado(meses, mesesFechados(baseYear));
}

/** Fornecedores do ano anterior somando TODOS os códigos irmãos (merge por nome). */
async function fetchRealizadoItensIrmaos(
  supabase: Awaited<ReturnType<typeof createClient>>,
  companyId: string,
  baseYear: number,
  codes: string[],
): Promise<PlanejamentoRealizadoItem[]> {
  const listas = await Promise.all(codes.map((c) => fetchRealizadoItens(supabase, companyId, baseYear, c)));
  const byForn = new Map<string, PlanejamentoRealizadoItem>();
  for (const lista of listas) {
    for (const it of lista) {
      const key = it.fornecedor.toLocaleLowerCase("pt-BR");
      const cur = byForn.get(key);
      if (!cur) {
        byForn.set(key, { ...it });
      } else {
        cur.total += it.total;
        cur.lancamentos += it.lancamentos;
        if (it.media != null) cur.media = (cur.media ?? 0) + it.media;
      }
    }
  }
  return Array.from(byForn.values()).sort((a, b) => b.total - a.total);
}

// ─── Leitura: lista (landing) ───────────────────────────────────────────────────

export async function getPlanejamentoSocios(
  companyId: string,
  year: number,
): Promise<{ items?: PlanejamentoListItem[]; error?: string; needsMigration?: boolean }> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!companyId) return { items: [] };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const cats = await getCategoriaMetodo(companyId, year);
  if (cats.needsMigration) return { needsMigration: true };
  if (cats.error) return { error: cats.error };
  const doMetodoTodos = (cats.items ?? []).filter((c) => c.metodo === "planejamento_socios");
  // Salvaguarda: a regra é marcar só a categoria canônica (sem "(*)"); o gasto da
  // gêmea "(*)" já é somado no card dela (codigosIrmaos). Se por engano a "(*)"
  // também foi marcada com o método E a canônica está presente, NÃO gera um card
  // duplicado para a "(*)" — evitaria dupla contagem no total/progresso. Se só a
  // "(*)" tiver o método (sem a canônica), o card dela é mantido.
  const basesCanonicas = new Set(
    doMetodoTodos.filter((c) => !ehCategoriaEstrela(c.categoryName)).map((c) => normNomeCategoria(c.categoryName)),
  );
  const doMetodo = doMetodoTodos.filter(
    (c) => !(ehCategoriaEstrela(c.categoryName) && basesCanonicas.has(normNomeCategoria(c.categoryName))),
  );

  const supabase = createAdminClientIfAvailable() ?? (await createClient());

  const { data: catRows, error: catErr } = await supabase
    .from("orcamento_planejamento_socios")
    .select("category_code, base_salva, proposta, proposta_confirmada")
    .eq("company_id", companyId)
    .eq("year", year);
  if (catErr) {
    if (isSchemaMissing(catErr.message)) return { needsMigration: true };
    return { error: catErr.message };
  }
  const byCode = new Map<string, { baseSalva: boolean; proposta: PlanejamentoProposta | null; confirmada: boolean }>();
  ((catRows ?? []) as {
    category_code: string;
    base_salva: boolean | null;
    proposta: unknown;
    proposta_confirmada: boolean | null;
  }[]).forEach((r) =>
    byCode.set(r.category_code, {
      baseSalva: r.base_salva === true,
      proposta: parsePropostaColumn(r.proposta),
      confirmada: r.proposta_confirmada === true,
    }),
  );

  // Realizado por categoria já somando as irmãs "(*)" — busca a UNIÃO dos códigos
  // irmãos de todas as categorias do método e combina por categoria.
  const irmaosPorCat = new Map<string, string[]>();
  const todosCodigos = new Set<string>();
  doMetodo.forEach((c) => {
    const irmaos = codigosIrmaos(cats.items ?? [], c.categoryCode, c.categoryName);
    irmaosPorCat.set(c.categoryCode, irmaos);
    irmaos.forEach((code) => todosCodigos.add(code));
  });
  const realizados = await fetchRealizados(supabase, companyId, year - 1, Array.from(todosCodigos));

  const items: PlanejamentoListItem[] = doMetodo.map((c) => {
    const st = byCode.get(c.categoryCode);
    const codigos = irmaosPorCat.get(c.categoryCode) ?? [c.categoryCode];
    const r = combinarRealizados(realizados, codigos, year - 1);
    const totalAno = totalGastoAno(realizados, codigos);
    return {
      categoryCode: c.categoryCode,
      categoryName: c.categoryName,
      dreLineCode: c.dreLineCode,
      dreLineName: c.dreLineName,
      baseSalva: st?.baseSalva ?? false,
      temProposta: !!st?.proposta,
      propostaConfirmada: st?.confirmada ?? false,
      itemCount: st?.proposta?.itens.length ?? 0,
      totalOrcado: propostaTotal(st?.proposta ?? null),
      realizadoAnterior: totalAno > 0 || r.media != null ? { total: totalAno, media: r.media } : null,
    };
  });

  return { items };
}

// ─── Leitura: detalhe de uma categoria ──────────────────────────────────────────

export async function getPlanejamentoCategoria(
  companyId: string,
  year: number,
  categoryCode: string,
): Promise<{ detalhe?: PlanejamentoCategoriaDetalhe; error?: string; needsMigration?: boolean }> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!companyId || !categoryCode) return { error: "Categoria inválida." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const cats = await getCategoriaMetodo(companyId, year);
  if (cats.needsMigration) return { needsMigration: true };
  if (cats.error) return { error: cats.error };
  const cat = (cats.items ?? []).find((c) => c.categoryCode === categoryCode);
  if (!cat) return { error: "Categoria não encontrada para este método." };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());

  const { data: catRow, error: catErr } = await supabase
    .from("orcamento_planejamento_socios")
    .select(
      "category_code, category_name, justificativa, conversa, status, base_salva, contexto_admin, proposta, proposta_confirmada",
    )
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("category_code", categoryCode)
    .maybeSingle<CategoriaRow>();
  if (catErr) {
    if (isSchemaMissing(catErr.message)) return { needsMigration: true };
    return { error: catErr.message };
  }

  const { data: itemRows, error: itemErr } = await supabase
    .from("orcamento_planejamento_socios_itens")
    .select("id, category_code, descricao, valor_mensal, mes_inicio, mes_fim, periodicidade, origem, fornecedor, incluir")
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("category_code", categoryCode)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (itemErr) {
    if (isSchemaMissing(itemErr.message)) return { needsMigration: true };
    return { error: itemErr.message };
  }

  // Realizado do ano anterior somando a categoria + suas irmãs "(*)" (divisão
  // interna da contabilidade) — total e fornecedores completos.
  const irmaos = codigosIrmaos(cats.items ?? [], categoryCode, cat.categoryName);
  const [realizados, realizadoItens] = await Promise.all([
    fetchRealizados(supabase, companyId, year - 1, irmaos),
    fetchRealizadoItensIrmaos(supabase, companyId, year - 1, irmaos),
  ]);
  const r = combinarRealizados(realizados, irmaos, year - 1);
  const totalAno = totalGastoAno(realizados, irmaos); // ano inteiro, não só meses fechados

  return {
    detalhe: {
      categoryCode,
      categoryName: cat.categoryName,
      dreLineCode: cat.dreLineCode,
      dreLineName: cat.dreLineName,
      itens: ((itemRows ?? []) as ItemRow[]).map(rowToItem),
      baseSalva: catRow?.base_salva === true,
      contextoAdmin: catRow?.contexto_admin ?? "",
      conversa: sanitizeConversa(catRow?.conversa),
      proposta: parsePropostaColumn(catRow?.proposta),
      propostaConfirmada: catRow?.proposta_confirmada === true,
      realizadoAnterior: totalAno > 0 || r.media != null ? { total: totalAno, media: r.media } : null,
      realizadoItens,
    },
  };
}

// ─── Entrevista (chat) ─────────────────────────────────────────────────────────

/**
 * Preparo COMPARTILHADO do turno de entrevista: monta o system prompt + o
 * histórico, resolvendo o contexto (linha DRE + realizado ano-1) pelo FAST PATH
 * (cliente manda `promptCtx`) ou pelo fallback server-side. `streaming` escolhe
 * o rabo do prompt (texto+marcador vs JSON). Usado pelo encerramento (JSON) e
 * pela rota de streaming.
 */
async function montarSistemaEntrevista(params: {
  companyId: string;
  year: number;
  categoryCode: string;
  categoryName: string;
  conversaAtual: PlanejamentoMensagem[];
  itensContexto: PlanejamentoContextoItem[];
  promptCtx?: PlanejamentoPromptContexto;
  streaming: boolean;
}): Promise<
  | { system: string; historico: PlanejamentoMensagem[]; semBase: boolean }
  | { needsMigration: true }
  | { error: string }
> {
  const { companyId, year, categoryCode, categoryName, promptCtx, streaming } = params;
  const supabase = createAdminClientIfAvailable() ?? (await createClient());

  const contexto = (params.itensContexto ?? []).filter((i) => i.descricao.trim() !== "");
  // BASE VAZIA = admin validou a categoria sem itens → entrevista ABERTA.
  const semBase = contexto.length === 0;

  const ctxQuery = supabase
    .from("orcamento_planejamento_socios")
    .select("contexto_admin")
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("category_code", categoryCode)
    .maybeSingle<{ contexto_admin: string | null }>();
  const companyQuery = supabase
    .from("companies")
    .select("name")
    .eq("id", companyId)
    .maybeSingle<{ name: string }>();

  let companyName: string;
  let nomeCategoria: string;
  let dreLineCode: string;
  let dreLineName: string;
  let realizadoCat: MediaRealizado;
  let contextoAdmin: string;

  // FAST PATH — o cliente já mandou a linha da DRE + o realizado do ano anterior
  // (constantes na conversa). Pulamos o catálogo de categorias e o realizado da
  // Omie, que antes rodavam a CADA mensagem só para remontar a mesma informação.
  if (promptCtx && Number.isFinite(promptCtx.realizadoTotal)) {
    const [companyRes, ctxRes] = await Promise.all([companyQuery, ctxQuery]);
    companyName = companyRes.data?.name ?? "Empresa";
    nomeCategoria = categoryName;
    dreLineCode = promptCtx.dreLineCode;
    dreLineName = promptCtx.dreLineName;
    realizadoCat = { ...REALIZADO_VAZIO, total: promptCtx.realizadoTotal, media: promptCtx.realizadoMedia };
    contextoAdmin = (ctxRes.data?.contexto_admin ?? "").trim();
  } else {
    // FALLBACK — computa tudo no servidor (catálogo + realizado da Omie).
    const [companyRes, cats, ctxRes] = await Promise.all([companyQuery, getCategoriaMetodo(companyId, year), ctxQuery]);
    companyName = companyRes.data?.name ?? "Empresa";
    const cat = (cats.items ?? []).find((c) => c.categoryCode === categoryCode);
    nomeCategoria = cat?.categoryName ?? categoryName;
    dreLineCode = cat?.dreLineCode ?? "";
    dreLineName = cat?.dreLineName ?? "";
    contextoAdmin = (ctxRes.data?.contexto_admin ?? "").trim();
    const irmaos = codigosIrmaos(cats.items ?? [], categoryCode, nomeCategoria);
    const realizados = await fetchRealizados(supabase, companyId, year - 1, irmaos);
    realizadoCat = { ...combinarRealizados(realizados, irmaos, year - 1), total: totalGastoAno(realizados, irmaos) };
  }

  const system = buildSystemPrompt({
    companyName,
    categoryName: nomeCategoria,
    dreLineCode,
    dreLineName,
    year,
    realizado: realizadoCat,
    considerar: semBase ? "" : considerarContexto(contexto, []),
    semBase,
    descricaoCategoria: descricaoCategoria(nomeCategoria),
    regraCategoria: regraCategoria(nomeCategoria),
    contextoAdmin,
    streaming,
  });

  return { system, historico: sanitizeConversa(params.conversaAtual), semBase };
}

export async function enviarMensagemPlanejamento(
  companyId: string,
  year: number,
  categoryCode: string,
  categoryName: string,
  conversaAtual: PlanejamentoMensagem[],
  textoUsuario: string,
  itensContexto: PlanejamentoContextoItem[] = [],
  finalizar = false,
  promptCtx?: PlanejamentoPromptContexto,
): Promise<{
  reply?: string;
  proposta?: PlanejamentoProposta | null;
  podeFechar?: boolean;
  conversa?: PlanejamentoMensagem[];
  error?: string;
  needsMigration?: boolean;
}> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!companyId || !categoryCode) return { error: "Categoria inválida." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  // Provedor resolve em paralelo com o preparo do prompt (não depende dele).
  const resolvedPromise = resolvePlanejamentoProvider();

  // Este caminho é o de ENCERRAR (finalizar=true), que produz a proposta em JSON.
  const prep = await montarSistemaEntrevista({
    companyId,
    year,
    categoryCode,
    categoryName,
    conversaAtual,
    itensContexto,
    promptCtx,
    streaming: false,
  });
  if ("needsMigration" in prep) return { needsMigration: true };
  if ("error" in prep) return { error: prep.error };
  const { system, historico } = prep;
  const texto = (textoUsuario ?? "").trim();
  const supabase = createAdminClientIfAvailable() ?? (await createClient());

  const messages: ModelMessage[] = historico.map((m) =>
    m.role === "user" ? { role: "user", content: m.content } : { role: "assistant", content: m.content },
  );
  if (texto) {
    messages.push({ role: "user", content: texto });
  } else if (messages.length === 0 && !finalizar) {
    messages.push({ role: "user", content: "Inicie a entrevista fazendo a primeira pergunta." });
  }
  // O gestor clicou "Concluir entrevista e gerar proposta": mande a IA FECHAR a
  // proposta agora com tudo que já foi dito. Só se faltar dado OBRIGATÓRIO de um
  // item NOVO ela pode perguntar em vez de propor.
  if (finalizar) {
    messages.push({
      role: "user",
      content:
        "Encerrar a entrevista AGORA. Com base em TUDO que já foi respondido, monte a proposta " +
        "final (campo 'proposta' PREENCHIDO no JSON): todos os itens mantidos com o valor/mês " +
        "confirmados, mais os itens novos completos, sem os que eu disse não manter. Se NÃO houver " +
        "nenhum item (categoria zerada), devolva 'proposta' com \"itens\": [] (lista vazia) e uma " +
        "justificativa — NÃO devolva proposta null. Só devolva proposta null se faltar algum dado " +
        "OBRIGATÓRIO (nome, valor, mensal/anual, mês, justificativa) de um item NOVO — nesse caso " +
        "pergunte apenas o que falta.",
    });
  }

  const resolved = await resolvedPromise; // já resolvendo em paralelo desde o início
  let replyText: string;
  let usageOk: Awaited<ReturnType<typeof generateText>>["usage"] | null = null;
  try {
    const { text, usage } = await generateText({
      model: resolved.provider.chat(resolved.modelName),
      system,
      messages,
      temperature: 0.4,
    });
    replyText = text;
    usageOk = usage;
  } catch (e) {
    await logResolvedUsage(resolved, "orcamento", null, {
      companyId,
      userId: admin.userId,
      success: false,
      errorMessage: e instanceof Error ? e.message : String(e),
    });
    return { error: `Falha ao consultar a IA: ${e instanceof Error ? e.message : String(e)}` };
  }

  const parsed = parseAiReply(replyText);
  const reply = parsed.reply;
  const podeFechar = parsed.podeFechar;
  // A proposta (Etapa 3) SÓ é aceita quando o gestor ENCERRA a entrevista
  // (finalizar). Durante o chat, mesmo que a IA escorregue e mande uma proposta,
  // ela é ignorada — quem destrava a Etapa 3 é o botão "Concluir".
  const proposta = finalizar ? parsed.proposta : null;

  const novaConversa: PlanejamentoMensagem[] = [
    ...historico,
    ...(texto ? [{ role: "user" as const, content: texto }] : []),
    { role: "assistant" as const, content: reply },
  ];

  // Persiste a conversa sempre; e, quando a proposta é fechada (Etapa 3), grava-a
  // na coluna jsonb e DESCONGELA (proposta_confirmada=false) — proposta nova pede
  // nova confirmação. A BASE (itens) NÃO é tocada aqui.
  const payload: Record<string, unknown> = {
    company_id: companyId,
    year,
    category_code: categoryCode,
    category_name: categoryName,
    conversa: novaConversa,
    updated_by: admin.userId,
  };
  if (proposta) {
    payload.proposta = proposta;
    payload.proposta_confirmada = false;
    payload.status = "rascunho";
  }

  // Grava a conversa e registra o uso da IA em PARALELO.
  const [upsertRes] = await Promise.all([
    supabase.from("orcamento_planejamento_socios").upsert(payload, { onConflict: "company_id,year,category_code" }),
    logResolvedUsage(resolved, "orcamento", usageOk, { companyId, userId: admin.userId }),
  ]);
  const upErr = upsertRes.error;
  if (upErr) {
    if (isSchemaMissing(upErr.message)) return { needsMigration: true };
    return { reply, proposta, podeFechar, conversa: novaConversa, error: upErr.message };
  }

  revalidatePath(PATH);
  return { reply, proposta, podeFechar, conversa: novaConversa };
}

/**
 * STREAMING (turno de entrevista) — monta o `system` + `messages` (serializáveis)
 * para a ROTA `/api/orcamento/planejamento/chat` fazer o `streamText`. NÃO chama
 * a IA nem persiste aqui: a rota resolve o provedor, faz o streaming e persiste
 * a conversa no `onFinish` via `persistirConversaEntrevista`. A resposta é TEXTO
 * corrido; o fim da entrevista vem do marcador [[FECHAR]] (ver planejamento-calc).
 */
export async function montarPromptEntrevista(
  companyId: string,
  year: number,
  categoryCode: string,
  categoryName: string,
  conversaAtual: PlanejamentoMensagem[],
  textoUsuario: string,
  itensContexto: PlanejamentoContextoItem[] = [],
  promptCtx?: PlanejamentoPromptContexto,
): Promise<{
  system?: string;
  messages?: Array<{ role: "user" | "assistant"; content: string }>;
  error?: string;
  needsMigration?: boolean;
}> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!companyId || !categoryCode) return { error: "Categoria inválida." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const prep = await montarSistemaEntrevista({
    companyId,
    year,
    categoryCode,
    categoryName,
    conversaAtual,
    itensContexto,
    promptCtx,
    streaming: true,
  });
  if ("needsMigration" in prep) return { needsMigration: true };
  if ("error" in prep) return { error: prep.error };

  const texto = (textoUsuario ?? "").trim();
  const messages: Array<{ role: "user" | "assistant"; content: string }> = prep.historico.map((m) =>
    m.role === "user" ? { role: "user", content: m.content } : { role: "assistant", content: m.content },
  );
  if (texto) {
    messages.push({ role: "user", content: texto });
  } else if (messages.length === 0) {
    messages.push({ role: "user", content: "Inicie a entrevista fazendo a primeira pergunta." });
  }

  return { system: prep.system, messages };
}

/**
 * Persiste a conversa da entrevista (SEM tocar em proposta/base/status).
 * Chamado pelo `onFinish` do streaming, com a conversa completa já montada
 * (a resposta da IA já sem o marcador [[FECHAR]]).
 */
export async function persistirConversaEntrevista(
  companyId: string,
  year: number,
  categoryCode: string,
  categoryName: string,
  conversa: PlanejamentoMensagem[],
): Promise<{ ok?: true; error?: string; needsMigration?: boolean }> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!companyId || !categoryCode) return { error: "Categoria inválida." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());
  const { error } = await supabase.from("orcamento_planejamento_socios").upsert(
    {
      company_id: companyId,
      year,
      category_code: categoryCode,
      category_name: categoryName,
      conversa: sanitizeConversa(conversa),
      updated_by: admin.userId,
    },
    { onConflict: "company_id,year,category_code" },
  );
  if (error) {
    if (isSchemaMissing(error.message)) return { needsMigration: true };
    return { error: error.message };
  }
  revalidatePath(PATH);
  return { ok: true };
}

// ─── Salvar / remover ──────────────────────────────────────────────────────────

/**
 * ETAPA 1 — grava a BASE (o que a IA deve considerar) e a marca como FINALIZADA
 * (base_salva=true), o que habilita a entrevista. Persiste TODAS as linhas —
 * inclusive as EXCLUÍDAS (incluir=false), para lembrar as exclusões; só as
 * incluídas viram contexto da IA. NÃO mexe na proposta (Etapa 3).
 */
export async function salvarBasePlanejamento(
  companyId: string,
  year: number,
  categoryCode: string,
  categoryName: string,
  itens: PlanejamentoItemProposto[],
  contextoAdmin = "",
): Promise<{ ok?: true; error?: string; needsMigration?: boolean }> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!companyId || !categoryCode) return { error: "Categoria inválida." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  // A base PODE ser vazia (categorias sem contratos/assinaturas pré-existentes,
  // ex.: Consultoria e Treinamento) — nesse caso a entrevista é aberta. Não há
  // trava de "mínimo 1 item".
  const limpos = sanitizeItensProposta(itens).filter((i) => i.descricao.trim() !== "");
  const ctx = contextoAdmin.trim();

  const supabase = createAdminClientIfAvailable() ?? (await createClient());

  const { error: catErr } = await supabase.from("orcamento_planejamento_socios").upsert(
    {
      company_id: companyId,
      year,
      category_code: categoryCode,
      category_name: categoryName,
      base_salva: true,
      contexto_admin: ctx || null,
      updated_by: admin.userId,
    },
    { onConflict: "company_id,year,category_code" },
  );
  if (catErr) {
    if (isSchemaMissing(catErr.message)) return { needsMigration: true };
    return { error: catErr.message };
  }

  const { error: delErr } = await supabase
    .from("orcamento_planejamento_socios_itens")
    .delete()
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("category_code", categoryCode);
  if (delErr) return { error: delErr.message };

  const rows = limpos.map((i) => ({
    company_id: companyId,
    year,
    category_code: categoryCode,
    descricao: i.descricao.trim(),
    valor_mensal: i.valorMensal,
    mes_inicio: i.mesInicio,
    mes_fim: i.periodicidade === "anual" ? null : i.mesFim ?? null,
    periodicidade: i.periodicidade,
    origem: i.origem,
    fornecedor: i.fornecedor ?? null,
    incluir: i.incluir !== false,
    updated_by: admin.userId,
  }));
  const { error: insErr } = await supabase.from("orcamento_planejamento_socios_itens").insert(rows);
  if (insErr) return { error: insErr.message };

  revalidatePath(PATH);
  return { ok: true };
}

/**
 * ETAPA 3 — CONFIRMA a proposta (congela). Depois disso ela vai para a Prévia e
 * só o admin altera os números (via editarPropostaPlanejamento).
 */
export async function confirmarPropostaPlanejamento(
  companyId: string,
  year: number,
  categoryCode: string,
): Promise<{ ok?: true; error?: string; needsMigration?: boolean }> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!companyId || !categoryCode) return { error: "Categoria inválida." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());
  const { error } = await supabase
    .from("orcamento_planejamento_socios")
    .update({
      proposta_confirmada: true,
      proposta_confirmada_por: admin.userId,
      status: "concluido",
      updated_by: admin.userId,
    })
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("category_code", categoryCode);
  if (error) {
    if (isSchemaMissing(error.message)) return { needsMigration: true };
    return { error: error.message };
  }
  revalidatePath(PATH);
  return { ok: true };
}

/**
 * ETAPA 3 (admin) — edita os NÚMEROS da proposta. Reescreve a coluna `proposta`
 * (jsonb) e mantém a confirmação.
 */
export async function editarPropostaPlanejamento(
  companyId: string,
  year: number,
  categoryCode: string,
  itens: PlanejamentoItemProposto[],
  justificativa: string,
): Promise<{ ok?: true; error?: string; needsMigration?: boolean }> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!companyId || !categoryCode) return { error: "Categoria inválida." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const limpos = sanitizeItensProposta(itens).filter((i) => i.descricao.trim() !== "");
  if (limpos.length === 0) return { error: "A proposta precisa de ao menos um item." };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());
  const { error } = await supabase
    .from("orcamento_planejamento_socios")
    .update({
      proposta: { itens: limpos, justificativa: (justificativa ?? "").trim() },
      updated_by: admin.userId,
    })
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("category_code", categoryCode);
  if (error) {
    if (isSchemaMissing(error.message)) return { needsMigration: true };
    return { error: error.message };
  }
  revalidatePath(PATH);
  return { ok: true };
}

/**
 * Reinicia SOMENTE a entrevista com a IA: zera a conversa E a proposta (saída da
 * entrevista), mantendo intacta a BASE (Etapa 1) que o admin salvou.
 */
export async function reiniciarConversaPlanejamento(
  companyId: string,
  year: number,
  categoryCode: string,
): Promise<{ ok?: true; error?: string; needsMigration?: boolean }> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!companyId || !categoryCode) return { error: "Categoria inválida." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());
  const { error } = await supabase
    .from("orcamento_planejamento_socios")
    .update({
      conversa: [],
      proposta: null,
      proposta_confirmada: false,
      status: "rascunho",
      updated_by: admin.userId,
    })
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("category_code", categoryCode);
  if (error) {
    if (isSchemaMissing(error.message)) return { needsMigration: true };
    return { error: error.message };
  }
  revalidatePath(PATH);
  return { ok: true };
}

export async function removerPlanejamentoSocios(
  companyId: string,
  year: number,
  categoryCode: string,
): Promise<{ ok?: true; error?: string }> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!companyId || !categoryCode) return { error: "Categoria inválida." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());
  const { error: itemErr } = await supabase
    .from("orcamento_planejamento_socios_itens")
    .delete()
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("category_code", categoryCode);
  if (itemErr) return { error: itemErr.message };
  const { error } = await supabase
    .from("orcamento_planejamento_socios")
    .delete()
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("category_code", categoryCode);
  if (error) return { error: error.message };
  revalidatePath(PATH);
  return { ok: true };
}
