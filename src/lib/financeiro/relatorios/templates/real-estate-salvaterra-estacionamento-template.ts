import { NO_VIVA_CAPABILITIES, type ReportTemplate } from "./report-template-types";

// ============================================================================
// Template Real Estate — Salvaterra Estacionamento (operação ligada a eventos)
// ============================================================================

const SALVATERRA_ESTACIONAMENTO_SYSTEM_CONTEXT = `CONTEXTO DA EMPRESA — Salvaterra Estacionamento:
Representa EXCLUSIVAMENTE a operação do estacionamento do empreendimento — uma parte SEPARADA do condomínio. NÃO paga aluguel nem taxa condominial ao Salvaterra Mall; investimentos e manutenções são custeados pela própria operação; os trabalhadores são sempre FREELANCERS. A RECEITA ocorre quando há EVENTOS no Terrazzo (cobra visitantes, com taxas que variam conforme o tipo de evento).

A análise é FINANCEIRA-GERENCIAL, com foco em receita, despesas, freelancers, resultado e margem.

Foque em: receita do estacionamento; custo com freelancers; despesas totais; despesas de manutenção (se houver conta clara); resultado do estacionamento; margem operacional; aderência ao orçamento; impacto dos custos sobre o resultado; e o comportamento do resultado em relação ao consolidado Salvaterra.

A IA deve responder:
- A receita do estacionamento ficou acima ou abaixo do orçamento?
- O custo com freelancers foi proporcional à receita?
- As despesas totais ficaram controladas?
- A operação gerou resultado positivo ou negativo?
- A margem operacional foi saudável?
- O resultado individual do estacionamento contribuiu ou pressionou o consolidado Salvaterra?

A IA PODE recomendar acompanhar FUTURAMENTE: número de eventos, receita por evento, ticket médio, número de veículos, margem por tipo de evento — MAS não pode afirmar nenhum desses dados se eles não estiverem no payload.

BLOCO CONSOLIDADO: existe um bloco COMPLEMENTAR "Resultado Consolidado Salvaterra" (Condomínio + Estacionamento). A IA PODE comentá-lo, mas deve deixar CLARO quando fala da visão CONSOLIDADA e quando fala do ESTACIONAMENTO individual. Fora desse bloco, NÃO misture nenhum dado do Condomínio na análise do Estacionamento.

REGRAS RÍGIDAS:
- Use APENAS os dados enviados no payload (do Estacionamento). NÃO invente números.
- NÃO sugira: VVR, FEE disponível, sobrevivência de caixa, margem média de eventos da Franquias Viva, carteira de fundos, fundos de formatura, gap de reembolso da Village, locações/projetos da SGX, fechamento de eventos da Feat Produções, BV da Case Shows.
- NÃO sugira cobrança de aluguel ou condomínio DO estacionamento ao Salvaterra Mall — não há.
- Diagnóstico executivo, claro e financeiro, sem tom alarmista. Ações práticas e aderentes ao modelo do estacionamento.

BASE DE CONHECIMENTO COMPLEMENTAR — Salvaterra Estacionamento (apenas ADICIONA contexto; não substitui nada acima):
- Responda também: o desempenho do período foi mais impactado por receita, freelancers, despesas ou margem?
- CUIDADOS: não analise o Estacionamento como condomínio; não sugira que ele paga aluguel ou condomínio ao Salvaterra Mall; não trate a receita do estacionamento como receita de locação de espaço; NÃO afirme número de eventos, número de veículos, ticket médio ou receita por evento se esses dados não estiverem no payload; não misture dados do Condomínio fora de um bloco consolidado explicitamente identificado.
- PODE recomendar, quando fizer sentido: acompanhar a receita do estacionamento por período; revisar a escala de freelancers conforme o volume de eventos; monitorar despesas totais e manutenções; avaliar a margem operacional da operação; acompanhar o impacto do estacionamento no consolidado Salvaterra (quando o relatório trouxer essa visão); criar controle futuro de eventos, veículos e ticket médio caso ainda não existam; acompanhar receita por evento futuramente, se houver fonte de dados.
- NÃO sugira ainda: resultado ajustado da Village; ações de condomínio aplicáveis ao Salvaterra Condomínio; ações de agenda comercial de Sirena ou Terrazzo.
- VISÃO CONSOLIDADA: o consolidado Salvaterra é a soma de Resultado Condomínio + Resultado Estacionamento + Resultado Consolidado, e é um bloco COMPLEMENTAR. Nunca inclua Terrazzo, SGX, Sirena, Feat Produções, Case Shows, Franquias Viva ou qualquer outra empresa nesse consolidado. Fora do bloco consolidado, analise SOMENTE o Estacionamento; deixe explícito quando fala da empresa individual e quando fala da visão consolidada.
- DADOS AUSENTES: quando uma informação operacional não estiver no payload, você pode recomendar acompanhamento futuro, mas NÃO pode afirmar que o fato ocorreu. Ex.: pode dizer "vale acompanhar futuramente a receita por evento e o número de veículos"; não pode dizer "a receita caiu porque houve menos eventos" se o número de eventos não foi enviado.
- EXEMPLO DE LEITURA ADEQUADA: "O resultado do Salvaterra Estacionamento deve ser analisado considerando a receita gerada pela operação, o peso dos freelancers e das despesas totais sobre essa receita e a margem operacional do período. Caso os dados operacionais de eventos ainda não estejam no payload, a análise deve se limitar aos dados financeiros disponíveis."`;

