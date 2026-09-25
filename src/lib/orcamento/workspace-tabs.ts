// =============================================================================
// Abas do workspace do orçamento (empresa × ano).
//
// O módulo passou a ser organizado POR EMPRESA: o analista escolhe a empresa +
// ano no painel e trabalha em todas as telas daquela empresa como abas, sem
// reselecionar a empresa a cada troca (era a causa de preencher o orçamento na
// empresa errada). Cada aba é uma sub-rota de
// `/orcamento/empresa/[companyId]/[ano]/[slug]`.
//
// Este é o índice único das abas — o painel, o cabeçalho do workspace e as
// rotas leem daqui. Fase 1 traz só as telas de "montagem" (despesas); as de
// configuração por empresa entram como grupo próprio numa fase seguinte.
// =============================================================================

export type WorkspaceTabGroup = "montagem" | "config";

export interface WorkspaceTab {
  /** Último segmento da rota (`/orcamento/empresa/<id>/<ano>/<slug>`). */
  slug: string;
  /** Rótulo curto exibido na barra de abas. */
  label: string;
  group: WorkspaceTabGroup;
}

export const WORKSPACE_TABS: readonly WorkspaceTab[] = [
  { slug: "pessoal", label: "Despesas com pessoal", group: "montagem" },
  { slug: "media", label: "Média com correção", group: "montagem" },
  // slug = chave do método (metodos.ts): o hub linka via workspaceTabHref(m.key).
  { slug: "valor_fixo", label: "Valor fixo com correção", group: "montagem" },
  { slug: "planejamento_socios", label: "Planejamento dos gestores", group: "montagem" },
] as const;

/** Primeira aba — destino padrão ao abrir o orçamento de uma empresa. */
export const WORKSPACE_DEFAULT_TAB = WORKSPACE_TABS[0].slug;

/** True se o método tem tela construída (= existe aba com esse slug). */
export function isWorkspaceTabBuilt(slug: string): boolean {
  return WORKSPACE_TABS.some((t) => t.slug === slug);
}

/**
 * Hub da empresa: a tela de "caixas" (`/orcamento/empresa/[companyId]/[ano]`)
 * onde o analista escolhe o método de orçamento. É o pouso ao selecionar a
 * empresa no painel.
 */
export function workspaceHubHref(companyId: string, year: number): string {
  return `/orcamento/empresa/${companyId}/${year}`;
}

/** Monta a URL de uma aba/módulo para uma empresa × ano. */
export function workspaceTabHref(companyId: string, year: number, slug: string): string {
  return `/orcamento/empresa/${companyId}/${year}/${slug}`;
}

// A VALIDAÇÃO SAIU DO SISTEMA em 24/09/2026 e será redesenhada. Ela vivia
// DENTRO das telas de método (barra no topo, visto linha a linha, cancelar e
// pedir ajuste) — não havia rota própria, e uma tela consolidada chegou a
// existir antes disso e foi removida por duplicar a Prévia. Vale lembrar disso
// ao desenhar a próxima: a decisão de ficar junto do dado era deliberada.

/**
 * URL da tela de MONTAGEM de uma categoria no Planejamento dos gestores.
 *
 * O código da categoria vem da Omie ("2.01.04") e vai como segmento de rota —
 * `encodeURIComponent` porque nada garante que um código não traga barra ou
 * espaço, e aí a rota quebraria em silêncio (viraria outro segmento).
 */
export function planejamentoCategoriaHref(
  companyId: string,
  year: number,
  categoryCode: string,
): string {
  return `/orcamento/empresa/${companyId}/${year}/planejamento_socios/${encodeURIComponent(categoryCode)}`;
}

// A rota do RETORNO da diretoria saiu com a validação em 24/09/2026 (será
// redesenhada). O ciclo e a trilha ficaram — o que não existe mais é a tela.

/**
 * URL da Prévia do orçamento — a DRE da empresa preenchida com os valores
 * orçados. Não é um método (não entra em WORKSPACE_TABS); é a leitura do
 * resultado, com rota própria.
 */
export function workspacePreviaHref(companyId: string, year: number): string {
  return `/orcamento/empresa/${companyId}/${year}/previa`;
}

// ─── Configurações GERAIS do módulo (fora do workspace da empresa) ───────────
// O que NÃO é por empresa, ou o que precisa da empresa como FILTRO em vez de
// contexto fixo. Mesmo padrão de caixas do sub-hub da empresa, um nível acima.

export interface ConfigGeralSecao {
  slug: string;
  label: string;
  desc: string;
}

export const CONFIG_GERAIS_SECOES: readonly ConfigGeralSecao[] = [
  {
    slug: "indices",
    label: "Índices de correção",
    desc: "IPCA, IGP-M, salário mínimo e demais índices por ano, para todas as empresas.",
  },
] as const;

export function isConfigGeralSecao(slug: string): boolean {
  return CONFIG_GERAIS_SECOES.some((s) => s.slug === slug);
}

/** URL do hub das Configurações gerais. */
export function configGeraisHref(): string {
  return "/orcamento/configuracoes-gerais";
}

/** URL de uma seção das Configurações gerais. */
export function configGeraisSecaoHref(secao: string): string {
  return `/orcamento/configuracoes-gerais/${secao}`;
}

// ─── Configuração da empresa (subárea dentro do workspace) ───────────────────
// A caixa "Configuração" do hub abre um sub-hub com estas seções. São as telas
// de config POR EMPRESA; os "Índices de correção" são GLOBAIS e ficam fora daqui
// (em Configurações gerais). Empresa + ano vêm da rota, iguais ao resto.

export interface ConfigSecao {
  slug: string;
  label: string;
  desc: string;
}

export const CONFIG_SECOES: readonly ConfigSecao[] = [
  {
    slug: "orcar-por-setor",
    label: "Orçar por setor",
    desc: "Detalhar o orçamento por setor ou só por categoria.",
  },
  {
    slug: "setores",
    label: "Setores",
    desc: "Cadastro dos setores de orçamento desta empresa.",
  },
  {
    slug: "categoria-metodo",
    label: "Método por categoria",
    desc: "Por qual método cada categoria de despesa é orçada.",
  },
  {
    slug: "grupos-despesa",
    label: "Grupos de despesas",
    desc: "O nível entre a categoria e a despesa, por setor e categoria.",
  },
  {
    slug: "plano-cargos",
    label: "Plano de cargos",
    desc: "Cargos, níveis e salários-base do quadro de pessoal.",
  },
  {
    slug: "empresa-encargos",
    label: "Empresa dos encargos",
    desc: "Coluna Empresa no quadro, para gente registrada em outro CNPJ.",
  },
  {
    slug: "encargos",
    label: "Encargos sobre a folha",
    desc: "INSS, RAT×FAP, terceiros e FGTS sobre a folha.",
  },
] as const;

export function isConfigSecao(slug: string): boolean {
  return CONFIG_SECOES.some((s) => s.slug === slug);
}

/** URL do sub-hub de Configuração da empresa. */
export function workspaceConfigHref(companyId: string, year: number): string {
  return `/orcamento/empresa/${companyId}/${year}/config`;
}

/** URL de uma seção de Configuração da empresa. */
export function workspaceConfigSecaoHref(companyId: string, year: number, secao: string): string {
  return `/orcamento/empresa/${companyId}/${year}/config/${secao}`;
}
