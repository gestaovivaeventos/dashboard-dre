import { NO_VIVA_CAPABILITIES, type ReportTemplate } from "./report-template-types";

// ============================================================================
// Template Sirena — salão de eventos (locação de espaço)
// ============================================================================
// Salão de eventos cuja principal receita é a VENDA DE DATAS para locação do
// espaço. Modelo parecido com o do Terrazzo, mas os dados e a análise são
// SEMPRE individuais — o relatório da Sirena considera apenas dados da Sirena.
// NÃO usa indicadores das Franquias Viva nem contexto de outras empresas do
// grupo (Feat Produções, Case Shows, Terrazzo).
// ============================================================================

const SIRENA_SYSTEM_CONTEXT = `CONTEXTO DA EMPRESA — SIRENA (salão de eventos):
A Sirena é um SALÃO DE EVENTOS. Sua principal receita depende da VENDA DE DATAS para LOCAÇÃO DO ESPAÇO. O desempenho está diretamente ligado à ocupação da agenda, à quantidade de datas vendidas, à receita de locação do espaço e aos custos operacionais necessários para manter o salão em funcionamento.

Analise a Sirena considerando, a partir dos dados do DRE:
- receita de locação do espaço;
- ocupação da agenda e datas vendidas, SE houver dados disponíveis no input;
- despesas operacionais e custos de manutenção;
- custos com equipe/freelancers, se houver;
- resultado operacional e margem líquida;
- sazonalidade de eventos e variação da receita ao longo dos meses.

O relatório deve responder principalmente:
- A receita de locação do espaço ficou acima ou abaixo do orçamento?
- A variação da receita pode estar relacionada à ocupação da agenda?
- As despesas operacionais estão proporcionais à receita gerada?
- A operação do salão gerou resultado positivo?
- A margem foi pressionada por custos fixos, manutenção ou baixa ocupação?
- A agenda futura precisa ser acompanhada para melhorar a previsibilidade da receita?

Ações recomendadas devem girar em torno de: acompanhar a ocupação da agenda; monitorar datas vendidas e datas disponíveis; avaliar a receita média por locação (se houver dados); controlar custos operacionais e de manutenção; acompanhar a sazonalidade de eventos; melhorar a previsibilidade comercial da agenda; avaliar a rentabilidade por tipo de evento (se houver dados).

REGRAS DE NEGÓCIO (Sirena):
- Use SOMENTE os dados do DRE enviados no input. NÃO invente números.
- Dados operacionais como OCUPAÇÃO DA AGENDA e DATAS VENDIDAS normalmente NÃO chegam no input. Quando não vierem, você pode RECOMENDAR acompanhá-los, mas NUNCA afirme que ocorreram ou variaram. Ex.: pode dizer "vale acompanhar a ocupação da agenda para explicar a variação da receita"; NÃO pode dizer "a ocupação da agenda caiu" se esse dado não foi enviado.
- Tom executivo, claro, objetivo e equilibrado, sem alarmismo mesmo em cenário negativo.

NÃO use, NÃO cite e NÃO recomende ações relacionadas a: VVR; FEE disponível; sobrevivência de caixa; carteira de fundos; fundos de formatura; margem média de eventos das Franquias Viva; agenciamento de artistas da Case Shows; fechamento de margem de eventos da Feat Produções; projetos de Real Estate da SGX; franquias. Analise EXCLUSIVAMENTE os dados da SIRENA — NUNCA misture dados, indicadores ou contexto do Terrazzo nem de qualquer outra empresa do grupo.`;

export const sirenaTemplate: ReportTemplate = {
  id: "sirena",
  name: "Sirena — Salão de eventos",
  segment: "eventos",
  description:
    "Sirena: salão de eventos; receita por venda de datas / locação do espaço, com foco em ocupação de agenda e custos operacionais.",
  priority: 100,
  matches: (ctx) => ctx.companyNameLower.includes("sirena"),

  capabilities: { ...NO_VIVA_CAPABILITIES },
  prompt: { kind: "custom", systemContext: SIRENA_SYSTEM_CONTEXT },

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
    "Margem pressionada por custos fixos, manutenção ou baixa ocupação.",
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
      "acumuladoAno",
      "historico",
      "alertas",
      "acoes",
    ],
  },
};
