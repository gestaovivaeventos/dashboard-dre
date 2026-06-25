import {
  OnePageReportSchema,
  type OnePageReport,
} from "@/lib/financeiro/relatorios/one-page-schema";
import type { ReportTemplateId } from "@/lib/financeiro/relatorios/templates/report-template-types";

// ============================================================================
// Mocks de analysis usados SOMENTE pela rota dev-only
// `/api/dev/intelligence/one-page-no-ai`. Permitem validar o fluxo visual com
// dados financeiros reais e analise mockada — sem consumir creditos da
// OpenAI.
//
// IMPORTANTE: o mock RESPEITA o template da empresa. O mock de Franquias Viva
// (com VVR/FEE) NUNCA aparece para empresas do grupo Feat/Eventos — cada uma
// tem um mock proprio, com texto conectado ao seu modelo de negocio e SEM
// qualquer mencao a VVR, FEE, fundos, sobrevivencia de caixa ou franquias.
// Use `resolveMockAnalysis(templateId)` para obter o mock correto.
//
// Cada objeto e validado contra `OnePageReportSchema` na carga deste modulo
// (lanca em build/import time se algum campo divergir do schema). Garante
// que o componente sempre receba algo compatível com a IA real.
// ============================================================================

// ── Mock Franquias Viva (INTOCADO) — com VVR/FEE, so para o segmento Viva ────
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

// ── Leitura por indicador comum aos mocks NÃO-Viva (núcleo DRE puro) ─────────
// Apenas os 4 indicadores estruturais — SEM FEE/VVR. Reutilizada pelos mocks
// genérico e das empresas do grupo Feat/Eventos.
const CORE_LEITURA: OnePageReport["leituraPorIndicador"] = [
  {
    indicador: "Receita Operacional Bruta",
    analise: "Receita comparada ao orçamento do período (dado mockado de teste visual).",
    classificacao: "Positivo",
  },
  {
    indicador: "Despesas Operacionais",
    analise: "Despesas comparadas ao orçamento do período (dado mockado de teste visual).",
    classificacao: "Atenção",
  },
  {
    indicador: "Resultado do Exercicio",
    analise: "Resultado do período (dado mockado de teste visual).",
    classificacao: "Positivo",
  },
  {
    indicador: "Margem",
    analise: "Margem do período (dado mockado de teste visual).",
    classificacao: "Atenção",
  },
];

// Construtor de mock genérico/individual NÃO-Viva. Recebe textos próprios da
// empresa, mantendo a estrutura validada pelo schema. NUNCA referencia
// VVR/FEE/fundos/franquias.
function buildCoreMock(args: {
  resumo: string;
  diagnostico: string;
  acoes: OnePageReport["acoesRecomendadas"];
}): OnePageReport {
  return {
    statusGeral: "Boa",
    notaGeral: 75,
    resumoExecutivo: args.resumo,
    diagnosticoPrincipal: args.diagnostico,
    destaques: [
      {
        titulo: "Receita dentro do esperado",
        descricao:
          "Receita do período comparada ao orçamento (dado mockado de teste visual).",
        impacto: "Médio",
      },
      {
        titulo: "Resultado positivo no período",
        descricao:
          "Resultado fechou no positivo (dado mockado de teste visual).",
        impacto: "Médio",
      },
    ],
    pontosAtencao: [
      {
        titulo: "Despesas operacionais",
        descricao:
          "Monitorar despesas operacionais frente à receita do período.",
        risco: "Médio",
      },
      {
        titulo: "Margem do período",
        descricao:
          "Acompanhar a margem nos próximos meses para evitar deterioração.",
        risco: "Baixo",
      },
    ],
    acoesRecomendadas: args.acoes,
    leituraPorIndicador: CORE_LEITURA,
  };
}

// ── Mock genérico (Real Estate / fallback) — núcleo DRE puro, sem Viva ───────
const GENERIC_MOCK = buildCoreMock({
  resumo:
    "Relatório de teste gerado sem IA, usando dados financeiros reais e análise mockada para validação visual.",
  diagnostico:
    "Relatório de teste gerado sem IA, usando dados financeiros reais e análise mockada para validação visual.",
  acoes: [
    {
      acao: "Revisar despesas operacionais com maior desvio",
      justificativa: "Despesas comparadas ao orçamento do período.",
      impacto: "Alto",
      urgencia: "Média",
      areaResponsavel: "Controladoria",
    },
    {
      acao: "Monitorar a margem nos próximos períodos",
      justificativa: "Margem do período exige acompanhamento mensal.",
      impacto: "Médio",
      urgencia: "Média",
      areaResponsavel: "Financeiro",
    },
  ],
});

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

