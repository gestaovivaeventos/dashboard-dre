"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { getOrcamentoUser, podeVerEmpresa, SEM_ACESSO } from "@/lib/orcamento/auth";
import { isSchemaMissing } from "@/lib/orcamento/errors";
import { isValidBudgetYear } from "@/lib/orcamento/years";
import { SETOR_TODOS, setorEspecifico } from "@/lib/orcamento/setor-filtro";
import {
  buildDashboardRows,
  loadScopedDreAccounts,
  type DashboardRow,
} from "@/lib/dashboard/dre";
import { projetarMedia } from "@/lib/orcamento/media-calc";
import { combinarRealizados, fetchRealizados } from "@/lib/orcamento/media-realizado";
import { projetarValorFixoSerie } from "@/lib/orcamento/valor-fixo-calc";
import {
  unificarGemeas,
  categoriaSerie,
  periodicidadeLabel,
  serieItem,
  toPeriodicidade,
  type Periodicidade,
} from "@/lib/orcamento/planejamento-calc";
import { getPrevia } from "@/lib/orcamento/actions/pessoal";
import { rotuloOrcamento } from "@/lib/orcamento/previa-budget-labels";
import { vinculoLabel } from "@/lib/orcamento/vinculos";
import { metodoLabel, type OrcamentoMetodo } from "@/lib/orcamento/metodos";
import { CATEGORIA_METODO_INTEIRO } from "@/lib/orcamento/finalizacao";
import { workspaceTabHref } from "@/lib/orcamento/workspace-tabs";
import { INDICES, type IndiceKey, type IndiceUnit } from "@/lib/orcamento/indices";
import { mesesDoRetrato } from "@/lib/viagens/custo/mapear";
import {
  chaveMedia,
  entraNoNumero,
  estadoDoItem,
  podeDecidir,
  type Validacao,
  type ValidacaoAlvoTipo,
  type ValidacaoEstado,
} from "@/lib/orcamento/validacao-diretoria";

/** Unidade de cada índice (percent × brl), para o valor fixo corrigir certo. */
const INDICE_UNIT = new Map<string, IndiceUnit>(INDICES.map((i) => [i.key, i.unit]));

// =============================================================================
// Prévia do Orçamento — a DRE da empresa preenchida com os valores ORÇADOS.
//
// É uma VIEW CALCULADA AO VIVO: lê direto as fontes de cada método (média,
// pessoal, …), resolve cada valor para a linha da DRE e reusa o MESMO motor do
// Dashboard (`buildDashboardRows`) para somar folhas, avaliar as fórmulas das
// linhas calculadas (4/6/8/11) e produzir a estrutura inteira. Não há "publicar"
// nem tabela: mudou o valor num método, abriu a prévia, já reflete.
//
// Duas chaves diferentes desembocam na mesma linha da DRE:
//  - MÉDIA: category_code → category_mapping → dre_account_id (o mesmo
//    mapeamento categoria→conta do Financeiro), corrigido pelo índice.
//  - PESSOAL: rótulo "Pessoal — X" → budget_account_mappings → dre_account_id
//    (o mesmo mapeamento "Linhas do Orçamento" que o envio ao Budget já usa).
//
// Todo dre_account_id lido passa por `translateToScopedId` (casa por code), que
// funciona tanto para id do plano global quanto do plano custom da empresa.
//
// Receita ainda não tem método de orçamento (Método por categoria só lista
// despesa), então as linhas de receita saem zeradas — decisão consciente; o
// aviso na tela deixa isso explícito.
// =============================================================================

/**
 * De onde veio um pedaço do valor de uma linha — o drilldown da Prévia.
 *
 * A Prévia soma tudo num acumulador por conta; sem isto, o número final não
 * conta de qual categoria/método ele veio. Guardamos a contribuição de cada
 * origem em paralelo à soma, com o link para a tela que a produziu.
 */
/**
 * 2º nível do drilldown: o que compõe UMA origem. Cada método tem a sua
 * granularidade natural — o item que o gestor planejou, o contrato de valor
 * fixo, o colaborador da folha.
 */
export interface PreviaFonteItem {
  nome: string;
  /**
   * Alvo da VALIDAÇÃO da diretoria. A Prévia é calculada ao vivo e os itens
   * dela não tinham identidade; sem isto o ✓ do diretor não teria onde grudar.
   *
   * `alvoId` é TEXT porque a média é chaveada por (categoria, setor) — a linha
   * dela pode nem existir enquanto o gestor não salva. Ver `chaveMedia`.
   */
  alvoTipo?: ValidacaoAlvoTipo;
  alvoId?: string;
  /**
   * Setor do item. A decisão da diretoria é gravada com ele porque o contador
   * do gestor recorta por setor — e a Prévia pode estar em "Todos os setores",
   * onde o setor da tela não diz de quem é a despesa.
   */
  setorId?: string | null;
  /** `updated_at` do item: é a comparação que vence a decisão do diretor. */
  atualizadoEm?: string | null;
  /** Estado efetivo da validação (já considerando decisão vencida). */
  estado?: ValidacaoEstado;
  /** O "balãozinho": o que o diretor pediu que o gestor mude. */
  comentario?: string | null;
  /** Complemento curto (periodicidade, vínculo, índice…). */
  detalhe?: string;
  /**
   * GRUPO de despesa — o subnível entre a categoria e a despesa, preenchido só
   * pelo Planejamento dos gestores (os outros métodos não têm grupo, e ali fica
   * `undefined`). A tela agrupa por ele em ordem alfabética, com as despesas
   * sem grupo num balde ao fim. Ver src/lib/orcamento/grupos.ts.
   */
  grupo?: string | null;
  meses: number[];
  totalAno: number;
}

export interface PreviaFonte {
  /** Parte aprovada desta origem (soma só dos itens com ✓). */
  mesesAprovados?: number[];
  totalAnoAprovado?: number;
  /** Chave do método (metodos.ts) — também é o slug da aba do workspace. */
  metodo: string;
  metodoLabel: string;
  /** Nome da categoria, ou o rótulo da linha no caso do pessoal. */
  chave: string;
  /**
   * Código da categoria da Omie — a âncora estável da fatia que se FINALIZA.
   * `chave` é o NOME, que muda no cadastro e no pessoal nem é categoria (é o
   * rótulo da linha da DRE); recortar por ele daria fatia errada em silêncio.
   * Vazio no pessoal: lá a fatia é o quadro do setor inteiro.
   */
  categoryCode: string;
  meses: number[];
  totalAno: number;
  /** Rota da tela de origem, para abrir em nova aba. */
  href: string;
  /** Abertura da origem. Vazio quando o método não tem nível abaixo. */
  itens: PreviaFonteItem[];
}

