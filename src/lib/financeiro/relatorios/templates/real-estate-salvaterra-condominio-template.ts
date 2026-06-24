import { NO_VIVA_CAPABILITIES, type ReportTemplate } from "./report-template-types";

// ============================================================================
// Template Real Estate — Salvaterra Condomínio / Mall (condomínio)
// ============================================================================

const SALVATERRA_CONDOMINIO_SYSTEM_CONTEXT = `CONTEXTO DA EMPRESA — Salvaterra Condomínio / Mall:
Condomínio que atua como administradora/proprietária operacional do empreendimento. Recebe aluguéis de algumas lojas, TAXAS CONDOMINIAIS (lojas, salão de festas Terrazzo e Hub 5º andar) e alguns REEMBOLSOS (ex.: água de lojas sem medição individualizada). É responsável pelas manutenções e despesas gerais do condomínio; a única despesa de pessoal relevante são os vigias (freelancers). O ESTACIONAMENTO é a única parte do imóvel fora do condomínio — é tratado separadamente pela empresa Salvaterra Estacionamento. Hub 5º andar e Terrazzo são imóveis da SGX (aluguéis recebíveis na SGX), mas pagam taxa de condomínio ao Salvaterra Mall.

A análise é FINANCEIRA-GERENCIAL de um condomínio — NÃO force indicadores operacionais que não existem no sistema.

Foque em: receita com locação; receitas condominiais; reembolsos (se houver); despesas totais; resultado do condomínio; margem líquida; aderência ao orçamento; impacto das despesas sobre o resultado; e o comportamento do resultado em relação ao consolidado Salvaterra.

A IA deve responder:
- A receita com locação ficou acima ou abaixo do orçamento?
- As receitas condominiais contribuíram de forma relevante para o resultado?
- As despesas totais ficaram controladas em relação ao orçamento?
- O condomínio gerou resultado positivo ou negativo?
- A margem líquida foi saudável?
- O resultado individual do condomínio contribuiu ou pressionou o consolidado Salvaterra?

BLOCO CONSOLIDADO: existe um bloco COMPLEMENTAR "Resultado Consolidado Salvaterra" (Condomínio + Estacionamento). A IA PODE comentá-lo, mas deve deixar CLARO quando fala da visão CONSOLIDADA e quando fala do CONDOMÍNIO individual. Fora desse bloco, NÃO misture nenhum dado do Estacionamento na análise do Condomínio.

REGRAS RÍGIDAS:
- Use APENAS os dados enviados no payload (do Condomínio). NÃO invente números.
- NÃO sugira: VVR, FEE disponível, sobrevivência de caixa, margem média de eventos da Franquias Viva, carteira de fundos, fundos de formatura, gap de reembolso da Village, locações/projetos da SGX, fechamento de eventos da Feat Produções, BV da Case Shows.
- NÃO sugira cobrança de aluguel ou condomínio AO estacionamento — o estacionamento NÃO paga aluguel nem condomínio ao Salvaterra Mall.
- Diagnóstico executivo, claro e financeiro, sem tom alarmista. Ações práticas e aderentes ao modelo condominial.`;