// ── Mock Case Shows (agenciamento / BV) ──────────────────────────────────────
const CASE_SHOWS_MOCK = buildCoreMock({
  resumo:
    "Teste sem IA — Case Shows. A geração de receita depende do volume de contratos intermediados e do BV apurado no fechamento dos contratos.",
  diagnostico:
    "A receita da Case Shows está ligada ao BV apurado nos fechamentos. Vale acompanhar a evolução dos contratos fechados e a previsibilidade das entradas dos contratos em negociação.",
  acoes: [
    {
      acao: "Acompanhar o volume de contratos fechados e os BVs a receber",
      justificativa: "A receita do período depende do BV apurado nos fechamentos.",
      impacto: "Alto",
      urgencia: "Média",
      areaResponsavel: "Comercial",
    },
    {
      acao: "Monitorar despesas operacionais frente à receita de BV",
      justificativa: "Manter as despesas proporcionais ao volume de receita gerado.",
      impacto: "Médio",
      urgencia: "Média",
      areaResponsavel: "Controladoria",
    },
  ],
});

// ── Mock Feat Produções (margem por fechamento de eventos) ───────────────────
const FEAT_PRODUCOES_MOCK = buildCoreMock({
  resumo:
    "Teste sem IA — Feat Produções. O resultado deve ser lido considerando o estágio de fechamento dos eventos: projetos realizados ainda sem margem apurada podem deixar o resultado do mês incompleto.",
  diagnostico:
    "O resultado do período pode não refletir integralmente os eventos realizados caso existam fechamentos pendentes de apuração de margem. Vale acompanhar o status de fechamento dos projetos.",
  acoes: [
    {
      acao: "Verificar o status de fechamento dos projetos/eventos",
      justificativa:
        "Fechamentos pendentes podem deixar a margem do mês ainda não reconhecida no DRE.",
      impacto: "Alto",
      urgencia: "Média",
      areaResponsavel: "Operação",
    },
    {
      acao: "Monitorar custos, impostos e despesas operacionais",
      justificativa: "Avaliar a pressão das despesas sobre o resultado do período.",
      impacto: "Médio",
      urgencia: "Média",
      areaResponsavel: "Controladoria",
    },
  ],
});

// ── Mock Sirena (salão de eventos — locação) ─────────────────────────────────
const SIRENA_MOCK = buildCoreMock({
  resumo:
    "Teste sem IA — Sirena. O desempenho do salão está ligado à locação do espaço e à ocupação da agenda. A evolução das datas vendidas ajuda a explicar a variação da receita.",
  diagnostico:
    "A análise da Sirena deve considerar a ocupação da agenda e a receita de locação do espaço. Vale acompanhar as datas vendidas para explicar a variação da receita ao longo dos meses.",
  acoes: [
    {
      acao: "Acompanhar a ocupação da agenda e as datas vendidas",
      justificativa:
        "A receita de locação está diretamente ligada à ocupação da agenda.",
      impacto: "Alto",
      urgencia: "Média",
      areaResponsavel: "Comercial",
    },
    {
      acao: "Controlar custos operacionais e de manutenção do salão",
      justificativa: "Manter os custos fixos proporcionais à receita gerada.",
      impacto: "Médio",
      urgencia: "Média",
      areaResponsavel: "Operação",
    },
  ],
});

// ── Mock Terrazzo (salão de eventos — locação) ───────────────────────────────
const TERRAZZO_MOCK = buildCoreMock({
  resumo:
    "Teste sem IA — Terrazzo. O desempenho do salão está ligado à locação do espaço e à ocupação da agenda. O controle dos custos operacionais ajuda a explicar a variação do resultado.",
  diagnostico:
    "A análise do Terrazzo deve considerar a ocupação da agenda e a receita de locação do espaço. Vale acompanhar as datas vendidas e os custos operacionais ao longo dos meses.",
  acoes: [
    {
      acao: "Acompanhar a ocupação da agenda e as datas vendidas",
      justificativa:
        "A receita de locação está diretamente ligada à ocupação da agenda.",
      impacto: "Alto",
      urgencia: "Média",
      areaResponsavel: "Comercial",
    },
    {
      acao: "Controlar custos operacionais e de manutenção do salão",
      justificativa: "Manter os custos fixos compatíveis com o nível de receita.",
      impacto: "Médio",
      urgencia: "Média",
      areaResponsavel: "Operação",
    },
  ],
});

