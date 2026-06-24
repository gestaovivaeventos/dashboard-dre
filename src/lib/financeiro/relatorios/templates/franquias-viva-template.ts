import type { ReportTemplate } from "./report-template-types";

// ============================================================================
// Template ATUAL de Franquias Viva — registrado SEM alterar comportamento.
// ============================================================================
// Este template apenas DECLARA o que o relatório de Franquias Viva já faz hoje.
// Ele liga todas as capacidades (VVR, FEE, sobrevivência, margem de eventos) e
// roteia o prompt para `kind: "franquias-viva"`, que devolve o
// FRANQUIAS_VIVA_SYSTEM_PROMPT atual INTOCADO. Nenhum número muda para a Viva.
// ============================================================================

export const franquiasVivaTemplate: ReportTemplate = {
  id: "franquias-viva",
  name: "Franquias Viva",
  segment: "franquias-viva",
  description:
    "Modelo consolidado das franquias Viva (VVR, FEE disponível, margem média de eventos, sobrevivência de caixa). Mantido exatamente como está.",
  // Prioridade máxima: empresa do segmento "franquias-viva" SEMPRE usa este
  // template, mesmo que o nome casasse por acaso com algum matcher de Real
  // Estate. Garante que o comportamento da Viva nunca muda.
  priority: 1000,
  matches: (ctx) => ctx.segmentSlug === "franquias-viva",

  capabilities: {
    vvrFee: true,
    sobrevivenciaCaixa: true,
    margemMediaEventos: true,
  },
  prompt: { kind: "franquias-viva" },

  expectedKpis: [
    { key: "receita", label: "Receita", source: "core-receita" },
    { key: "despesas", label: "Despesas", source: "core-despesas" },
    { key: "resultado", label: "Resultado", source: "core-resultado" },
    { key: "margem", label: "Margem", source: "core-margem" },
    { key: "fee_disponivel", label: "FEE disponível", source: "todo", note: "companies.fee_disponivel" },
    { key: "vvr", label: "VVR", source: "todo", note: "company_fee_vvr" },
    { key: "sobrevivencia_caixa", label: "Sobrevivência de caixa", source: "todo" },
    { key: "margem_media_eventos", label: "Margem média dos eventos", source: "todo", note: "companies.margem_media_eventos" },
  ],
  expectedCharts: [
    { key: "previsto_realizado", title: "Previsto x Realizado" },
    { key: "composicao", title: "Composição do Resultado" },
    { key: "historico", title: "Histórico do Resultado" },
    { key: "vvr_serie", title: "VVR — série anual" },
  ],
  semaforoIndicators: ["Resultado", "Margem", "FEE disponível", "VVR", "Sobrevivência de caixa"],
  alertHints: [],
  actionHints: [],
  dreAccountMapping: {
    receita: { label: "Receita Operacional Bruta", codes: ["1"], status: "confirmed" },
    despesas: { label: "Despesas Operacionais", codes: ["7"], status: "confirmed" },
    resultado: { label: "Resultado do Exercício", codes: ["11"], status: "confirmed" },
  },
};
