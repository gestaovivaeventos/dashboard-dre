// Conteúdo do tour guiado do módulo FINANCEIRO.
//
// FONTE ÚNICA: esta é a única definição destes passos. O tour de primeiro
// acesso e o botão "?" ao lado de FINANCEIRO no menu leem exatamente estes
// blocos — não escreva o texto do tour em nenhum outro lugar.
//
// ⚠️ AO MUDAR UM BOTÃO DE TELA FINANCEIRA (renomear, remover, mover), atualize
//    o passo correspondente aqui E o `data-tour` no componente. Passo cujo
//    elemento não existe é PULADO em silêncio: o tour não quebra, mas o passo
//    some do roteiro sem ninguém perceber.
//
// As telas seguem a ORDEM DO MENU do grupo FINANCEIRO (ver NAV_GROUPS em
// components/app/navigation.ts), limitadas ao que TODO usuário do módulo
// enxerga — as telas admin (Mapeamento, Lançamentos manuais, Configurações) e a
// Validação Relatório, de whitelist própria, ficam de fora de propósito: o tour
// é a mesma apresentação para todo mundo. A Home não é item de menu, mas é o
// pouso de todos os perfis e por isso abre a sequência.

import type { TourModule } from "@/lib/tour/types";

export const FINANCEIRO_TOUR: TourModule = {
  id: "financeiro",
  navGroupId: "financeiro",
  label: "Financeiro",
  screens: [
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
            "Este é um passeio rápido pelo módulo Financeiro — leva uns 3 minutos e mostra o que cada botão faz. Você pode sair quando quiser em “Pular tour” e retomar depois pelo “?” ao lado do módulo, no menu.",
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
          anchor: "tour-btn-financeiro",
          title: "Este botão traz o tour de volta",
          body:
            "O “?” ao lado do nome do módulo reabre esta explicação a qualquer momento — e começa pela tela em que você estiver. Não precisa decorar nada agora.",
          placement: "right",
        },
      ],
    },
    {
      id: "dre",
      label: "DRE Gerencial",
      scope: "segment",
      path: "/dashboard",
      navKey: "fin-dashboard",
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
      navKey: "fin-fluxo",
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
      navKey: "fin-budget",
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
      navKey: "fin-bi",
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
      navKey: "fin-docs",
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
      navKey: "fin-comparativos",
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
  ],
};