/** Uma linha da estrutura DRE com os 12 meses orçados + total do ano. */
export interface PreviaDreLinha {
  id: string;
  code: string;
  name: string;
  level: number;
  /** 'receita' | 'despesa' | 'calculado' | 'misto'. */
  type: string;
  isSummary: boolean;
  isCalculado: boolean;
  isReceita: boolean;
  hasChildren: boolean;
  meses: number[];
  totalAno: number;
  /**
   * A parte APROVADA pela diretoria. `meses` continua sendo o que o gestor
   * montou (o orçado); isto é o que já passou — e é este o número que compõe a
   * Prévia da empresa e o que vai ao Budget.
   */
  mesesAprovados: number[];
  totalAnoAprovado: number;
  /** Origens que compõem esta linha (vazio em linha calculada por fórmula). */
  fontes: PreviaFonte[];
}

/** Valores que não conseguiram cair numa linha da DRE (ficam visíveis). */
export interface PreviaOrfao {
  chave: string;
  meses: number[];
  totalAno: number;
}

export interface PreviaOrcamentoData {
  linhas: PreviaDreLinha[];
  /** Rótulos do pessoal sem conta em "Linhas do Orçamento". */
  pessoalNaoClassificado: PreviaOrfao[];
  /** Categorias por média com valor, mas sem mapeamento categoria→DRE. */
  categoriasNaoMapeadas: PreviaOrfao[];
  /**
   * Propostas de categorias gêmeas "(*)" que NÃO entram no orçamento porque a
   * canônica de mesmo nome também é planejada — o card é um só. Ficam visíveis
   * para que um planejamento feito ali não desapareça em silêncio.
   */
  planejamentoGemeaIgnorada: PreviaOrfao[];
  /** Diagnóstico para a tela. */
  resumo: {
    temReceita: boolean;
    mediaCategorias: number;
    mediaSemValor: number;
    valorFixoCategorias: number;
    valorFixoSemValor: number;
    planejamentoCategorias: number;
    planejamentoSemValor: number;
    viagensCategorias: number;
    viagensSemValor: number;
    /** Colaboradores dentro do escopo (empresa ou setor). */
    pessoalColaboradores: number;
    /**
     * Motivo de as despesas com PESSOAL não terem entrado nesta prévia, ou
     * `null` quando entraram. A folha é quase sempre a maior linha do
     * orçamento: somí-la como zero sem dizer nada já aconteceu.
     */
    pessoalIndisponivel: string | null;
    totalDespesa: number;
    /** Só o que a diretoria aprovou — é o número que vai ao Budget. */
    totalDespesaAprovada: number;
    /** Quantos itens ainda não têm ✓ (pendentes, reprovados ou a revisar). */
    itensPendentes: number;
    /**
     * Quem lê pode decidir? É a resposta que faz a tela mostrar (ou esconder)
     * os botões da decisão. Vem daqui, e não de um segundo carregamento, para
     * a tela nunca oferecer um botão que o servidor vai recusar.
     */
    podeValidar: boolean;
    totalReceita: number;
  };
}

interface CategoriaMetodoRow {
  category_code: string;
  category_name: string | null;
}
interface MediaSnapshotRow {
  category_code: string;
  setor_id: string | null;
  media_valor: number | string | null;
  indice_key: string | null;
  updated_at?: string | null;
}
interface ValorFixoSnapshotRow {
  id?: string;
  category_code: string;
  setor_id: string | null;
  updated_at?: string | null;
  valor_base: number | string | null;
  indice_key: string | null;
  mes_reajuste: number | string | null;
  /** Rótulo do contrato — só preenchido quando a categoria tem 2+. */
  descricao: string | null;
}
interface CategoryMappingRow {
  omie_category_code: string;
  dre_account_id: string | null;
  company_id: string | null;
}

const MESES_CURTO = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** Moeda curta para o texto de detalhe do item (sem centavos quando redondo). */
function formatBRLSimples(v: number): string {
  return v.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: v % 1 === 0 ? 0 : 2,
  });
}

function db() {
  return createAdminClientIfAvailable();
}

/** Soma um vetor de 12 meses inteiro no acumulador. */
function pushMeses(acc: Map<string, number[]>, key: string, meses: number[]) {
  const arr = acc.get(key) ?? Array<number>(12).fill(0);
  for (let m = 0; m < 12; m += 1) arr[m] += meses[m] ?? 0;
  acc.set(key, arr);
}
function somar(meses: number[]): number {
  return meses.reduce((a, b) => a + b, 0);
}

