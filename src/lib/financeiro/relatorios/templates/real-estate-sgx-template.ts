import { NO_VIVA_CAPABILITIES, type ReportTemplate } from "./report-template-types";

// ============================================================================
// Template Real Estate — SGX (locações + projetos imobiliários)
// ============================================================================

const SGX_SYSTEM_CONTEXT = `CONTEXTO DA EMPRESA — SGX (Real Estate):
A SGX possui ativos imobiliários geradores de receita por LOCAÇÕES e, em paralelo, PROJETOS imobiliários em desenvolvimento (terrenos, obras, canteiros, despesas pré-operacionais).

Separe a análise em duas frentes SEMPRE que o DRE fornecido permitir:
- Resultado 1 — Locações: receitas de aluguel menos despesas dos imóveis locados.
- Resultado 2 — Projetos: receitas/despesas vinculadas a projetos futuros, terrenos, obras e desenvolvimento.
- Resultado Consolidado = Locações + Projetos + Administrativo (se existir).

O relatório deve responder:
- A operação de locações está se sustentando? Os imóveis alugados geram resultado positivo?
- Os projetos estão consumindo caixa dentro do esperado?
- O resultado consolidado está pressionado pela operação recorrente (locações) ou pelos projetos em desenvolvimento?

REGRAS:
- NÃO use conceitos de Franquias Viva (VVR, FEE disponível, margem média de eventos, sobrevivência de caixa) — eles não se aplicam à SGX.
- Se o DRE fornecido NÃO permitir separar com segurança Locações de Projetos, analise o resultado consolidado e registre em pontosAtencao/leituraPorIndicador que a separação por frente depende de mapeamento de contas a confirmar. NÃO invente a divisão nem números.`;

export const realEstateSgxTemplate: ReportTemplate = {
  id: "real-estate-sgx",
  name: "Real Estate — SGX",
  segment: "real-estate",
  description: "SGX: locações recorrentes + projetos imobiliários em desenvolvimento.",
  priority: 100,
  matches: (ctx) =>
    ctx.companyNameLower === "sgx" ||
    (ctx.segmentSlug === "real-estate" && ctx.companyNameLower.includes("sgx")),

  capabilities: { ...NO_VIVA_CAPABILITIES },
  prompt: { kind: "custom", systemContext: SGX_SYSTEM_CONTEXT },

  expectedKpis: [
    { key: "receita_locacoes", label: "Receita de Locações", source: "todo" },
    { key: "resultado_locacoes", label: "Resultado Locações", source: "todo" },
    { key: "despesas_projetos", label: "Despesas com Projetos", source: "todo" },
    { key: "resultado_projetos", label: "Resultado Projetos", source: "todo" },
    { key: "resultado_consolidado", label: "Resultado Consolidado", source: "core-resultado" },
  ],
  expectedCharts: [
    { key: "resultado_por_frente", title: "Resultado por frente (Locações, Projetos, Administrativo, Consolidado)", note: "TODO: depende do mapeamento por frente" },
    { key: "composicao", title: "Composição do Resultado SGX", note: "Receita de Locações (-) Despesas dos Imóveis (=) Resultado Locações (-) Despesas de Projetos (=) Resultado Consolidado" },
    { key: "historico_locacoes", title: "Histórico do Resultado das Locações", note: "TODO" },
    { key: "despesas_projetos_categoria", title: "Despesas de Projetos por categoria", note: "TODO: se as contas permitirem" },
  ],
  semaforoIndicators: ["Resultado Locações", "Resultado Projetos", "Resultado Consolidado"],
  alertHints: [
    "Resultado das locações negativo.",
    "Despesas de projetos acima do previsto.",
    "Receita de locações abaixo do orçamento.",
    "Projetos consumindo caixa acima do planejado.",
    "Resultado consolidado pressionado por despesas não recorrentes.",
  ],
  actionHints: [
    "Revisar despesas dos imóveis locados.",
    "Separar custos recorrentes de custos de desenvolvimento.",
    "Avaliar orçamento dos projetos em andamento.",
    "Monitorar consumo de caixa dos projetos.",
    "Revisar contratos de locação com baixa rentabilidade.",
  ],
  dreAccountMapping: {
    receita_locacoes: { label: "Receita de Locações", byNameIncludes: ["locação", "locacao", "aluguel", "aluguéis"], status: "todo", note: "Confirmar contas de receita de aluguel no plano da SGX." },
    despesas_imoveis: { label: "Despesas dos Imóveis Locados", byNameIncludes: ["imóvel", "imovel", "condomínio", "iptu", "manutenção"], status: "todo" },
    receita_projetos: { label: "Receita de Projetos", byNameIncludes: ["projeto"], status: "todo" },
    despesas_projetos: { label: "Despesas de Projetos", byNameIncludes: ["projeto", "obra", "terreno", "canteiro", "pré-operacional", "pre-operacional"], status: "todo", note: "SGX roteia entradas com cCodProjeto preenchido; ver project_mapping." },
    administrativo: { label: "Despesas Administrativas", byNameIncludes: ["administrativ"], status: "todo" },
  },
};
