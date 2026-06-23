import { NO_VIVA_CAPABILITIES, type ReportTemplate } from "./report-template-types";

// ============================================================================
// Template Real Estate — Salvaterra Condomínio / Mall (condomínio)
// ============================================================================

const SALVATERRA_CONDOMINIO_SYSTEM_CONTEXT = `CONTEXTO DA EMPRESA — Salvaterra Condomínio / Mall:
Estrutura condominial que atua como administradora/proprietária operacional do condomínio. Receitas: aluguéis de algumas lojas, taxas condominiais (lojas, salão de festas Terrazzo e Hub 5º andar) e reembolsos específicos (ex.: água de lojas sem medição individualizada). Despesas: manutenções e despesas gerais do empreendimento; a única despesa de pessoal relevante são vigias freelancers.

Observações:
- O estacionamento NÃO faz parte deste relatório (é tratado pela empresa Salvaterra Estacionamento).
- Hub 5º andar e Terrazzo são imóveis da SGX (aparecem como recebíveis de aluguel na SGX), mas pagam taxa condominial ao Salvaterra Mall.

Indicador central: Cobertura Condominial = (Taxas Condominiais + Reembolsos) / Despesas Condominiais.
- Acima de 100%: as receitas condominiais cobrem as despesas.
- Abaixo de 100%: o condomínio depende de outras receitas ou gera déficit.

O relatório deve responder:
- As receitas condominiais cobrem as despesas do condomínio?
- Aluguéis e taxas sustentam a operação? As manutenções estão pressionando o resultado?
- Os reembolsos compensam despesas específicas? O condomínio gera sobra ou déficit operacional?

REGRAS:
- NÃO use conceitos de Franquias Viva (VVR, FEE disponível, margem de eventos, sobrevivência de caixa).
- Se taxas condominiais, reembolsos e despesas de manutenção não estiverem claramente identificáveis no DRE fornecido, analise o resultado condominial agregado e registre que a Cobertura Condominial depende de mapeamento de contas a confirmar. NÃO invente valores nem códigos.`;

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
  dreAccountMapping: {
    receita_alugueis: { label: "Receita de Aluguéis", byNameIncludes: ["aluguel", "aluguéis", "locação", "locacao"], status: "todo" },
    taxas_condominiais: { label: "Taxas Condominiais", byNameIncludes: ["condominial", "condomínio", "condominio", "taxa"], status: "todo" },
    reembolsos: { label: "Reembolsos", byNameIncludes: ["reembolso", "água", "agua"], status: "todo" },
    despesas_manutencao: { label: "Despesas de Manutenção", byNameIncludes: ["manutenção", "manutencao"], status: "todo" },
    freelancers: { label: "Vigias Freelancers", byNameIncludes: ["freelancer", "vigia"], status: "todo" },
  },
};