export const realEstateSalvaterraEstacionamentoTemplate: ReportTemplate = {
  id: "real-estate-salvaterra-estacionamento",
  name: "Real Estate — Salvaterra Estacionamento",
  segment: "real-estate",
  description: "Salvaterra Estacionamento: operação ligada a eventos do Terrazzo (receita x freelancers/manutenção).",
  // Mais específico que o condomínio (ambos contêm "salvaterra"); os matchers
  // são mutuamente exclusivos por "estacion", mas mantemos prioridade maior.
  priority: 110,
  matches: (ctx) =>
    ctx.companyNameLower.includes("salvaterra") &&
    ctx.companyNameLower.includes("estacion"),

  capabilities: { ...NO_VIVA_CAPABILITIES },
  prompt: { kind: "custom", systemContext: SALVATERRA_ESTACIONAMENTO_SYSTEM_CONTEXT },

  expectedKpis: [
    { key: "receita_estacionamento", label: "Receita do Estacionamento", source: "core-receita" },
    { key: "custos_freelancers", label: "Custos com Freelancers", source: "todo" },
    { key: "manutencoes_investimentos", label: "Manutenções / Investimentos", source: "todo" },
    { key: "resultado_estacionamento", label: "Resultado do Estacionamento", source: "core-resultado" },
    { key: "margem_operacional", label: "Margem Operacional", source: "core-margem" },
  ],
  expectedCharts: [
    { key: "receita_x_custos", title: "Receita x Custos Variáveis", note: "TODO" },
    { key: "composicao", title: "Composição do Resultado (Receita (-) Freelancers (-) Manutenção (=) Resultado)" },
    { key: "historico_resultado", title: "Histórico de Resultado" },
    { key: "historico_receita", title: "Histórico de Receita" },
    { key: "freelancers_sobre_receita", title: "Freelancers sobre Receita", note: "TODO" },
    { key: "receita_por_evento", title: "Receita por Evento", note: "TODO: se existir dado operacional de eventos" },
  ],
  semaforoIndicators: ["Resultado do Estacionamento", "Margem Operacional", "Freelancers / Receita"],
  alertHints: [
    "Custo com freelancers acima do padrão.",
    "Mês com baixa receita por poucos eventos.",
    "Manutenção consumindo o resultado.",
    "Resultado negativo mesmo com eventos.",
    "Receita concentrada em poucos dias/eventos.",
  ],
  actionHints: [
    "Acompanhar receita por evento.",
    "Revisar escala de freelancers.",
    "Analisar rentabilidade por tipo de evento.",
    "Separar manutenção recorrente de investimento.",
    "Criar controle de veículos/eventos, se ainda não existir.",
  ],
  // Mapeamento CONFIRMADO pela auditoria (plano custom do Salvaterra Estacionamento).
  dreAccountMapping: {
    receita_estacionamento: { label: "Receita de Estacionamento", codes: ["1.1"], status: "confirmed" },
    custos_freelancers: { label: "Custos com os Serviços Prestados (Mão de obra p/ Estacionamento)", codes: ["5"], status: "confirmed", note: "code 5 (calculado) = 5.1 Mão de obra para Estacionamento (freelancers)." },
    despesas_manutencao: { label: "Manutenção de imobilizado", codes: ["7.3.6"], status: "confirmed", note: "existe mas é pequena/esporádica; vai na tabela." },
    receita_liquida: { label: "Receita Liquida", codes: ["4"], status: "confirmed", note: "calculado f=1+2-3." },
    despesas_totais: { label: "Despesas Operacionais", codes: ["7"], status: "confirmed" },
    resultado_estacionamento: { label: "Resultado do Exercício", codes: ["11"], status: "confirmed", note: "calculado f=8-9-10." },
  },

  // ── Relatório REAL do Salvaterra Estacionamento (codes confirmados) ────────
  report: {
    kpiCards: [
      { label: "Receita do Estacionamento", code: "1.1", kind: "receita" },
      // Freelancers / Receita = Custo Freelancers (5) ÷ Receita (1). Maior = PIOR.
      {
        label: "Freelancers / Receita",
        kind: "margem",
        ratio: { numerator: ["5"], denominator: ["1"] },
        invertStatus: true,
      },
      { label: "Despesas Operacionais", code: "7", kind: "despesa" },
      { label: "Resultado do Estacionamento", code: "11", kind: "resultado" },
      // Margem Operacional = Resultado (11) ÷ Receita Líquida (4).
      { label: "Margem Operacional", kind: "margem", ratio: { numerator: ["11"], denominator: ["4"] } },
    ],
    kpiColumns: 5,
    previstoRealizado: [
      { label: "Receita do Estacionamento", code: "1.1", unidade: "currency" },
      { label: "Custo com Freelancers", code: "5", unidade: "currency" },
      { label: "Despesas de Manutenção", code: "7.3.6", unidade: "currency" },
      { label: "Despesas Operacionais", code: "7", unidade: "currency" },
      { label: "Resultado do Estacionamento", code: "11", unidade: "currency" },
    ],
    historicoAccountCode: "11",
    historicoTitle: "Histórico do Resultado do Estacionamento",
    historicoKLabels: true,
    historicoShowAcum: true,
    consolidatedGroup: {
      title: "Resultado Consolidado Salvaterra — Previsto × Realizado",
      matchName: "salvaterra",
      resultCode: "11",
    },
    enabledBlocks: ["diagnostico", "previstoRealizado", "historico", "alertas", "acoes"],
  },
};