// ── Mocks da família Salvaterra (condomínio / estacionamento) ────────────────
// SEM VVR/FEE/SGX/Village/Feat — só a leitura financeira-gerencial de cada
// empresa. Não misturam dados entre as duas (o consolidado é bloco à parte).
const SALVATERRA_CONDOMINIO_MOCK = buildCoreMock({
  resumo:
    "Teste sem IA — Salvaterra Condomínio. Operação condominial com receitas de locação, taxas condominiais e reembolsos, e despesas de manutenção e vigias (freelancers). O período mostra o resultado do condomínio frente ao orçamento e sua contribuição ao consolidado Salvaterra.",
  diagnostico:
    "O resultado do condomínio depende do equilíbrio entre as receitas (locação, taxas condominiais e reembolsos) e as despesas totais. Vale acompanhar a aderência das despesas ao orçamento, a evolução das receitas condominiais e o impacto do resultado individual no consolidado Salvaterra (bloco complementar).",
  acoes: [
    {
      acao: "Acompanhar receitas de locação e receitas condominiais vs orçamento",
      justificativa: "As receitas recorrentes sustentam a cobertura das despesas do condomínio.",
      impacto: "Alto",
      urgencia: "Média",
      areaResponsavel: "Controladoria",
    },
    {
      acao: "Monitorar despesas totais e custos de manutenção",
      justificativa: "Manter as despesas controladas em relação ao orçamento preserva o resultado.",
      impacto: "Médio",
      urgencia: "Média",
      areaResponsavel: "Financeiro",
    },
  ],
});

const SALVATERRA_ESTACIONAMENTO_MOCK = buildCoreMock({
  resumo:
    "Teste sem IA — Salvaterra Estacionamento. Operação ligada aos eventos no Terrazzo: receita variável, custo com freelancers e despesas operacionais. O período mostra o resultado do estacionamento frente ao orçamento e sua contribuição ao consolidado Salvaterra.",
  diagnostico:
    "A receita do estacionamento depende dos eventos do período; o custo com freelancers deve acompanhar proporcionalmente a receita. Vale monitorar a margem operacional, as despesas e o impacto do resultado individual no consolidado Salvaterra (bloco complementar).",
  acoes: [
    {
      acao: "Revisar a escala de freelancers conforme o volume de eventos",
      justificativa: "Manter o custo com freelancers proporcional à receita gerada nos eventos.",
      impacto: "Alto",
      urgencia: "Média",
      areaResponsavel: "Operação",
    },
    {
      acao: "Acompanhar a receita do estacionamento e a margem operacional por período",
      justificativa: "A receita é variável e concentrada em eventos; acompanhar a margem evita surpresas.",
      impacto: "Médio",
      urgencia: "Média",
      areaResponsavel: "Controladoria",
    },
  ],
});

// ── Mock da Young Med ────────────────────────────────────────────────────────
// Serviços para médicos recém-formados; receita por PARCEIROS (BVs) + comissões.
// SEM VVR/FEE/eventos/franquias/Real Estate — só a leitura financeira da própria
// Young Med, com foco em parceiros, concentração e eficiência após comissões.
const YOUNG_MED_MOCK = buildCoreMock({
  resumo:
    "Teste sem IA — Young Med. Empresa jovem de serviços para médicos recém-formados, com receita vinda das vendas/intermediações com parceiros (BVs) e um esquema relevante de comissões. O período mostra a receita total, o principal parceiro, o peso das comissões e o resultado frente ao orçamento.",
  diagnostico:
    "O resultado da Young Med depende do crescimento da receita por parceiros, da diversificação além do parceiro principal e da eficiência após comissões. Vale acompanhar a concentração da receita de BVs, o peso das comissões sobre a receita e a aderência do resultado do exercício ao orçamento no mês e no acumulado.",
  acoes: [
    {
      acao: "Monitorar a concentração da receita no principal parceiro e acelerar a diversificação",
      justificativa: "Reduzir a dependência de um único parceiro fortalece a previsibilidade da receita.",
      impacto: "Alto",
      urgencia: "Média",
      areaResponsavel: "Comercial",
    },
    {
      acao: "Avaliar a política de comissões como percentual da receita",
      justificativa: "As comissões consomem parte relevante da receita; acompanhar o percentual preserva a margem.",
      impacto: "Médio",
      urgencia: "Média",
      areaResponsavel: "Controladoria",
    },
  ],
});

