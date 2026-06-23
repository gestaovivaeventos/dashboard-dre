import { NO_VIVA_CAPABILITIES, type ReportTemplate } from "./report-template-types";

// ============================================================================
// Template GENÉRICO — fallback seguro para empresas sem template específico.
// ============================================================================
// Núcleo DRE puro (Receita / Despesas / Resultado / Margem), sem indicadores de
// Franquias Viva. Usa o GENERIC_SYSTEM_PROMPT atual. `matches` sempre true, mas
// com prioridade 0 — só vence quando nenhum outro template casa.
// ============================================================================

export const genericTemplate: ReportTemplate = {
  id: "generic",
  name: "Genérico — DRE padrão",
  segment: "generic",
  description:
    "Fallback para empresas sem template específico. Indicadores genéricos de DRE, sem VVR/FEE nem regras de segmento.",
  priority: 0,
  matches: () => true,

  capabilities: { ...NO_VIVA_CAPABILITIES },
  prompt: { kind: "generic" },

  expectedKpis: [
    { key: "receita", label: "Receita", source: "core-receita" },
    { key: "despesas", label: "Despesas", source: "core-despesas" },
    { key: "resultado", label: "Resultado", source: "core-resultado" },
    { key: "margem", label: "Margem", source: "core-margem" },
  ],
  expectedCharts: [
    { key: "previsto_realizado", title: "Previsto x Realizado" },
    { key: "composicao", title: "Composição do Resultado" },
    { key: "historico", title: "Histórico do Resultado" },
  ],
  semaforoIndicators: ["Resultado", "Margem"],
  alertHints: [],
  actionHints: [],
  dreAccountMapping: {
    receita: { label: "Receita Operacional Bruta", codes: ["1"], status: "confirmed" },
    despesas: { label: "Despesas Operacionais", codes: ["7"], status: "confirmed" },
    resultado: { label: "Resultado do Exercício", codes: ["11"], status: "confirmed" },
  },
};
