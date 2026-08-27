// Conteúdo do tour guiado do módulo Financeiro (Control Hub).
//
// FONTE ÚNICA: esta é a única definição dos passos. O tour de primeiro acesso e
// o botão "?" da topbar ("Como usar esta tela") leem exatamente estes blocos —
// não escreva o texto do tour em nenhum outro lugar, senão as duas entradas
// divergem em silêncio.
//
// Módulo PURO de dados: sem imports, sem "use server", sem React. É o que
// permite o conteúdo ser lido por qualquer camada (client, script de doc)
// sem carregar o app.
//
// ⚠️ AO MUDAR UM BOTÃO DE TELA FINANCEIRA (renomear, remover, mover), atualize
//    o passo correspondente aqui E o `data-tour` no componente. Passo cujo
//    elemento não existe é PULADO em silêncio (ver resolveVisibleSteps) — o
//    tour não quebra, mas some do roteiro sem ninguém perceber.

/** Lado preferido do balão em relação ao elemento destacado. */
export type TourPlacement = "top" | "bottom" | "left" | "right" | "center";

export interface TourStep {
  /**
   * Valor do atributo `data-tour` do elemento a destacar.
   * `null` = passo sem âncora: o balão aparece centralizado, com a tela
   * inteira escurecida (usado nas aberturas de cada tela).
   */
  anchor: string | null;
  title: string;
  body: string;
  placement?: TourPlacement;
}

export type TourScreenId =
  | "home"
  | "dre"
  | "fluxo"
  | "budget"
  | "bi"
  | "documentos"
  | "comparativos";

export interface TourScreen {
  id: TourScreenId;
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
  steps: readonly TourStep[];
}

/**
 * Versão do tour. Subir este número faz TODO MUNDO ver o tour de novo —
 * a marca de "já vi" no localStorage é gravada com a versão embutida.
 * Suba apenas quando o módulo mudar a ponto de valer reapresentar.
 */
export const TOUR_VERSION = 1;

/**
 * Telas na ORDEM DO MENU do grupo FINANCEIRO (ver NAV_GROUPS em
 * components/app/navigation.ts), limitadas ao que TODO usuário do módulo
 * enxerga — as telas admin (Mapeamento, Lançamentos manuais, Configurações) e a
 * Validação Relatório, de whitelist própria, ficam de fora de propósito: o tour
 * é a mesma apresentação para todo mundo. A Home não é item de menu, mas é o
 * pouso de todos os perfis e por isso abre a sequência.
 */