// ── Mock da Spot ─────────────────────────────────────────────────────────────
// Cenografia/produção/locação de mobiliário + frete. A Express (logística) só na
// visão gerencial. SEM VVR/FEE/eventos/franquias/Real Estate/Young Med.
const SPOT_MOCK = buildCoreMock({
  resumo:
    "Teste sem IA — Spot. Empresa de cenografia que produz mobiliários e cenários sob demanda (venda e locação), com acervo para locação e operação de frete faturada via Spot. O período mostra a receita total, a principal fonte de receita, as despesas operacionais e o resultado frente ao orçamento. A Express (braço logístico, DRE separado) aparece só na visão gerencial consolidada.",
  diagnostico:
    "O resultado da Spot depende do mix entre produção/venda, locação de acervo e frete, e da eficiência da oficina e do galpão. Vale acompanhar a composição da receita, a relação entre receita de frete e custo logístico, a aderência das despesas ao orçamento e o impacto da Express no consolidado Spot + Express (bloco complementar).",
  acoes: [
    {
      acao: "Acompanhar o mix de receita entre produção/venda, locação e frete",
      justificativa: "A concentração da receita em uma única fonte aumenta o risco; o mix sustenta o resultado.",
      impacto: "Alto",
      urgencia: "Média",
      areaResponsavel: "Comercial",
    },
    {
      acao: "Monitorar a receita de frete frente ao custo logístico",
      justificativa: "O frete é faturado via Spot; o custo logístico (fretes e veículos) não pode pressionar o resultado.",
      impacto: "Médio",
      urgencia: "Média",
      areaResponsavel: "Operação",
    },
  ],
});

// Validacao na carga do modulo. Se algum mock divergir do schema, lanca aqui.
const MOCKS_BY_TEMPLATE: Record<ReportTemplateId, OnePageReport> = {
  "franquias-viva": OnePageReportSchema.parse(RAW_MOCK),
  generic: OnePageReportSchema.parse(GENERIC_MOCK),
  "real-estate-sgx": OnePageReportSchema.parse(GENERIC_MOCK),
  // Village tem mock próprio (gap de reembolso / resultado ajustado).
  "real-estate-village": OnePageReportSchema.parse(RAW_MOCK_VILLAGE),
  "real-estate-salvaterra-condominio": OnePageReportSchema.parse(SALVATERRA_CONDOMINIO_MOCK),
  "real-estate-salvaterra-estacionamento": OnePageReportSchema.parse(SALVATERRA_ESTACIONAMENTO_MOCK),
  "feat-producoes": OnePageReportSchema.parse(FEAT_PRODUCOES_MOCK),
  "case-shows": OnePageReportSchema.parse(CASE_SHOWS_MOCK),
  sirena: OnePageReportSchema.parse(SIRENA_MOCK),
  terrazzo: OnePageReportSchema.parse(TERRAZZO_MOCK),
  "young-med": OnePageReportSchema.parse(YOUNG_MED_MOCK),
  spot: OnePageReportSchema.parse(SPOT_MOCK),
};

/**
 * Mock de analysis APROPRIADO ao template da empresa. Franquias Viva mantém o
 * mock historico (com VVR/FEE); os demais usam mocks de núcleo DRE puro, e as
 * empresas do grupo Feat/Eventos têm texto conectado ao próprio negócio — sem
 * qualquer menção a VVR/FEE/fundos/franquias.
 */
export function resolveMockAnalysis(
  templateId: ReportTemplateId | string | undefined,
): OnePageReport {
  if (templateId && templateId in MOCKS_BY_TEMPLATE) {
    return MOCKS_BY_TEMPLATE[templateId as ReportTemplateId];
  }
  return MOCKS_BY_TEMPLATE.generic;
}

// Compatibilidade: callers antigos que importavam o mock unico continuam
// funcionando — o default e o mock Franquias Viva (segmento historico da base).
export const MOCK_ANALYSIS: OnePageReport = MOCKS_BY_TEMPLATE["franquias-viva"];

// Compatibilidade: a Village expoe o mock proprio tambem como export nomeado.
export const MOCK_ANALYSIS_VILLAGE: OnePageReport =
  MOCKS_BY_TEMPLATE["real-estate-village"];
