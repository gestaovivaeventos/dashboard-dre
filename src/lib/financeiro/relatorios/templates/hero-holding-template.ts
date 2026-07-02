import {
  NO_VIVA_CAPABILITIES,
  type ReportTemplate,
} from "./report-template-types";

// ============================================================================
// Template da HERO HOLDING — exclusivo desta empresa.
// ============================================================================
// A Hero Holding pertence ao segmento "franquias-viva", mas NÃO é analisada
// como uma franquia individual: ela é uma HOLDING composta por 7 unidades Viva.
// Por isso o relatório dela difere do das demais Franquias Viva em dois pontos,
// e SOMENTE para ela:
//
//   1. Oculta os indicadores INDIVIDUAIS que só fazem sentido para uma unidade
//      operacional — FEE disponível, VVR, sobrevivência de caixa, margem média
//      dos eventos e inadimplência atual. Isso é obtido desligando TODAS as
//      capacidades da Viva (NO_VIVA_CAPABILITIES): o payload deleta os cards de
//      FEE/VVR/sobrevivência; margem média e inadimplência também são gated por
//      `capabilities.margemMediaEventos` (ver one-page-payload.ts). As demais
//      Franquias Viva continuam com todas as capacidades ligadas (template
//      franquias-viva), então nada muda para elas.
//
//   2. Adiciona um QUADRO COMPARATIVO das 7 empresas do grupo (bloco
//      `holdingComparativo`), reutilizando exatamente os mesmos dados e regras
//      já validados no relatório individual de cada unidade Viva.
//
// Prioridade acima do template franquias-viva (1000) para que a Hero Holding
// SEMPRE resolva para este template, mesmo pertencendo àquele segmento.
// ============================================================================

// Nome canônico da holding (o matcher normaliza o nome cru da empresa). Mantido
// como constante para casar com a normalização usada no matcher.
const HERO_HOLDING_NAME = "hero holding";

// Empresas que compõem a Hero Holding, NA ORDEM de exibição do comparativo.
// O casamento é por nome NORMALIZADO (sem acento, minúsculo), então "Viva
// Petrópolis" (com acento na lista) casa com "Viva Petropolis" (como está no
// banco). NÃO incluir outras empresas — o comparativo usa apenas estas 7.
export const HERO_HOLDING_COMPANY_NAMES = [
  "Viva Barbacena",
  "Viva Campo Grande",
  "Viva Curitiba",
  "Viva Juiz de Fora",
  "Viva Petrópolis",
  "Viva Go",
  "Viva Volta Redonda",
];

// Normaliza um nome de empresa: trim + minúsculo + remove acentos. Mesma ideia
// da normalização usada em company-period-limits.ts (regras single-company).
export function normalizeCompanyName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ");
}

export const heroHoldingTemplate: ReportTemplate = {
  id: "hero-holding",
  name: "Hero Holding",
  segment: "franquias-viva",
  description:
    "Modelo de HOLDING da Hero Holding (segmento Franquias Viva): oculta os indicadores individuais e exibe um comparativo das 7 unidades Viva do grupo. Exclusivo desta empresa.",
  // Precedência acima do template de Franquias Viva (1000) — a Hero Holding é
  // do mesmo segmento, mas deve SEMPRE cair neste template.
  priority: 2000,
  matches: (ctx) => normalizeCompanyName(ctx.companyName) === HERO_HOLDING_NAME,

  // Todas as capacidades da Viva DESLIGADAS → o payload remove os cards
  // individuais de FEE/VVR/sobrevivência (e, via gate de margemMediaEventos,
  // também margem média dos eventos e inadimplência atual).
  capabilities: NO_VIVA_CAPABILITIES,
  prompt: { kind: "hero-holding" },

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

  report: {
    // Allowlist de blocos: mantém o núcleo do relatório da Hero (DRE
    // consolidado próprio), ADICIONA o comparativo da holding e OMITE o gráfico
    // de VVR (a holding não tem VVR próprio — evita espaço vazio).
    enabledBlocks: [
      "diagnostico",
      "holdingComparativo",
      "previstoRealizado",
      "composicao",
      "acumuladoAno",
      "historico",
      "semaforo",
      "alertas",
      "acoes",
    ],
    holdingComparativo: {
      key: "holdingComparativo",
      title: "Comparativo das empresas da holding",
      companyNames: HERO_HOLDING_COMPANY_NAMES,
    },
  },
};
