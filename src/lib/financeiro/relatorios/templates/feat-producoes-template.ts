import { NO_VIVA_CAPABILITIES, type ReportTemplate } from "./report-template-types";

// ============================================================================
// Template Feat Produções — produtora de eventos (margem por fechamento)
// ============================================================================
// Produtora de eventos corporativos, shows e licitações. Particularidade: a
// receita entra no resultado via FECHAMENTO do evento (apuração de margem por
// evento). A margem é lançada no DRE no mês em que o evento ocorreu, mas SÓ
// depois que o fechamento é concluído — fechamentos atrasados deixam o
// resultado do mês incompleto. NÃO usa indicadores das Franquias Viva nem
// contexto de outras empresas do grupo (Case Shows, Sirena, Terrazzo).
// ============================================================================

const FEAT_PRODUCOES_SYSTEM_CONTEXT = `CONTEXTO DA EMPRESA — FEAT PRODUÇÕES (produtora de eventos):
A Feat Produções é uma PRODUTORA DE EVENTOS — realiza eventos corporativos, shows e licitações. Particularidade central do modelo: a receita entra no resultado por meio do FECHAMENTO DO EVENTO, que é a apuração da MARGEM de cada evento. Cada evento tem sua margem apurada individualmente e, somente após a finalização desse fechamento, o resultado é inserido no dashboard DRE como resultado da empresa. O valor da margem é sempre lançado no MÊS EM QUE O EVENTO OCORREU.

IMPLICAÇÃO CRÍTICA PARA A LEITURA: se o fechamento de um evento estiver atrasado, o resultado da empresa naquele mês estará INCOMPLETO — ainda falta entrar a receita/margem do evento pendente de fechamento. Portanto, um resultado abaixo do esperado em determinado mês PODE estar relacionado a eventos ainda não fechados, e NÃO necessariamente a baixa performance operacional.

REGRA DE INTERPRETAÇÃO (anti-conclusão precipitada):
- NÃO afirme que houve "baixa performance operacional" apenas com base no resultado do DRE — o resultado pode estar incompleto por fechamentos pendentes.
- Trate um resultado abaixo do esperado como POSSIVELMENTE afetado por fechamentos pendentes; comunique isso como hipótese/ponto de atenção, sem alarmismo e sem cravar causa.
- O input NÃO informa se há eventos pendentes de fechamento. Logo, você pode RECOMENDAR verificar o status de fechamentos, mas NÃO pode afirmar que existem fechamentos pendentes nem quantos.

Analise a Feat Produções considerando, a partir dos dados do DRE:
- receita/margem reconhecida no dashboard DRE;
- resultado do período;
- despesas operacionais, custos e impostos relacionados à operação;
- possível impacto de eventos realizados ainda sem margem apurada (como hipótese);
- aderência do resultado ao orçamento.

O relatório deve responder principalmente:
- O resultado do período reflete integralmente os eventos realizados, ou pode haver fechamentos pendentes afetando a leitura?
- A margem reconhecida no DRE está compatível com o esperado/orçado?
- O resultado foi pressionado por despesas operacionais, custos ou impostos?
- Há necessidade de acelerar o fechamento de projetos/eventos?

Ações recomendadas devem girar em torno de: acompanhar eventos realizados no período; verificar o status de fechamento dos projetos; identificar eventos com margem ainda não apurada; avaliar o impacto de fechamentos pendentes no resultado do mês; comparar eventos realizados com a margem reconhecida no DRE; monitorar custos, impostos e despesas operacionais; avaliar a qualidade da margem apurada por evento; reforçar o processo de fechamento financeiro dos eventos.

REGRAS DE NEGÓCIO (Feat Produções):
- Use SOMENTE os dados do DRE enviados no input. NÃO invente números, eventos ou margens.
- Tom executivo, claro, objetivo e equilibrado. Mesmo em cenário negativo, sem alarmismo — aponte pontos de atenção com foco em análise e ação.

NÃO use, NÃO cite e NÃO recomende ações relacionadas a: VVR; FEE disponível; sobrevivência de caixa; carteira de fundos; fundos de formatura; margem média de eventos das Franquias Viva; agenciamento de artistas da Case Shows; locação de salão da Sirena ou do Terrazzo; estacionamento; taxa condominial; franquias; nem projetos de Real Estate. Analise EXCLUSIVAMENTE os dados da Feat Produções — nunca assuma receitas, custos ou contexto de outras empresas do grupo.`;

export const featProducoesTemplate: ReportTemplate = {
  id: "feat-producoes",
  name: "Feat Produções — Produtora de eventos",
  segment: "eventos",
  description:
    "Feat Produções: produtora de eventos; receita reconhecida via fechamento (margem) por evento — resultado sensível a fechamentos pendentes.",
  priority: 100,
  matches: (ctx) => ctx.companyNameLower.includes("feat"),

  capabilities: { ...NO_VIVA_CAPABILITIES },
  prompt: { kind: "custom", systemContext: FEAT_PRODUCOES_SYSTEM_CONTEXT },

  expectedKpis: [
    { key: "receita_margem", label: "Receita / Margem reconhecida", source: "core-receita" },
    { key: "despesas", label: "Despesas Operacionais", source: "core-despesas" },
    { key: "resultado", label: "Resultado do Período", source: "core-resultado" },
    { key: "margem", label: "Margem Líquida", source: "core-margem" },
  ],
  expectedCharts: [
    { key: "previsto_realizado", title: "Previsto x Realizado" },
    { key: "acumulado", title: "Acumulado do Ano" },
    { key: "historico", title: "Histórico do Resultado" },
  ],
  semaforoIndicators: ["Receita", "Despesas", "Resultado", "Margem"],
  alertHints: [
    "Resultado do mês abaixo do orçado — avaliar se há fechamentos de eventos pendentes.",
    "Margem reconhecida abaixo do esperado para o período.",
    "Custos, impostos ou despesas operacionais pressionando o resultado.",
    "Possível defasagem entre eventos realizados e margem reconhecida no DRE.",
  ],
  actionHints: [
    "Acompanhar os eventos realizados no período.",
    "Verificar o status de fechamento dos projetos/eventos.",
    "Identificar eventos com margem ainda não apurada.",
    "Avaliar o impacto de fechamentos pendentes no resultado do mês.",
    "Comparar eventos realizados com a margem reconhecida no DRE.",
    "Monitorar custos, impostos e despesas operacionais.",
    "Reforçar o processo de fechamento financeiro dos eventos.",
  ],
  dreAccountMapping: {
    receita_margem: {
      label: "Receita / Margem de Eventos reconhecida",
      byNameIncludes: ["margem", "evento", "fechamento"],
      codes: ["1"],
      status: "confirmed",
      note: "Receita Operacional Bruta (code 1) = margem reconhecida no fechamento.",
    },
    despesas: { label: "Despesas Operacionais", codes: ["7"], status: "confirmed" },
    resultado: { label: "Resultado do Exercício", codes: ["11"], status: "confirmed" },
  },

  // Núcleo DRE puro, sem gráfico de VVR (evita buraco visual e indicadores de
  // franquias). KPIs de saúde/caixa da Viva ausentes (capacidades desligadas).
  report: {
    enabledBlocks: [
      "diagnostico",
      "previstoRealizado",
      "semaforo",
      "acumuladoAno",
      "historico",
      "alertas",
      "acoes",
    ],
  },
};
