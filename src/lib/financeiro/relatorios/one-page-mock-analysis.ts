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

// ============================================================================
// Mock ESPECÍFICO da Village (construtora). Usado pela rota dev-only quando a
// empresa resolve para o template `real-estate-village`. NÃO menciona VVR, FEE,
// SGX, franquias, locações nem projetos — só a dinâmica de custos reembolsáveis
// x reembolsos (gap de reembolso, resultado ajustado, margem líquida).
// Os `indicador` de leituraPorIndicador casam com os rótulos dos 5 cards da
// Village para alimentar o semáforo (mapSemaforoFromList).
// ============================================================================
const RAW_MOCK_VILLAGE: OnePageReport = {
  statusGeral: "Atenção",
  notaGeral: 62,
  resumoExecutivo:
    "Análise de teste (sem IA) no contexto da Village — construtora com custos reembolsáveis e reembolsos de obra. No período, a receita de serviços ficou dentro do esperado, mas o gap de reembolso foi negativo: parte dos custos reembolsáveis ainda não foi compensada pelos reembolsos do mês (descasamento típico M/M+1). O resultado ajustado, que remove o efeito do gap, indica uma operação mais saudável do que o resultado operacional contábil isolado.",
  diagnosticoPrincipal:
    "O resultado operacional está pressionado pelo gap de reembolso negativo: os custos reembolsáveis superaram os reembolsos recebidos no período. Ao isolar esse descasamento, o resultado ajustado melhora — sinal de que o efeito é mais de timing (M/M+1) do que de perda estrutural. Recomenda-se conciliar reembolsos por obra e acompanhar a recuperação no mês seguinte.",
  destaques: [
    {
      titulo: "Receita de serviços dentro do esperado",
      descricao:
        "A receita de contratos/serviços prestados manteve-se alinhada ao orçamento do período.",
      impacto: "Médio",
    },
    {
      titulo: "Resultado ajustado positivo",
      descricao:
        "Removido o efeito do gap de reembolso, a operação mostra resultado melhor que o operacional contábil.",
      impacto: "Médio",
    },
  ],
  pontosAtencao: [
    {
      titulo: "Gap de reembolso negativo",
      descricao:
        "Custos reembolsáveis superaram os reembolsos recebidos no período — possível descasamento temporário de caixa (M/M+1).",
      risco: "Médio",
    },
    {
      titulo: "Reembolsos a recuperar em M+1",
      descricao:
        "Parte dos custos da obra deve ser reembolsada no mês seguinte; monitorar para confirmar que o gap é pontual e não recorrente.",
      risco: "Médio",
    },
  ],
  acoesRecomendadas: [
    {
      acao: "Conciliar custos reembolsáveis por obra/contrato",
      justificativa:
        "Garante que cada custo reembolsável tenha o reembolso correspondente identificado e cobrado.",
      impacto: "Alto",
      urgencia: "Alta",
      areaResponsavel: "Controladoria",
    },
    {
      acao: "Acompanhar custos de M contra reembolsos de M+1",
      justificativa:
        "Confirma se o gap negativo é apenas timing de recebimento, e não perda estrutural da operação.",
      impacto: "Médio",
      urgencia: "Média",
      areaResponsavel: "Financeiro",
    },
    {
      acao: "Criar aging de reembolsos pendentes",
      justificativa:
        "Evita que reembolsos atrasados distorçam o resultado e o caixa dos próximos meses.",
      impacto: "Médio",
      urgencia: "Média",
      areaResponsavel: "Controladoria",
    },
  ],
  leituraPorIndicador: [
    {
      indicador: "Receita de Serviços",
      analise: "Receita de contratos/serviços alinhada ao orçamento do período.",
      classificacao: "Positivo",
    },
    {
      indicador: "Gap de Reembolso",
      analise:
        "Negativo no período — custos reembolsáveis acima dos reembolsos; provável efeito de delay M/M+1.",
      classificacao: "Atenção",
    },
    {
      indicador: "Resultado Ajustado",
      analise:
        "Positivo ao remover o efeito do gap — operação saudável sem o descasamento de reembolso.",
      classificacao: "Positivo",
    },
    {
      indicador: "Resultado Operacional",
      analise: "Pressionado pelo gap de reembolso negativo do período.",
      classificacao: "Atenção",
    },
    {
      indicador: "Margem Líquida",
      analise: "Exige acompanhamento — sensível ao resultado final do período.",
      classificacao: "Atenção",
    },
  ],
};

export const MOCK_ANALYSIS_VILLAGE: OnePageReport =
  OnePageReportSchema.parse(RAW_MOCK_VILLAGE);
