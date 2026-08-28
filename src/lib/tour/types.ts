// Tipos e resolvedores do tour guiado. Módulo PURO de dados: sem imports de
// React, sem "use server" — é o que permite o conteúdo ser lido por qualquer
// camada sem carregar o app.
//
// O CONTEÚDO não mora aqui: cada módulo tem o seu arquivo (financeiro.ts,
// compras.ts) e o index.ts junta os dois.

/** Lado preferido do balão em relação ao elemento destacado. */
export type TourPlacement = "top" | "bottom" | "left" | "right" | "center";

/**
 * Perfil do usuário, para os passos que mudam de significado conforme quem lê.
 *
 * Espelha `UserProfileType` apenas nos perfis que operam os módulos com tour.
 * "gerente" é o **Gerente Sócio** e "gerente_setor" é o **Gerente** — os dois
 * têm as MESMAS permissões de Compras (ver deriveCtrlRoles em auth/session.ts);
 * ficam separados aqui porque a tela de Orçamento recorta por setor só para o
 * segundo, e é a única diferença que o usuário percebe.
 */
export type TourAudience =
  | "solicitante"
  | "gerente"
  | "gerente_setor"
  | "diretor"
  | "contas_a_pagar"
  | "admin";

export interface TourStep {
  /**
   * Valor do atributo `data-tour` do elemento a destacar.
   * `null` = passo sem âncora: o balão aparece centralizado, com a tela
   * inteira escurecida (usado nas aberturas de cada tela e para explicar o
   * fluxo, que não é um botão).
   */
  anchor: string | null;
  title: string;
  body: string;
  placement?: TourPlacement;
  /**
   * Perfis para quem o passo faz sentido. Ausente = todos.
   *
   * É para VARIAÇÃO DE CONTEÚDO ("você só vê as suas" × "você vê as do seu
   * setor"), não para controle de acesso — quem decide se a tela entra no
   * roteiro é o `navKey` abaixo, lido do menu real. Quando um passo tem
   * variantes, liste `admin` na variante que é verdadeira para ele, senão o
   * admin fica sem nenhuma.
   */
  audiences?: readonly TourAudience[];
}

export interface TourScreen {
  id: string;
  /** Nome da tela como aparece no menu (usado no botão "ir para a próxima"). */
  label: string;
  /**
   * Como a rota é montada:
   * - "global": `path` é a rota exata.
   * - "segment": `path` é o sufixo servido em `/s/<slug><path>` (e também
   *   aceito na forma curta `<path>` — ver FRANQUEADO_BASE_PATHS em access.ts).
   */
  scope: "global" | "segment";
  path: string;
  /**
   * Chave do item correspondente no menu (`navigation.ts`).
   *
   * É o gate de acesso da tela no roteiro, e de propósito NÃO é uma lista de
   * perfis escrita à mão: o provider recebe as chaves que o menu daquele
   * usuário realmente montou, então mexer na permissão de uma tela leva o tour
   * junto, sem ninguém lembrar de atualizar dois lugares. Telas fora do menu
   * (a /home, o formulário de nova requisição) repetem a chave da tela de que
   * dependem, ou omitem o campo quando são de todos.
   */
  navKey?: string;
  steps: readonly TourStep[];
}

export type TourModuleId = "financeiro" | "compras";

export interface TourModule {
  id: TourModuleId;
  /** Grupo do menu onde o botão do tour é renderizado (ver NAV_GROUPS). */
  navGroupId: string;
  /** Nome do módulo em texto corrido ("do módulo Compras"). */
  label: string;
  screens: readonly TourScreen[];
}

/**
 * Versão do tour. Subir este número faz TODO MUNDO ver o tour de novo —
 * a marca de "já vi" no localStorage é gravada com a versão embutida.
 * Suba apenas quando o conteúdo mudar a ponto de valer reapresentar.
 */
export const TOUR_VERSION = 1;

/** Chave do localStorage que marca um módulo como já visto por este usuário. */
export function tourStorageKey(userKey: string, moduleId: TourModuleId): string {
  return `ch-tour-v${TOUR_VERSION}:${moduleId}:${userKey}`;
}

/**
 * Descobre qual tela do módulo corresponde à rota atual.
 *
 * As telas por segmento são servidas em duas formas — `/s/<slug>/dashboard`
 * (o que o menu monta) e `/dashboard` (aceito em access.ts) — então a
 * comparação é por SUFIXO, nunca por igualdade da rota inteira. As globais
 * casam por igualdade exata, o que mantém `/ctrl/requisicoes/nova` distinta de
 * `/ctrl/requisicoes`.
 */
export function resolveScreenInModule(
  tourModule: TourModule,
  pathname: string,
): TourScreen | null {
  const clean = pathname.replace(/\/+$/, "") || "/";
  for (const screen of tourModule.screens) {
    if (screen.scope === "global") {
      if (clean === screen.path) return screen;
      continue;
    }
    if (clean === screen.path) return screen;
    if (clean.startsWith("/s/") && clean.endsWith(screen.path)) return screen;
  }
  return null;
}

/** Monta o link da tela, respeitando o segmento ativo. */
export function tourHref(screen: TourScreen, segmentSlug: string | null): string | null {
  if (screen.scope === "global") return screen.path;
  if (!segmentSlug) return screen.path;
  return `/s/${segmentSlug}${screen.path}`;
}