export const realEstateSalvaterraCondominioTemplate: ReportTemplate = {
  id: "real-estate-salvaterra-condominio",
  name: "Real Estate — Salvaterra Condomínio",
  segment: "real-estate",
  description: "Salvaterra Condomínio/Mall: aluguéis, taxas condominiais, reembolsos e despesas de manutenção.",
  priority: 100,
  matches: (ctx) =>
    ctx.companyNameLower.includes("salvaterra") &&
    (ctx.companyNameLower.includes("condom") || ctx.companyNameLower.includes("mall")) &&
    !ctx.companyNameLower.includes("estacion"),

  capabilities: { ...NO_VIVA_CAPABILITIES },
  prompt: { kind: "custom", systemContext: SALVATERRA_CONDOMINIO_SYSTEM_CONTEXT },

  expectedKpis: [
    { key: "receita_alugueis", label: "Receita de Aluguéis", source: "todo" },
    { key: "taxas_condominiais", label: "Taxas Condominiais", source: "todo" },
    { key: "reembolsos", label: "Reembolsos", source: "todo" },
    { key: "despesas_condominiais", label: "Despesas Condominiais", source: "core-despesas" },
    { key: "resultado_condominial", label: "Resultado Condominial", source: "core-resultado" },
  ],
  expectedCharts: [
    { key: "composicao_receitas", title: "Composição das Receitas (Aluguéis, Taxas, Reembolsos, Outras)", note: "TODO" },
    { key: "composicao_despesas", title: "Composição das Despesas (Manutenção, Água/Energia, Freelancers, Terceiros, Outros)", note: "TODO" },
    { key: "cobertura", title: "Cobertura das Despesas (Taxas + Reembolsos vs Despesas Condominiais)", note: "TODO" },
    { key: "historico", title: "Histórico do Resultado Condominial" },
  ],
  semaforoIndicators: ["Cobertura Condominial", "Resultado Condominial", "Despesas de Manutenção"],
  alertHints: [
    "Despesas condominiais acima das receitas recorrentes.",
    "Manutenção acima do previsto.",
    "Reembolso de água abaixo do custo relacionado.",
    "Gastos com freelancers acima do padrão.",
    "Resultado condominial negativo.",
    "Cobertura condominial abaixo de 100%.",
  ],
  actionHints: [
    "Revisar rateio das despesas condominiais.",
    "Avaliar reajuste de taxas condominiais.",
    "Analisar custos de manutenção por categoria.",
    "Acompanhar reembolsos de água.",
    "Separar despesas ordinárias e extraordinárias.",
  ],
  // Mapeamento CONFIRMADO pela auditoria (plano custom do Salvaterra Condomínio).
  dreAccountMapping: {
    receita_locacao: { label: "Receita com Locação de Imóveis", codes: ["1.1"], status: "confirmed" },
    receitas_condominiais: { label: "Receitas de condominio", codes: ["2.3"], status: "confirmed", note: "filho de 2 Outras Receitas." },
    reembolsos: { label: "Reembolso de Despesas", codes: ["2.6"], status: "confirmed", note: "AMBÍGUO: existe também 2.5 'Reembolsos de Tributos'. Usamos 2.6 (água/despesas, conforme contexto)." },
    receita_total: { label: "Receita Bruta (Operacional Bruta + Outras Receitas)", codes: ["1", "2"], status: "confirmed" },
    receita_liquida: { label: "Receita Liquida", codes: ["4"], status: "confirmed", note: "calculado f=1+2-3." },
    despesas_totais: { label: "Despesas Operacionais", codes: ["7"], status: "confirmed", note: "summary; inclui pessoal/vigias (7.2.20), administrativas (manutenção 7.3.6), etc." },
    resultado_condominio: { label: "Resultado do Exercicio", codes: ["11"], status: "confirmed", note: "calculado f=8-9-10." },
  },

  // ── Relatório REAL do Salvaterra Condomínio (codes confirmados) ────────────
  report: {
    // 5 cards executivos.
    kpiCards: [
      { label: "Receita com Locação", code: "1.1", kind: "receita" },
      { label: "Receitas Condominiais", code: "2.3", kind: "receita" },
      { label: "Despesas Totais", code: "7", kind: "despesa" },
      { label: "Resultado do Condomínio", code: "11", kind: "resultado" },
      // Margem Líquida = Resultado do Exercício (11) ÷ Receita Líquida (4).
      { label: "Margem Líquida", kind: "margem", ratio: { numerator: ["11"], denominator: ["4"] } },
    ],
    kpiColumns: 5,
    previstoRealizado: [
      { label: "Receita com Locação", code: "1.1", unidade: "currency" },
      { label: "Receitas Condominiais", code: "2.3", unidade: "currency" },
      { label: "Reembolsos", code: "2.6", unidade: "currency" },
      { label: "Receita Total", codes: ["1", "2"], unidade: "currency" },
      { label: "Despesas Totais", code: "7", unidade: "currency" },
      { label: "Resultado do Condomínio", code: "11", unidade: "currency" },
      { label: "Margem Líquida", unidade: "percent", ratio: { numerator: ["11"], denominator: ["4"] } },
    ],
    historicoAccountCode: "11",
    historicoTitle: "Histórico do Resultado do Condomínio",
    historicoKLabels: true,
    consolidatedGroup: {
      title: "Resultado Consolidado Salvaterra — Previsto × Realizado",
      matchName: "salvaterra",
      resultCode: "11",
    },
    // Oculta VVR/FEE/sobrevivência (via capabilities) + acumulado/composição/
    // semáforo (via allowlist). Bloco consolidado e histórico aparecem.
    enabledBlocks: ["diagnostico", "previstoRealizado", "historico", "alertas", "acoes"],
  },
};