export async function getPreviaOrcamento(
  companyId: string,
  year: number,
  /**
   * Escopo da prévia. Ausente, null ou SETOR_TODOS = empresa inteira (o
   * orçamento que vai para a DRE). Um uuid recorta a prévia num setor.
   *
   * O recorte é feito LINHA A LINHA (setor_id de cada despesa), nunca por
   * categoria: uma categoria pode ser orçada por dois setores, mas cada
   * despesa dentro dela pertence a um só. É isso que faz a soma dos setores
   * fechar com "Todos os setores".
   */
  setorId?: string | null,
): Promise<{ data?: PreviaOrcamentoData; error?: string; needsMigration?: boolean }> {
  // LEITURA: qualquer usuário do módulo, na empresa que ele alcança. O recorte
  // por setor continua sendo escolha da tela (o construtor também precisa ver
  // o total da empresa para saber onde o orçamento dele entra).
  const user = await getOrcamentoUser();
  if (!user) return { error: SEM_ACESSO };
  if (!companyId) return { error: "Selecione uma empresa." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };
  if (!podeVerEmpresa(user, companyId)) return { error: SEM_ACESSO };

  const filtroSetor = setorEspecifico(setorId);

  const supabase = db() ?? (await createClient());

  // ── Estrutura DRE da empresa (plano custom ou global) ──────────────────────
  let scope;
  try {
    scope = await loadScopedDreAccounts(supabase, [companyId]);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Falha ao carregar a estrutura DRE." };
  }

  // Acumulador de valores por FOLHA (scoped dre_account_id) × 12 meses.
  const leafByScopedId = new Map<string, number[]>();
  // Acumulador paralelo: só o que a diretoria aprovou. Roda na MESMA passada
  // para não calcular a Prévia duas vezes.
  const leafAprovadoByScopedId = new Map<string, number[]>();

  // Decisões da diretoria, indexadas por alvo. Ausência de tabela (migration
  // pendente) vira mapa vazio: a Prévia continua respondendo, com tudo
  // pendente — nunca quebra por causa da validação.
  const validacoesPorAlvo = new Map<string, Validacao>();
  {
    const { data: vRows } = await supabase
      .from("orcamento_validacoes")
      .select("alvo_tipo, alvo_id, status, comentario, decidido_em, decidido_por")
      .eq("company_id", companyId)
      .eq("year", year);
    ((vRows ?? []) as Array<Record<string, unknown>>).forEach((r) => {
      validacoesPorAlvo.set(`${r.alvo_tipo as string}|${r.alvo_id as string}`, {
        alvoTipo: r.alvo_tipo as ValidacaoAlvoTipo,
        alvoId: r.alvo_id as string,
        status: r.status as Validacao["status"],
        comentario: (r.comentario as string | null) ?? null,
        decididoEm: r.decidido_em as string,
        decididoPor: (r.decidido_por as string | null) ?? null,
      });
    });
  }

  /**
   * Preenche `estado`/`comentario` de cada item e devolve a série APROVADA da
   * origem — a soma só dos itens com ✓.
   *
   * Somar as partes aprovadas equivale a recalcular o método com o subconjunto
   * porque as partes particionam exatamente o todo: no pessoal isso é garantido
   * pelo motor (que roda por colaborador e cuja soma reproduz o agregado, como
   * o próprio `getPrevia` documenta), e nos demais cada item já É uma parcela.
   * É o que faz os encargos, férias e 13º saírem exatos para quem foi aprovado,
   * sem rateio por proporção — que erraria, porque RAT/FAP e o teto do INSS não
   * são lineares no total.
   */
  const marcarEAprovar = (itens: PreviaFonteItem[]): number[] => {
    const aprovado = Array<number>(12).fill(0);
    itens.forEach((it) => {
      const chave = it.alvoTipo && it.alvoId ? `${it.alvoTipo}|${it.alvoId}` : null;
      const v = chave ? validacoesPorAlvo.get(chave) ?? null : null;
      it.estado = estadoDoItem(v, it.atualizadoEm);
      it.comentario = v?.comentario ?? null;
      if (!entraNoNumero(it.estado)) return;
      for (let m = 0; m < 12; m += 1) aprovado[m] += it.meses[m] ?? 0;
    });
    return aprovado;
  };
  // Origens que compõem cada folha, na mesma ordem em que são somadas — é o
  // que permite o drilldown sem recalcular nada.
  const fontesByScopedId = new Map<string, PreviaFonte[]>();
  const pushFonte = (scopedId: string, fonte: PreviaFonte) => {
    const lista = fontesByScopedId.get(scopedId) ?? [];
    lista.push(fonte);
    fontesByScopedId.set(scopedId, lista);
  };
  const pessoalNaoClassificado: PreviaOrfao[] = [];
  const categoriasNaoMapeadas: PreviaOrfao[] = [];
  const planejamentoGemeaIgnorada: PreviaOrfao[] = [];

  // Ids das contas que a prévia REALMENTE renderiza (core = top-level 1..19).
  // `translateToScopedId` casa contra o plano COMPLETO (`scopedAccounts`), que
  // inclui contas fora da faixa core (ex.: grupo Financeiras em planos que o
  // colocam ≥20, ou linhas auxiliares). Um valor mapeado para uma conta fora
  // desse conjunto não teria linha onde pousar e sumiria em silêncio — então
  // só aceitamos o pouso quando o id está em `coreAccounts`; senão vira órfão
  // visível no aviso "Valores fora da DRE".
  const coreIds = new Set(scope.coreAccounts.map((a) => a.id));

  // Nomes dos setores para etiquetar o drilldown na visão consolidada: em
  // "Todos os setores" dois contratos de Água, um de cada setor, ficariam
  // indistinguíveis. Filtrando por um setor a etiqueta seria ruído — e aí nem
  // se carrega.
  const nomeSetor = new Map<string, string>();
  if (!filtroSetor) {
    const { data: setorRows } = await supabase
      .from("orcamento_setores")
      .select("id, name")
      .eq("company_id", companyId)
      .eq("year", year);
    for (const r of setorRows ?? []) nomeSetor.set(r.id as string, r.name as string);
  }
  /** " · Administrativo" para o detalhe do item, ou "" quando não há o que dizer. */
  const etiquetaSetor = (id: string | null | undefined): string => {
    const n = id ? nomeSetor.get(id) : null;
    return n ? ` · ${n}` : "";
  };

  // ── MÉTODOS POR CATEGORIA (média + valor fixo) ──────────────────────────────
  // Ambos ligam na DRE pela mesma chave (category_code → category_mapping) e
  // usam os mesmos índices do ano; só a ORIGEM do valor difere (realizado médio
  // vs. valor base digitado). Uma consulta pega os dois métodos; índice e
  // mapeamento são resolvidos uma vez e compartilhados.
  let mediaCategorias = 0;
  let mediaSemValor = 0;
  let valorFixoCategorias = 0;
  let valorFixoSemValor = 0;
  let planejamentoCategorias = 0;
  let planejamentoSemValor = 0;
  let viagensCategorias = 0;
  let viagensSemValor = 0;
  const { data: metodoRows, error: metodoErr } = await supabase
    .from("orcamento_categoria_metodo")
    .select("category_code, category_name, metodo")
    .eq("company_id", companyId)
    .eq("year", year)
    .in("metodo", ["media", "valor_fixo", "planejamento_socios", "viagens"]);
  if (metodoErr) {
    if (isSchemaMissing(metodoErr.message)) return { needsMigration: true };
    return { error: metodoErr.message };
  }
  const metodoCatsTodas = (metodoRows ?? []) as (CategoriaMetodoRow & { metodo: string })[];

  // A gêmea "(*)" NÃO vira linha própria quando a canônica de mesmo nome também
  // é orçada: na construção do orçamento é tudo Marketing, e o realizado da
  // canônica já soma as duas (ver `unificarGemeas`). Vale para os TRÊS métodos
  // — até 25/09/2026 só o Planejamento aplicava a regra, e a Média produzia
  // duas linhas para a mesma despesa.
  //
  // A Prévia tem de orçar exatamente o que as telas mostram: linha que ela soma
  // e a tela não abre é número que ninguém consegue conferir nem editar.
  const unificadoPrevia = unificarGemeas(
    metodoCatsTodas.map((c) => ({
      ...c,
      categoryCode: c.category_code,
      categoryName: c.category_name ?? c.category_code,
    })),
  );
  const metodoCats = unificadoPrevia.items;
  const mediaCats = metodoCats.filter((c) => c.metodo === "media");
  const vfCats = metodoCats.filter((c) => c.metodo === "valor_fixo");
  const psCats = metodoCats.filter((c) => c.metodo === "planejamento_socios");
  const viagensCats = metodoCats.filter((c) => c.metodo === "viagens");
  // As absorvidas que tinham método próprio: param de contar (senão dobram) e
  // viram aviso na tela. Sumir com número em silêncio é o que não pode.
  const gemeasIgnoradas = unificadoPrevia.gemeasIgnoradas;
  if (metodoCats.length > 0) {
    const allCodes = Array.from(new Set(metodoCats.map((c) => c.category_code)));

    // Categorias atribuídas ao setor filtrado. Serve de escopo para as
    // categorias que ainda não têm linha gravada (a média viva, por exemplo):
    // sem isso elas não teriam como saber a que setor pertencem.
    const codesDoSetor = new Set<string>();
    if (filtroSetor) {
      const { data: atribRows, error: atribErr } = await supabase
        .from("orcamento_categoria_setores")
        .select("category_code")
        .eq("company_id", companyId)
        .eq("year", year)
        .eq("setor_id", filtroSetor);
      if (atribErr) {
        if (isSchemaMissing(atribErr.message)) return { needsMigration: true };
        return { error: atribErr.message };
      }
      for (const r of atribRows ?? []) codesDoSetor.add(r.category_code as string);
    }

    // Categorias que este escopo enxerga: as atribuídas ao setor MAIS as que
    // têm alguma linha nele. A união cobre o caso de uma despesa movida cuja
    // atribuição da categoria não acompanhou — ela apareceria só em "Todos",
    // e some do setor onde está de fato.
    const noEscopo = <T extends { category_code: string }>(
      lista: T[],
      comLinha: Set<string>,
    ): T[] =>
      filtroSetor
        ? lista.filter((c) => codesDoSetor.has(c.category_code) || comLinha.has(c.category_code))
        : lista;

    // Índices percentuais do ano (compartilhado pelos dois métodos).
    const { data: indiceRowRaw } = await supabase
      .from("orcamento_indices")
      .select("*")
      .eq("year", year)
      .maybeSingle();
    const indiceRow = (indiceRowRaw ?? null) as Record<string, number | null> | null;
    const indicePercent = (key: string | null): number | null => {
      if (!key) return null;
      const v = indiceRow?.[key as IndiceKey];
      return v == null ? null : Number(v);
    };

    // Mapeamento categoria→conta (override da empresa > global), uma vez só.
    const { data: mapRows, error: mapErr } = await supabase
      .from("category_mapping")
      .select("omie_category_code, dre_account_id, company_id")
      .in("omie_category_code", allCodes)
      .or(`company_id.eq.${companyId},company_id.is.null`);
    if (mapErr) return { error: mapErr.message };
    const mapByCode = new Map<string, string | null>();
    for (const r of (mapRows ?? []) as CategoryMappingRow[]) {
      // Override da empresa tem prioridade: sobrescreve o global.
      if (r.company_id === companyId) mapByCode.set(r.omie_category_code, r.dre_account_id);
      else if (!mapByCode.has(r.omie_category_code)) mapByCode.set(r.omie_category_code, r.dre_account_id);
    }

    // Resolve o code para a folha escopada; empurra os 12 meses ou registra o órfão.
    const aplicar = (
      code: string,
      chave: string,
      meses: number[],
      metodo: string,
      itens: PreviaFonteItem[] = [],
    ) => {
      const rawAccountId = mapByCode.get(code) ?? null;
      const scopedId = rawAccountId ? scope.translateToScopedId(rawAccountId) : null;
      // Sem conta mapeada, ou mapeada para fora da faixa renderizada (coreIds):
      // fica órfão visível, nunca descartado.
      if (!scopedId || !coreIds.has(scopedId)) {
        categoriasNaoMapeadas.push({ chave, meses, totalAno: somar(meses) });
        return;
      }
      pushMeses(leafByScopedId, scopedId, meses);
      const aprovados = marcarEAprovar(itens);
      pushMeses(leafAprovadoByScopedId, scopedId, aprovados);
      pushFonte(scopedId, {
        metodo,
        metodoLabel: metodoLabel(metodo as OrcamentoMetodo),
        chave,
        categoryCode: code,
        meses,
        totalAno: somar(meses),
        mesesAprovados: aprovados,
        totalAnoAprovado: somar(aprovados),
        href: workspaceTabHref(companyId, year, metodo),
        itens,
      });
    };

    // MÉDIA — valor mensal médio, igual nos 12 meses.
    if (mediaCats.length > 0) {
      const { data: snapRows, error: snapErr } = await supabase
        .from("orcamento_media_categorias")
        .select("category_code, setor_id, media_valor, indice_key, updated_at")
        .eq("company_id", companyId)
        .eq("year", year);
      if (snapErr) {
        if (isSchemaMissing(snapErr.message)) return { needsMigration: true };
        return { error: snapErr.message };
      }
      // Uma linha POR SETOR: a categoria pode ser orçada pelo Comercial e pelo
      // Produto. Agrupa em lista e soma — um Map por código perderia setores.
      const todasSnaps = (snapRows ?? []) as MediaSnapshotRow[];
      // Códigos com linha gravada em QUALQUER setor: é o que impede a média
      // viva de reaparecer no setor filtrado quando o valor salvo é de outro.
      const comLinhaNoAno = new Set(todasSnaps.map((r) => r.category_code));
      const snapsDoEscopo = filtroSetor
        ? todasSnaps.filter((r) => r.setor_id === filtroSetor)
        : todasSnaps;
      const snapsByCode = new Map<string, MediaSnapshotRow[]>();
      for (const r of snapsDoEscopo) {
        const lista = snapsByCode.get(r.category_code) ?? [];
        lista.push(r);
        snapsByCode.set(r.category_code, lista);
      }
      // Realizado do ano-base AO VIVO — mesmo cálculo da tela de Média. A prévia
      // lia só o snapshot salvo, mas a tela mostra `mediaValor ?? realizado.media`
      // (sugestão viva antes de "Recalcular p/ salvar"): categoria com valor
      // vivo mas sem snapshot aparecia zerada aqui. Usamos o MESMO efetivo.
      const catsEscopo = noEscopo(mediaCats, new Set(snapsByCode.keys()));
      mediaCategorias = catsEscopo.length;
      // Busca TODOS os códigos (o da canônica e os das gêmeas) e combina: é o
      // mesmo efetivo da tela de Média, que também soma as duas.
      const mediaCodes = Array.from(new Set(catsEscopo.flatMap((c) => c.codigos)));
      const realizados = await fetchRealizados(supabase, companyId, year - 1, mediaCodes);
      for (const cat of catsEscopo) {
        const snaps = snapsByCode.get(cat.category_code) ?? [];
        // Sem nenhuma linha gravada, vale a média VIVA do realizado (é o que a
        // tela mostra antes de "Recalcular p/ salvar"). Com linhas, soma-se o
        // projetado de cada setor.
        // Filtrando por setor, a média viva só vale se a categoria não tiver
        // linha gravada em setor NENHUM: se tem e ela é de outro setor, o valor
        // pertence a ele, e ressuscitá-lo aqui contaria a despesa duas vezes.
        if (filtroSetor && snaps.length === 0 && comLinhaNoAno.has(cat.category_code)) continue;
        const parcelas = snaps.length > 0 ? snaps : [null];
        let projetado = 0;
        // UM ITEM POR LINHA GRAVADA (categoria × setor) — que é a unidade que o
        // gestor edita e que a diretoria decide. Agregar as parcelas num item
        // único (como era até 25/09/2026) dava um ✓ que valia por vários
        // setores e ficava ancorado no setor da MAIOR parcela: aprovar um
        // deixava os outros livres para edição, ainda somando no aprovado.
        //
        // Sem nenhuma linha (média "viva" do realizado) há um item só, com
        // setor nulo — ver `travaDaLinhaDeMedia`, que confere as duas chaves.
        const itensMedia: PreviaFonteItem[] = [];
        for (const s of parcelas) {
          const brutoParcela =
            s?.media_valor != null
              ? Number(s.media_valor)
              : combinarRealizados(realizados, cat.codigos, year - 1)?.media ?? null;
          const proj = projetarMedia(brutoParcela, indicePercent(s?.indice_key ?? null));
          if (proj == null) continue;
          projetado += proj;
          // O item explica de onde saiu o número (média do realizado do
          // ano-base + índice aplicado). A média não tem sublinhas.
          const indiceNome = s?.indice_key
            ? INDICES.find((i) => i.key === s.indice_key)?.label ?? s.indice_key
            : null;
          itensMedia.push({
            nome: cat.category_name ?? cat.category_code,
            detalhe:
              [
                brutoParcela != null
                  ? `média ${formatBRLSimples(brutoParcela)}/mês em ${year - 1}`
                  : null,
                indiceNome ? `corrigida por ${indiceNome}` : "sem correção",
              ]
                .filter(Boolean)
                .join(" · ") + etiquetaSetor(s?.setor_id),
            // A média não tem id próprio — a linha pode nem existir enquanto o
            // gestor não salva. Por isso a chave é (categoria, setor).
            alvoTipo: "media_linha" as const,
            alvoId: chaveMedia(cat.category_code, s?.setor_id ?? null),
            setorId: s?.setor_id ?? null,
            atualizadoEm: s?.updated_at ?? null,
            meses: Array<number>(12).fill(proj),
            totalAno: proj * 12,
          });
        }
        if (projetado === 0) {
          mediaSemValor += 1;
          continue;
        }
        aplicar(
          cat.category_code,
          cat.category_name ?? cat.category_code,
          Array<number>(12).fill(projetado),
          "media",
          itensMedia,
        );
      }
    }

    // VALOR FIXO — valor base + índice, com o degrau do mês de reajuste.
    if (vfCats.length > 0) {
      const { data: vfRows, error: vfErr } = await supabase
        .from("orcamento_valor_fixo_categorias")
        .select("id, category_code, setor_id, valor_base, indice_key, mes_reajuste, descricao, updated_at")
        .eq("company_id", companyId)
        .eq("year", year);
      if (vfErr) {
        if (isSchemaMissing(vfErr.message)) return { needsMigration: true };
        return { error: vfErr.message };
      }
      // Uma categoria pode ter N contratos (linhas) — agrupa por código e SOMA
      // as séries de cada contrato antes de aplicar na linha da DRE.
      // Cada contrato tem o seu setor: filtrar aqui recorta a categoria sem
      // perder os contratos dos outros setores na visão consolidada.
      const vfByCode = new Map<string, ValorFixoSnapshotRow[]>();
      for (const r of (vfRows ?? []) as ValorFixoSnapshotRow[]) {
        if (filtroSetor && r.setor_id !== filtroSetor) continue;
        if (!vfByCode.has(r.category_code)) vfByCode.set(r.category_code, []);
        vfByCode.get(r.category_code)!.push(r);
      }
      const vfEscopo = noEscopo(vfCats, new Set(vfByCode.keys()));
      valorFixoCategorias = vfEscopo.length;
      for (const cat of vfEscopo) {
        const contratos = vfByCode.get(cat.category_code) ?? [];
        const meses = Array<number>(12).fill(0);
        const itensVf: PreviaFonteItem[] = [];
        for (const snap of contratos) {
          const base = snap.valor_base == null ? null : Number(snap.valor_base);
          if (base == null) continue;
          const mes = snap.mes_reajuste == null ? null : Number(snap.mes_reajuste);
          // O salário mínimo corrige por valor absoluto (unit 'brl'); os demais, %.
          const unit = INDICE_UNIT.get(snap.indice_key ?? "") ?? "percent";
          const serie = projetarValorFixoSerie(base, indicePercent(snap.indice_key ?? null), mes, unit);
          for (let m = 0; m < 12; m += 1) meses[m] += serie[m] ?? 0;
          const indiceNome = snap.indice_key
            ? INDICES.find((i) => i.key === snap.indice_key)?.label ?? snap.indice_key
            : null;
          itensVf.push({
            // Contrato único costuma vir sem descrição — cai no nome da categoria.
            nome: snap.descricao?.trim() || (cat.category_name ?? cat.category_code),
            alvoTipo: "valor_fixo_contrato" as const,
            alvoId: snap.id ?? "",
            setorId: snap.setor_id ?? null,
            atualizadoEm: snap.updated_at ?? null,
            detalhe:
              [
                `base ${formatBRLSimples(base)}`,
                indiceNome ? `${indiceNome}${mes ? ` em ${MESES_CURTO[mes - 1]}` : ""}` : "sem correção",
              ].join(" · ") + etiquetaSetor(snap.setor_id),
            meses: serie.slice(0, 12),
            totalAno: serie.reduce((a, b) => a + b, 0),
          });
        }
        // "Sem valor" quando nenhum contrato tem base (a soma zera).
        if (somar(meses) === 0) {
          valorFixoSemValor += 1;
          continue;
        }
        aplicar(cat.category_code, cat.category_name ?? cat.category_code, meses, "valor_fixo", itensVf);
      }
    }

    // PLANEJAMENTO DOS GESTORES — cada despesa é uma LINHA em
    // `orcamento_planejamento_despesas` (modelo de 23/09/2026). Antes o item
    // vivia dentro do jsonb `proposta` da categoria, e por isso o cancelamento
    // da diretoria tinha de ser lido de dentro do objeto (`itemPropostaAtivo`);
    // agora é a coluna `cancelado`, filtrada na própria consulta.
    //
    // NÃO existe mais "proposta confirmada": a despesa entra na Prévia assim que
    // o gestor confirma o cartão que a IA propôs. É o que faz a prévia do setor
    // se preencher durante a entrevista.
    //
    // O GRUPO da despesa vai junto e vira o subnível do drilldown (categoria ›
    // grupo › despesa).
    if (psCats.length > 0) {
      const { data: psRows, error: psErr } = await supabase
        .from("orcamento_planejamento_despesas")
        .select(
          "id, category_code, setor_id, descricao, valor, periodicidade, mes_inicio, mes_fim, updated_at, orcamento_grupos_despesa(name)",
        )
        .eq("company_id", companyId)
        .eq("year", year)
        .eq("cancelado", false);
      // Migration ainda não aplicada: não bloqueia a Prévia inteira (os demais
      // métodos continuam) — essas categorias só contam como "sem valor".
      if (psErr && !isSchemaMissing(psErr.message)) return { error: psErr.message };

      const psByCode = new Map<
        string,
        {
          descricao: string;
          valorMensal: number;
          mesInicio: number;
          mesFim: number | null;
          periodicidade: Periodicidade;
          grupo: string | null;
          /** Setor da despesa — só para rotular o drilldown. */
          setorId: string | null;
          id: string;
          atualizadoEm: string | null;
        }[]
      >();

      ((psRows ?? []) as Array<Record<string, unknown>>).forEach((r) => {
        const setorDaLinha = (r.setor_id as string | null) ?? null;
        // A despesa é de UM setor: filtrando, só entra a dele.
        if (filtroSetor && setorDaLinha !== filtroSetor) return;
        const valor = Number(r.valor);
        const mes = Number(r.mes_inicio);
        const fimRaw = r.mes_fim;
        const fim = fimRaw == null ? null : Number(fimRaw);
        const descricao =
          typeof r.descricao === "string" && r.descricao.trim() !== ""
            ? r.descricao.trim()
            : "Despesa sem descrição";
        const acumulado = psByCode.get(r.category_code as string) ?? [];
        acumulado.push({
          id: r.id as string,
          atualizadoEm: (r.updated_at as string | null) ?? null,
          setorId: setorDaLinha,
          descricao,
          valorMensal: Number.isFinite(valor) && valor > 0 ? valor : 0,
          mesInicio: Number.isFinite(mes) ? Math.min(12, Math.max(1, Math.round(mes))) : 1,
          mesFim:
            fim != null && Number.isFinite(fim) && fim >= 1 && fim <= 12 ? Math.round(fim) : null,
          periodicidade: toPeriodicidade(r.periodicidade),
          grupo:
            (r.orcamento_grupos_despesa as { name?: string } | null | undefined)?.name ?? null,
        });
        psByCode.set(r.category_code as string, acumulado);
      });

      const psEscopo = noEscopo(psCats, new Set(psByCode.keys()));
      planejamentoCategorias = psEscopo.length;
      for (const cat of psEscopo) {
        const itensProposta = psByCode.get(cat.category_code) ?? [];
        const meses = categoriaSerie(itensProposta);
        if (somar(meses) === 0) {
          planejamentoSemValor += 1;
          continue;
        }
        // Cada despesa vira uma linha do drilldown, com a própria série (a
        // periodicidade muda em quais meses ela cai).
        const itensPs: PreviaFonteItem[] = itensProposta
          .map((it) => {
            const serie = serieItem(it.valorMensal, it.mesInicio, it.periodicidade, it.mesFim);
            const ate =
              it.periodicidade !== "anual" && it.mesFim != null && it.mesFim < 12
                ? ` até ${MESES_CURTO[it.mesFim - 1]}`
                : "";
            return {
              nome: it.descricao,
              grupo: it.grupo,
              alvoTipo: "planejamento_item" as const,
              alvoId: it.id,
              setorId: it.setorId,
              atualizadoEm: it.atualizadoEm,
              detalhe: `${formatBRLSimples(it.valorMensal)} ${periodicidadeLabel(it.periodicidade)} · a partir de ${MESES_CURTO[it.mesInicio - 1]}${ate}${etiquetaSetor(it.setorId)}`,
              meses: serie,
              totalAno: serie.reduce((a, b) => a + b, 0),
            };
          })
          .filter((i) => i.totalAno !== 0)
          .sort((a, b) => b.totalAno - a.totalAno);
        aplicar(
          cat.category_code,
          cat.category_name ?? cat.category_code,
          meses,
          "planejamento_socios",
          itensPs,
        );
      }

      // Proposta gravada numa gêmea "(*)" que a canônica substituiu: não entra
      // no orçamento, mas é reportada para o número não sumir calado.
      for (const cat of gemeasIgnoradas.filter((c) => c.metodo === "planejamento_socios")) {
        const meses = categoriaSerie(psByCode.get(cat.category_code) ?? []);
        if (somar(meses) === 0) continue;
        planejamentoGemeaIgnorada.push({
          chave: cat.category_name ?? cat.category_code,
          meses,
          totalAno: somar(meses),
        });
      }
    }

    // ── VIAGENS ───────────────────────────────────────────────────────────────
    // Cada viagem ENVIADA é um item do drilldown; rascunho não entra — ainda não
    // é orçamento, e um roteiro pela metade somando no total da empresa seria
    // pior do que nada.
    //
    // O valor vem do RETRATO gravado (`meses`), nunca de um recálculo aqui. É o
    // que mantém a Prévia, a tela da viagem e o que o diretor aprovou dizendo o
    // MESMO número — e a razão de o custo ser calculado na gravação.
    if (viagensCats.length > 0) {
      const { data: vRows, error: vErr } = await supabase
        .from("orcamento_viagens")
        .select("id, category_code, setor_id, titulo, data_ida, pessoas, meses, updated_at")
        .eq("company_id", companyId)
        .eq("year", year)
        .eq("status", "enviada");
      // Migration ainda não aplicada: não derruba a Prévia, essas categorias só
      // contam como "sem valor" (mesma tolerância dos outros métodos).
      if (vErr && !isSchemaMissing(vErr.message)) return { error: vErr.message };

      const viagensByCode = new Map<string, PreviaFonteItem[]>();
      for (const r of (vRows ?? []) as Array<Record<string, unknown>>) {
        const setorDaViagem = (r.setor_id as string | null) ?? null;
        // A viagem é de UM setor: filtrando, só entra a dele.
        if (filtroSetor && setorDaViagem !== filtroSetor) continue;
        const meses = mesesDoRetrato(r.meses);
        const total = somar(meses);
        if (total === 0) continue;

        const pessoas = Number(r.pessoas);
        const quantas = Number.isFinite(pessoas) ? Math.max(1, Math.round(pessoas)) : 1;
        const data = typeof r.data_ida === "string" ? r.data_ida : "";
        const mes = /^\d{4}-(\d{2})-\d{2}$/.exec(data)?.[1];
        const quando = mes ? ` · ${MESES_CURTO[Number(mes) - 1]}` : "";
        const titulo =
          typeof r.titulo === "string" && r.titulo.trim() !== ""
            ? r.titulo.trim()
            : "Viagem sem título";

        const code = (r.category_code as string) ?? "";
        const lista = viagensByCode.get(code) ?? [];
        lista.push({
          nome: titulo,
          alvoTipo: "viagem",
          alvoId: r.id as string,
          setorId: setorDaViagem,
          atualizadoEm: (r.updated_at as string | null) ?? null,
          detalhe: `${quantas} pessoa(s)${quando}${etiquetaSetor(setorDaViagem)}`,
          meses,
          totalAno: total,
        });
        viagensByCode.set(code, lista);
      }

      const viagensEscopo = noEscopo(viagensCats, new Set(viagensByCode.keys()));
      viagensCategorias = viagensEscopo.length;
      for (const cat of viagensEscopo) {
        const itens = (viagensByCode.get(cat.category_code) ?? []).sort(
          (a, b) => b.totalAno - a.totalAno,
        );
        if (itens.length === 0) {
          viagensSemValor += 1;
          continue;
        }
        // A série da categoria é a soma das viagens dela, mês a mês.
        const meses = Array<number>(12).fill(0);
        for (const it of itens) {
          for (let m = 0; m < 12; m += 1) meses[m] += it.meses[m] ?? 0;
        }
        aplicar(cat.category_code, cat.category_name ?? cat.category_code, meses, "viagens", itens);
      }
    }
  }

  // ── PESSOAL ─────────────────────────────────────────────────────────────────
  // Sem filtro, a empresa inteira (SETOR_TODOS) — é o número que vai para a
  // DRE. Com um setor, só os colaboradores dele; quem está no quadro sem setor
  // não aparece em setor nenhum, e por isso a soma dos setores pode ficar
  // abaixo de "Todos" nas linhas de pessoal (a tela avisa).
  const previaRes = await getPrevia(companyId, year, {
    setorId: filtroSetor ?? SETOR_TODOS,
    detalharColaboradores: true,
  });
  if (previaRes.needsMigration) return { needsMigration: true };
  // O ERRO DO PESSOAL NÃO PODE SUMIR. Ele era engolido aqui: a prévia seguia
  // sem a folha inteira, com um total menor e nenhuma explicação — exatamente
  // o tipo de número que leva à decisão errada. Falhar a Prévia inteira
  // também não serve (o resto dela está correto e é útil), então o motivo
  // sobe até a tela, que o mostra em faixa.
  const pessoalIndisponivel = previaRes.error ?? null;
  const pessoalColaboradores = previaRes.payload?.totalColaboradores ?? 0;
  if (previaRes.payload && previaRes.payload.totalColaboradores > 0) {
    // Mapeamento rótulo → conta (as "Linhas do Orçamento").
    const { data: labelRows, error: labelErr } = await supabase
      .from("budget_account_mappings")
      .select("label, dre_account_id")
      .eq("company_id", companyId);
    if (labelErr) return { error: labelErr.message };
    const accountByLabel = new Map<string, string | null>(
      (labelRows ?? []).map((r) => [r.label as string, (r.dre_account_id as string | null) ?? null]),
    );

    for (const linha of previaRes.payload.previa.linhas) {
      const rotulo = rotuloOrcamento(linha.label);
      const rawAccountId = accountByLabel.get(rotulo) ?? null;
      const scopedId = rawAccountId ? scope.translateToScopedId(rawAccountId) : null;
      // Mesma guarda da média/valor fixo: sem conta, ou fora da faixa core → órfão.
      if (!scopedId || !coreIds.has(scopedId)) {
        pessoalNaoClassificado.push({
          chave: linha.label,
          meses: linha.meses,
          totalAno: somar(linha.meses),
        });
        continue;
      }
      pushMeses(leafByScopedId, scopedId, linha.meses);
      // (o aprovado é somado logo abaixo, depois de montar os itens)
      // Abertura: quanto cada colaborador contribui NESTA linha (o salário
      // dele, o INSS dele…). Só quem tem valor na linha entra.
      const itensPessoal: PreviaFonteItem[] = (previaRes.payload.porColaborador ?? [])
        .map((colab): PreviaFonteItem | null => {
          const dele = colab.linhas.find((l) => l.key === linha.key);
          if (!dele || dele.totalAno === 0) return null;
          return {
            nome: colab.nome?.trim() || "Sem nome",
            detalhe: vinculoLabel(colab.vinculo) + etiquetaSetor(colab.setorId),
            // O MESMO colaborador aparece em várias linhas (Salários, Encargos,
            // Benefícios). Como a chave é o id dele, um ✓ marca todas de uma
            // vez: o diretor aprova a PESSOA, não três linhas dela.
            alvoTipo: "colaborador" as const,
            alvoId: colab.id,
            setorId: colab.setorId ?? null,
            atualizadoEm: colab.atualizadoEm ?? null,
            meses: dele.meses,
            totalAno: dele.totalAno,
          };
        })
        .filter((x): x is PreviaFonteItem => x != null)
        .sort((a, b) => b.totalAno - a.totalAno);
      const aprovadosPessoal = marcarEAprovar(itensPessoal);
      pushMeses(leafAprovadoByScopedId, scopedId, aprovadosPessoal);
      pushFonte(scopedId, {
        metodo: "pessoal",
        metodoLabel: metodoLabel("pessoal"),
        chave: linha.label,
        // Vazio: no pessoal a fatia finalizável é o quadro do SETOR inteiro —
        // salários, encargos e benefícios saem juntos, porque o motor é linear
        // por colaborador e fechar uma linha só publicaria pedaço de gente.
        categoryCode: CATEGORIA_METODO_INTEIRO,
        meses: linha.meses,
        totalAno: somar(linha.meses),
        mesesAprovados: aprovadosPessoal,
        totalAnoAprovado: somar(aprovadosPessoal),
        href: workspaceTabHref(companyId, year, "pessoal"),
        itens: itensPessoal,
      });
    }
  }

  // ── Monta a DRE mês a mês reusando o motor do Dashboard ─────────────────────
  // Fórmulas são lineares (só +/-), então avaliar por mês e somar = avaliar
  // sobre o total do ano. Rodamos 12 vezes para ter a coluna de cada mês.
  const perMonthRows: DashboardRow[][] = [];
  // A árvore do APROVADO roda pelo mesmo motor: as fórmulas das linhas
  // calculadas (4/6/8/11) precisam ser avaliadas sobre o subconjunto, não
  // recortadas depois — margem de um orçamento meio aprovado não é a margem
  // cheia multiplicada por nada.
  const perMonthRowsAprovado: DashboardRow[][] = [];
  for (let m = 0; m < 12; m += 1) {
    const amounts = new Map<string, number>();
    leafByScopedId.forEach((arr, id) => {
      if (arr[m] !== 0) amounts.set(id, arr[m]);
    });
    perMonthRows.push(buildDashboardRows(scope.coreAccounts, amounts).rows);

    const aprovados = new Map<string, number>();
    leafAprovadoByScopedId.forEach((arr, id) => {
      if (arr[m] !== 0) aprovados.set(id, arr[m]);
    });
    perMonthRowsAprovado.push(buildDashboardRows(scope.coreAccounts, aprovados).rows);
  }

  // ── Fontes por linha ───────────────────────────────────────────────────────
  // A folha tem as suas; a totalizadora herda as dos descendentes, para o
  // drilldown funcionar também num nível agregado. Linha CALCULADA (fórmula)
  // fica de fora: ela combina outras linhas com sinais, e listar origens ali
  // sugeriria uma soma simples que não é o que a fórmula faz.
  const filhosPorPai = new Map<string, string[]>();
  for (const conta of scope.coreAccounts) {
    if (!conta.parent_id) continue;
    const lista = filhosPorPai.get(conta.parent_id) ?? [];
    lista.push(conta.id);
    filhosPorPai.set(conta.parent_id, lista);
  }
  const fontesMemo = new Map<string, PreviaFonte[]>();
  const coletarFontes = (id: string): PreviaFonte[] => {
    const pronto = fontesMemo.get(id);
    if (pronto) return pronto;
    const acc = [...(fontesByScopedId.get(id) ?? [])];
    for (const filho of filhosPorPai.get(id) ?? []) acc.push(...coletarFontes(filho));
    // Maior contribuição primeiro: é o que o leitor quer ver de cara.
    acc.sort((a, b) => b.totalAno - a.totalAno);
    fontesMemo.set(id, acc);
    return acc;
  };

  const base = perMonthRows[0] ?? [];
  const linhas: PreviaDreLinha[] = base.map((row, i) => {
    const meses = perMonthRows.map((rows) => rows[i]?.value ?? 0);
    const mesesAprovados = perMonthRowsAprovado.map((rows) => rows[i]?.value ?? 0);
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      level: row.level,
      type: row.type,
      isSummary: row.is_summary,
      isCalculado: row.type === "calculado",
      isReceita: row.type === "receita",
      hasChildren: row.hasChildren,
      meses,
      totalAno: somar(meses),
      mesesAprovados,
      totalAnoAprovado: somar(mesesAprovados),
      fontes: row.type === "calculado" ? [] : coletarFontes(row.id),
    };
  });

  const temReceita = linhas.some((l) => l.isReceita);
  const folhas = (l: PreviaDreLinha) => l.type === "despesa" && !l.hasChildren;
  const totalDespesa = linhas.filter(folhas).reduce((s, l) => s + l.totalAno, 0);
  // O par que a tela mostra lado a lado: o que o gestor montou e o que a
  // diretoria já aprovou. Um total menor sem dizer o que ficou de fora é o
  // tipo de número que leva à decisão errada.
  const totalDespesaAprovada = linhas
    .filter(folhas)
    .reduce((s, l) => s + l.totalAnoAprovado, 0);
  // Sem repetição: o mesmo colaborador aparece em Salários, Encargos e
  // Benefícios, e tem UM ✓ só — contar por linha triplicaria a pendência.
  const alvosPendentes = new Set<string>();
  linhas
    .filter(folhas)
    .flatMap((l) => l.fontes.flatMap((f) => f.itens))
    .forEach((i) => {
      if (!i.alvoTipo || !i.alvoId) return;
      if (i.estado == null || i.estado === "aprovado") return;
      alvosPendentes.add(`${i.alvoTipo}|${i.alvoId}`);
    });
  const itensPendentes = alvosPendentes.size;
  const totalReceita = linhas
    .filter((l) => l.isReceita && !l.hasChildren)
    .reduce((s, l) => s + l.totalAno, 0);

  return {
    data: {
      linhas,
      pessoalNaoClassificado,
      categoriasNaoMapeadas,
      planejamentoGemeaIgnorada,
      resumo: {
        temReceita,
        mediaCategorias,
        mediaSemValor,
        valorFixoCategorias,
        valorFixoSemValor,
        planejamentoCategorias,
        planejamentoSemValor,
        viagensCategorias,
        viagensSemValor,
        pessoalColaboradores,
        pessoalIndisponivel,
        totalDespesa,
        totalDespesaAprovada,
        itensPendentes,
        podeValidar: podeDecidir(user.papel),
        totalReceita,
      },
    },
  };
}
