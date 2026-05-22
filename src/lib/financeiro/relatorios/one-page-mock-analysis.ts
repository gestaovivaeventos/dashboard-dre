import {
  OnePageReportSchema,
  type OnePageReport,
} from "@/lib/financeiro/relatorios/one-page-schema";

// ============================================================================
// Mock de analysis usado SOMENTE pela rota dev-only
// `/api/dev/intelligence/one-page-no-ai`. Permite validar o fluxo visual com
// dados financeiros reais e analise mockada — sem consumir creditos da
// OpenAI.
//
// O objeto e validado contra `OnePageReportSchema` na carga deste modulo
// (lanca em build/import time se algum campo divergir do schema). Garante
// que o componente sempre receba algo compatível com a IA real.
// ============================================================================

const RAW_MOCK: OnePageReport = {
  statusGeral: "Boa",
  notaGeral: 78,
  resumoExecutivo:
    "Relatório de teste gerado sem IA, usando dados financeiros reais e análise mockada para validação visual.",
  diagnosticoPrincipal:
    "Relatório de teste gerado sem IA, usando dados financeiros reais e análise mockada para validação visual.",
  destaques: [
    {
      titulo: "Receita acima do orçamento",
      descricao:
        "Indicador estrutural com desempenho favorável vs. orçamento no período.",
      impacto: "Alto",
    },
    {
      titulo: "Resultado positivo no período",
      descricao:
        "Resultado do exercício fechou acima do orçado, sustentado pelo aumento da receita.",
      impacto: "Médio",
    },
  ],
  pontosAtencao: [
    {
      titulo: "Despesas operacionais elevadas",
      descricao:
        "Despesas Operacionais cresceram acima do orçamento, pressionando a margem.",
      risco: "Médio",
    },
    {
      titulo: "Margem operacional pressionada",
      descricao:
        "Margem realizada ficou abaixo da prevista — monitorar nos próximos períodos.",
      risco: "Médio",
    },
  ],
  acoesRecomendadas: [
    {
      acao: "Revisar despesas operacionais",
      justificativa:
        "Despesas crescendo acima do orçamento. Identificar linhas com maior desvio.",
      impacto: "Alto",
      urgencia: "Alta",
      areaResponsavel: "Financeiro",
    },
    {
      acao: "Monitorar margem nos próximos períodos",
      justificativa:
        "Margem pressionada exige acompanhamento mensal para evitar deterioração.",
      impacto: "Médio",
      urgencia: "Média",
      areaResponsavel: "Controladoria",
    },
    {
      acao: "Avaliar relação entre VVR e FEE disponível",
      justificativa:
        "Analisar se o saldo de FEE disponível está alinhado à meta de VVR.",
      impacto: "Médio",
      urgencia: "Média",
      areaResponsavel: "Comercial / Financeiro",
    },
  ],
  leituraPorIndicador: [
    {
      indicador: "Receita Operacional Bruta",
      analise:
        "Receita acima do orçado, sinalizando demanda saudável no período.",
      classificacao: "Positivo",
    },
    {
      indicador: "Despesas Operacionais",
      analise:
        "Despesas crescendo acima do orçamento — exige investigação detalhada.",
      classificacao: "Atenção",
    },
    {
      indicador: "Resultado do Exercicio",
      analise: "Resultado fechou no positivo, ainda que abaixo do potencial.",
      classificacao: "Positivo",
    },
    {
      indicador: "Margem",
      analise: "Margem operacional pressionada pelo crescimento das despesas.",
      classificacao: "Atenção",
    },
    {
      indicador: "FEE disponível",
      analise:
        "Saldo de FEE disponível dentro do esperado para o período. Acompanhamento recomendado.",
      classificacao: "Neutro",
    },
    {
      indicador: "VVR",
      analise: "VVR realizado acima da meta — desempenho comercial favorável.",
      classificacao: "Positivo",
    },
  ],
};

// Validacao na carga do modulo. Se o mock divergir do schema, lanca aqui.
export const MOCK_ANALYSIS: OnePageReport = OnePageReportSchema.parse(RAW_MOCK);
