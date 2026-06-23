import { NO_VIVA_CAPABILITIES, type ReportTemplate } from "./report-template-types";

// ============================================================================
// Template Real Estate — Village (construtora: custos reembolsáveis + taxa adm)
// ============================================================================

const VILLAGE_SYSTEM_CONTEXT = `CONTEXTO DA EMPRESA — Village (construtora):
A receita principal vem de contratos de construção e serviços prestados. Parte relevante dos custos de serviços é composta por gastos REEMBOLSÁVEIS pelos contratantes das obras (ex.: empreiteiros CLT e despesas vinculadas aos projetos), que aparecem nos custos de serviços/produtos de contratos vendidos. Em contrapartida, os REEMBOLSOS aparecem na receita de clientes por serviços vendidos. Há DELAY natural: custos do mês M podem ser reembolsados em M+1. A receita efetiva está ligada à TAXA ADMINISTRATIVA dos contratos (~15% do valor total do projeto).

Indicador central: Gap de Reembolso = Reembolsos Recebidos − Custos Reembolsáveis.

O relatório deve responder:
- Os custos reembolsáveis estão sendo compensados pelos reembolsos?
- Existe descasamento relevante entre custo M e reembolso M+1?
- A taxa administrativa está gerando margem suficiente (referência ~15%)?
- O resultado dos contratos está saudável? A operação consome caixa por delay de reembolso?

REGRAS:
- NÃO use conceitos de Franquias Viva (VVR, FEE disponível, margem de eventos, sobrevivência de caixa).
- Compare, quando os dados permitirem, custos do mês atual com reembolsos do mês seguinte.
- Se as contas de custo reembolsável, reembolso e taxa administrativa não estiverem identificáveis com segurança no DRE fornecido, analise o resultado dos contratos de forma agregada e registre que o Gap de Reembolso e a Taxa Administrativa dependem de mapeamento de contas a confirmar. NÃO invente valores nem códigos.`;

export const realEstateVillageTemplate: ReportTemplate = {
  id: "real-estate-village",
  name: "Real Estate — Village",
  segment: "real-estate",
  description: "Village: construtora com custos reembolsáveis, reembolsos (delay M+1) e taxa administrativa.",
  priority: 100,
  matches: (ctx) => ctx.companyNameLower.includes("village"),

  capabilities: { ...NO_VIVA_CAPABILITIES },
  prompt: { kind: "custom", systemContext: VILLAGE_SYSTEM_CONTEXT },

  expectedKpis: [
    { key: "receita_servicos", label: "Receita de Serviços", source: "core-receita" },
    { key: "custos_reembolsaveis", label: "Custos Reembolsáveis", source: "todo" },
    { key: "reembolsos", label: "Reembolsos", source: "todo" },
    { key: "gap_reembolso", label: "Gap de Reembolso", source: "todo", note: "Reembolsos − Custos Reembolsáveis" },
    { key: "resultado_operacional", label: "Resultado Operacional", source: "core-resultado" },
  ],
  expectedCharts: [
    { key: "custos_x_reembolsos", title: "Custos Reembolsáveis x Reembolsos", note: "TODO" },
    { key: "custos_m_reembolsos_m1", title: "Custos M vs Reembolsos M+1", note: "TODO: se possível" },
    { key: "historico_gap", title: "Histórico do Gap de Reembolso", note: "TODO" },
    { key: "taxa_administrativa", title: "Receita de Taxa Administrativa", note: "TODO: se a conta existir" },
    { key: "composicao", title: "Composição do Resultado Village", note: "Receita (-) Custos Reembolsáveis (+) Reembolsos (+) Taxa Adm (-) Despesas (=) Resultado" },
  ],
  semaforoIndicators: ["Gap de Reembolso", "Taxa Administrativa", "Resultado Operacional"],
  alertHints: [
    "Custos reembolsáveis acima dos reembolsos.",
    "Gap de reembolso negativo.",
    "Taxa administrativa abaixo de 15%.",
    "Reembolso atrasado.",
    "Resultado positivo apenas por reembolso pontual.",
    "Custo de obra crescendo mais rápido que a receita contratual.",
  ],
  actionHints: [
    "Conciliar custos reembolsáveis por obra.",
    "Acompanhar reembolsos esperados no mês seguinte.",
    "Revisar contratos com taxa administrativa abaixo do padrão.",
    "Criar visão por obra/contrato.",
    "Acompanhar aging de reembolsos pendentes.",
  ],
  dreAccountMapping: {
    receita_servicos: { label: "Receita de Serviços Prestados", byNameIncludes: ["serviço", "servico", "contrato"], status: "todo" },
    custos_reembolsaveis: { label: "Custos Reembolsáveis", byNameIncludes: ["reembolsáv", "reembolsav", "empreiteiro", "serviços prestados", "produtos de contratos"], status: "todo", note: "Aparecem em custos de serviços/produtos de contratos vendidos." },
    reembolsos: { label: "Reembolsos de Obras", byNameIncludes: ["reembolso", "serviços vendidos"], status: "todo", note: "Aparecem na receita de clientes por serviços vendidos." },
    taxa_administrativa: { label: "Taxa Administrativa", byNameIncludes: ["taxa administrativa", "taxa adm", "administração"], status: "todo", note: "Referência ~15% do valor do projeto." },
  },
};
