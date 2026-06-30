import { NO_VIVA_CAPABILITIES, type ReportTemplate } from "./report-template-types";

// ============================================================================
// Template Terrazzo — salão de eventos (locação de espaço)
// ============================================================================
// Salão de eventos cuja principal receita está na LOCAÇÃO DO ESPAÇO. Modelo
// parecido com o da Sirena, mas os dados e a análise são SEMPRE individuais —
// o relatório do Terrazzo considera apenas dados do Terrazzo. NÃO usa
// indicadores das Franquias Viva nem contexto de outras empresas do grupo
// (Feat Produções, Case Shows, Sirena).
// ============================================================================

const TERRAZZO_SYSTEM_CONTEXT = `CONTEXTO DA EMPRESA — TERRAZZO (salão de eventos):
O Terrazzo é um SALÃO DE EVENTOS. Assim como a Sirena, sua principal receita está relacionada à LOCAÇÃO DO ESPAÇO para eventos. O desempenho depende da venda de datas, da ocupação da agenda, da receita gerada por locação do espaço e do controle dos custos operacionais ligados à estrutura do salão.

Analise o Terrazzo considerando, a partir dos dados do DRE:
- receita de locação do espaço;
- ocupação da agenda e datas vendidas, SE houver dados disponíveis no input;
- despesas operacionais e custos de manutenção;
- custos com equipe/freelancers, se houver;
- resultado operacional e margem líquida;
- sazonalidade de eventos e variação da receita ao longo dos meses;
- eventuais receitas acessórias, se existirem no DRE.

O relatório deve responder principalmente:
- A receita de locação do espaço ficou acima ou abaixo do orçamento?
- A operação do salão gerou resultado positivo?
- A margem foi impactada por custos operacionais, manutenção ou baixa ocupação?
- A variação de receita pode estar relacionada à quantidade de datas vendidas?
- Há necessidade de reforçar a previsibilidade comercial da agenda?
- As despesas estão compatíveis com o nível de receita do período?

Ações recomendadas devem girar em torno de: acompanhar a ocupação da agenda; monitorar datas vendidas e datas disponíveis; avaliar a receita média por locação (se houver dados); controlar custos operacionais e de manutenção; acompanhar a sazonalidade de eventos; melhorar a previsibilidade comercial da agenda; avaliar a rentabilidade por tipo de evento e comparar receita reconhecida com eventos realizados (se houver dados).

REGRAS DE NEGÓCIO (Terrazzo):
- Use SOMENTE os dados do DRE enviados no input. NÃO invente números.
- Dados operacionais como OCUPAÇÃO DA AGENDA e DATAS VENDIDAS normalmente NÃO chegam no input. Quando não vierem, você pode RECOMENDAR acompanhá-los, mas NUNCA afirme que ocorreram ou variaram. Ex.: pode dizer "vale acompanhar a ocupação da agenda e o controle dos custos operacionais para explicar a variação do resultado"; NÃO pode dizer "a ocupação da agenda caiu" se esse dado não foi enviado.
- Tom executivo, claro, objetivo e equilibrado, sem alarmismo mesmo em cenário negativo.

NÃO use, NÃO cite e NÃO recomende ações relacionadas a: VVR; FEE disponível; sobrevivência de caixa; carteira de fundos; fundos de formatura; margem média de eventos das Franquias Viva; agenciamento de artistas da Case Shows; fechamento de margem de eventos da Feat Produções; projetos de Real Estate da SGX; franquias. Analise EXCLUSIVAMENTE os dados do TERRAZZO — NUNCA misture dados, indicadores ou contexto da Sirena nem de qualquer outra empresa do grupo.`;

export const terrazzoTemplate: ReportTemplate = {
  id: "terrazzo",
  name: "Terrazzo — Salão de eventos",
  segment: "eventos",
  description:
    "Terrazzo: salão de eventos; receita por locação do espaço, com foco em ocupação de agenda e custos operacionais.",
  priority: 100,
  matches: (ctx) => ctx.companyNameLower.includes("terrazzo"),

  capabilities: { ...NO_VIVA_CAPABILITIES },
  prompt: { kind: "custom", systemContext: TERRAZZO_SYSTEM_CONTEXT },

  expectedKpis: [
    { key: "receita_locacao", label: "Receita de Locação", source: "core-receita" },
    { key: "despesas", label: "Despesas Operacionais", source: "core-despesas" },
    { key: "resultado", label: "Resultado Operacional", source: "core-resultado" },
    { key: "margem", label: "Margem Líquida", source: "core-margem" },
  ],
  expectedCharts: [
    { key: "previsto_realizado", title: "Previsto x Realizado" },
    { key: "acumulado", title: "Acumulado do Ano" },
    { key: "historico", title: "Histórico do Resultado" },
  ],
  semaforoIndicators: ["Receita", "Despesas", "Resultado", "Margem"],
  alertHints: [
    "Receita de locação abaixo do orçamento.",
    "Margem impactada por custos operacionais, manutenção ou baixa ocupação.",
    "Despesas operacionais crescendo acima da receita.",
    "Variação relevante de receita ao longo dos meses (sazonalidade).",
  ],
  actionHints: [
    "Acompanhar a ocupação da agenda.",
    "Monitorar datas vendidas e datas disponíveis.",
    "Avaliar a receita média por locação, se houver dados.",
    "Controlar custos operacionais e de manutenção.",
    "Acompanhar a sazonalidade de eventos.",
    "Melhorar a previsibilidade comercial da agenda.",
  ],
  dreAccountMapping: {
    receita_locacao: {
      label: "Receita de Locação do Espaço",
      byNameIncludes: ["locação", "locacao", "espaço", "espaco", "aluguel"],
      codes: ["1"],
      status: "confirmed",
      note: "Receita Operacional Bruta (code 1) = locação do espaço.",
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
      // Quadro "Locação de Espaço" — exclusivo do Terrazzo, logo após a tabela
      // de desempenho/semáforo.
      "locacaoEspaco",
      "acumuladoAno",
      "historico",
      "alertas",
      "acoes",
    ],
    // Indicadores de locação por tipo (mesmas contas da planilha/DRE gerencial):
    //   1.1 = Locação de Espaço para Formaturas
    //   1.2 = Locação de Espaço para Shows/Palestras
    // Realizado no mês de referência selecionado pelo usuário.
    indicadoresDre: {
      key: "locacaoEspaco",
      title: "Locação de Espaço",
      items: [
        { label: "Locação de Espaço para Formaturas", codes: ["1.1"] },
        { label: "Locação de Espaço para Shows/Palestras", codes: ["1.2"] },
      ],
    },
  },
};