export const TOUR_SCREENS: readonly TourScreen[] = [
  {
    id: "home",
    label: "Início",
    scope: "global",
    path: "/home",
    steps: [
      {
        anchor: null,
        title: "Bem-vindo ao Control Hub",
        body:
          "Este é um passeio rápido pelo módulo Financeiro — leva uns 3 minutos e mostra o que cada botão faz. Você pode sair quando quiser em “Pular tour” e retomar depois pelo “?” no topo da tela.",
      },
      {
        anchor: "nav-menu",
        title: "O menu lateral",
        body:
          "As telas ficam agrupadas por módulo. Em FINANCEIRO estão DRE Gerencial, Fluxo de Caixa, Budget e Forecast, Business Intelligence, Documentos anexos e Comparativos Anuais — as seis que este tour percorre. Se o seu acesso incluir outras telas ou módulos, eles aparecem aqui também.",
        placement: "right",
      },
      {
        anchor: "home-indicadores",
        title: "Indicadores econômicos",
        body:
          "Dólar, Selic, IPCA e afins, atualizados automaticamente. É informação de mercado — não vem da sua operação.",
        placement: "top",
      },
      {
        anchor: "home-noticias",
        title: "Notícias econômicas",
        body: "Manchetes do dia. Clicar abre a matéria na fonte original, em outra aba.",
        placement: "top",
      },
      {
        anchor: "topbar-tema",
        title: "Tema claro ou escuro",
        body: "Alterna a aparência do sistema. A escolha fica salva no seu navegador.",
        placement: "bottom",
      },
      {
        anchor: "topbar-ajuda",
        title: "Este botão traz o tour de volta",
        body:
          "Em qualquer tela do Financeiro, o “?” reabre a explicação daquela tela. Não precisa decorar nada agora.",
        placement: "bottom",
      },
    ],
  },
  {
    id: "dre",
    label: "DRE Gerencial",
    scope: "segment",
    path: "/dashboard",
    steps: [
      {
        anchor: null,
        title: "DRE Gerencial",
        body:
          "O resultado do período, linha a linha do plano de contas, com uma coluna por mês e o acumulado no fim. É a tela mais usada do módulo.",
      },
      {
        anchor: "sync-status",
        title: "Até quando os dados estão atualizados",
        body:
          "Mostra quando foi a última sincronização com o Omie. Se aparecer em destaque, os números podem estar defasados.",
        placement: "bottom",
      },
      {
        anchor: "filtro-empresa",
        title: "Segmento e empresas",
        body:
          "Escolhe o segmento e quais empresas entram no cálculo. Selecionar mais de uma soma tudo num consolidado — e libera a visão “Comparativo entre empresas”, que abre uma coluna por empresa. Esta escolha te acompanha nas outras telas.",
        placement: "right",
      },
      {
        anchor: "filtro-periodo",
        title: "Período",
        body:
          "Mês atual, ano atual ou um intervalo específico. Em “Período específico” aparecem os campos De e Até para escolher mês e ano.",
        placement: "bottom",
      },
      {
        anchor: "btn-aplicar",
        title: "Aplicar",
        body:
          "Os filtros só valem depois de clicar aqui. Se mudou o período e a tabela não mexeu, foi este clique que faltou.",
        placement: "bottom",
      },
      {
        anchor: "btn-expandir",
        title: "Expandir e recolher todas as linhas",
        body:
          "Abre ou fecha o plano de contas inteiro de uma vez. Linha a linha, a setinha ao lado do nome faz o mesmo só naquele grupo.",
        placement: "right",
      },
      {
        anchor: "tabela",
        title: "Clique em um valor para ver a origem",
        body:
          "Clicar na célula de um mês abre o drill-down: a lista dos lançamentos que formam aquele número, com data, descrição, fornecedor e unidade. Lá dentro dá para buscar por texto e exportar a lista em Excel.",
        placement: "top",
      },
      {
        anchor: "btn-exportar",
        title: "Exportar",
        body:
          "Baixa a tabela como está na tela — em Excel, para continuar a análise, ou em PDF, para enviar.",
        placement: "bottom",
      },
    ],
  },
  {
    id: "fluxo",
    label: "Fluxo de Caixa",
    scope: "segment",
    path: "/fluxo-de-caixa",
    steps: [
      {
        anchor: null,
        title: "Fluxo de Caixa",
        body:
          "Entradas e saídas do período pela data de movimentação do dinheiro. A estrutura é o plano de fluxo de caixa, que não é o mesmo do DRE — por isso os dois totais não precisam bater.",
      },
      {
        anchor: "filtro-empresa",
        title: "Segmento e empresas",
        body:
          "Mesma seleção do DRE — ela te segue entre as telas. Mais de uma empresa selecionada soma tudo num consolidado.",
        placement: "right",
      },
      {
        anchor: "filtro-periodo",
        title: "Período e Aplicar",
        body:
          "Escolha o intervalo e clique em “Aplicar” para a tabela recarregar. Sem o Aplicar, o filtro não vale.",
        placement: "bottom",
      },
      {
        anchor: "btn-expandir",
        title: "Expandir e recolher todas as linhas",
        body: "Abre ou fecha todos os grupos do fluxo de uma vez.",
        placement: "right",
      },
      {
        anchor: "tabela",
        title: "Clique em um valor para ver a origem",
        body:
          "Como no DRE, clicar na célula do mês abre a lista de lançamentos daquele valor — com busca e exportação em Excel.",
        placement: "top",
      },
      {
        anchor: "btn-exportar",
        title: "Exportar",
        body: "Baixa o fluxo do período em Excel, do jeito que está na tela.",
        placement: "bottom",
      },
    ],
  },
  {
    id: "budget",
    label: "Budget e Forecast",
    scope: "segment",
    path: "/budget-forecast",
    steps: [
      {
        anchor: null,
        title: "Budget e Forecast",
        body: "Aqui o orçamento encontra o realizado: quanto foi planejado, quanto aconteceu e como o ano deve terminar.",
      },
      {
        anchor: "bf-abas",
        title: "As quatro visões",
        body:
          "“Orçamento Anual” mostra o planejado; “Previsto x Realizado” compara com o que aconteceu; “Projeção” completa o ano com o orçamento dos meses que faltam; “Comparativo entre Empresas” põe uma empresa por coluna.",
        placement: "bottom",
      },
      {
        anchor: "filtro-empresa",
        title: "Segmento e empresas",
        body: "Mesma seleção das outras telas — o consolidado soma as empresas marcadas.",
        placement: "right",
      },
      {
        anchor: "filtro-periodo",
        title: "Período e Aplicar",
        body: "Define o intervalo e recarrega os números. Nada muda antes do “Aplicar”.",
        placement: "bottom",
      },
      {
        anchor: "btn-expandir",
        title: "Expandir e recolher todas as linhas",
        body: "Abre ou fecha o plano inteiro de uma vez.",
        placement: "right",
      },
      {
        anchor: "tabela",
        title: "O realizado também tem drill-down",
        body:
          "Nas colunas de realizado, clicar no valor abre a lista dos lançamentos que o formam. As colunas de orçamento não abrem — elas vêm do planejamento, não de lançamentos.",
        placement: "top",
      },
    ],
  },
  {
    id: "bi",
    label: "Business Intelligence",
    scope: "global",
    path: "/financeiro/business-intelligence",
    steps: [
      {
        anchor: null,
        title: "Business Intelligence",
        body:
          "Gera um relatório de uma página com a leitura do mês: os indicadores da empresa e uma análise escrita por inteligência artificial em cima dos seus próprios números.",
      },
      {
        anchor: "bi-empresa",
        title: "Empresa",
        body: "O relatório é sempre de UMA empresa por vez — não há consolidado aqui.",
        placement: "bottom",
      },
      {
        anchor: "bi-datas",
        title: "Data inicial e data final",
        body: "O período que o relatório vai analisar. O uso normal é o mês fechado, do dia 1 ao último dia.",
        placement: "bottom",
      },
      {
        anchor: "bi-gerar",
        title: "Gerar relatório",
        body:
          "Monta o relatório na hora. Leva alguns segundos, porque busca os dados e escreve a análise. Nada é gerado antes deste clique.",
        placement: "bottom",
      },
      {
        anchor: "bi-pdf",
        title: "Exportar PDF",
        body: "Salva o relatório que está na tela como um PDF de uma página A4, pronto para enviar.",
        placement: "bottom",
      },
      {
        anchor: "bi-historico",
        title: "Histórico",
        body: "Os relatórios que você gerou nos últimos 30 dias, para reabrir sem precisar gerar de novo.",
        placement: "bottom",
      },
    ],
  },
  {
    id: "documentos",
    label: "Documentos anexos",
    scope: "global",
    path: "/financeiro/documentos",
    steps: [
      {
        anchor: null,
        title: "Documentos anexos",
        body:
          "O arquivo dos documentos financeiros da empresa — balancetes, relatórios e planilhas que a equipe disponibiliza. Aqui você consulta e baixa.",
      },
      {
        anchor: "doc-empresa",
        title: "Empresa / unidade",
        body: "A listagem só aparece depois de escolher a empresa. Você vê apenas as empresas a que tem acesso.",
        placement: "bottom",
      },
      {
        anchor: "doc-referencia",
        title: "Data de referência",
        body: "Filtro opcional por mês/ano do documento (mm/aaaa). “Limpar” volta a mostrar todos.",
        placement: "bottom",
      },
      {
        anchor: "doc-tabela",
        title: "Baixar",
        body: "Cada linha traz o nome, o tamanho, quem enviou e a data. O botão “Baixar” abre o arquivo em outra aba.",
        placement: "top",
      },
    ],
  },
  {
    id: "comparativos",
    label: "Comparativos Anuais",
    scope: "segment",
    path: "/comparativos-anuais",
    steps: [
      {
        anchor: null,
        title: "Comparativos Anuais",
        body:
          "As três leituras lado a lado, linha a linha: o Realizado do período, o Orçado do mesmo período e o mesmo período do Ano Anterior — com a variação entre eles.",
      },
      {
        anchor: "filtro-empresa",
        title: "Segmento e empresas",
        body: "Mesma seleção das outras telas.",
        placement: "right",
      },
      {
        anchor: "filtro-periodo",
        title: "Período e Aplicar",
        body:
          "O período escolhido define também o comparativo: o “Ano Anterior” é sempre o mesmo intervalo, um ano atrás. Clique em “Aplicar” para recarregar.",
        placement: "bottom",
      },
      {
        anchor: "btn-expandir",
        title: "Expandir e recolher todas as linhas",
        body: "Abre ou fecha o plano de contas inteiro.",
        placement: "right",
      },
      {
        anchor: "tabela",
        title: "Clique em um valor para ver a origem",
        body: "O drill-down funciona igual ao das outras telas: a lista de lançamentos por trás do número.",
        placement: "top",
      },
      {
        anchor: "btn-exportar",
        title: "Exportar PDF ou XLSX",
        body:
          "PDF para enviar pronto; XLSX quando quiser continuar a análise em planilha. Os dois exportam o que está na tela.",
        placement: "bottom",
      },
    ],
  },
];

// ─── Resolução de rota ───────────────────────────────────────────────────────

/**
 * Descobre qual tour corresponde à rota atual.
 *
 * As telas por segmento são servidas em duas formas — `/s/<slug>/dashboard`
 * (o que o menu monta) e `/dashboard` (aceito em access.ts) — então a
 * comparação é por SUFIXO, nunca por igualdade da rota inteira.
 */
export function resolveTourScreen(pathname: string): TourScreen | null {
  const clean = pathname.replace(/\/+$/, "") || "/";
  for (const screen of TOUR_SCREENS) {
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

/** A próxima tela da sequência, ou null se esta for a última. */
export function nextTourScreen(id: TourScreenId): TourScreen | null {
  const index = TOUR_SCREENS.findIndex((screen) => screen.id === id);
  if (index < 0 || index === TOUR_SCREENS.length - 1) return null;
  return TOUR_SCREENS[index + 1];
}

/** Chave do localStorage que marca o tour como concluído para este usuário. */
export function tourStorageKey(userKey: string): string {
  return `ch-tour-v${TOUR_VERSION}:${userKey}`;
}
