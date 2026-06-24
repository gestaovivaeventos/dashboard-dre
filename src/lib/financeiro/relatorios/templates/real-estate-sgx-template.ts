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
  // Mapeamento CONFIRMADO pela auditoria de contas (plano custom da SGX).
  dreAccountMapping: {
    receita_locacoes: { label: "Receita com locação de imóvel", codes: ["1"], status: "confirmed" },
    despesas_imoveis: { label: "Despesas com Imóveis Locados", codes: ["2"], status: "confirmed" },
    resultado_locacoes: { label: "Resultado 1 - Locações", codes: ["3"], status: "confirmed", note: "calculado f=1-2" },
    receitas_projetos: { label: "Receitas Projetos", codes: ["12"], status: "confirmed" },
    despesas_projetos: { label: "Despesas Projetos", codes: ["13"], status: "confirmed" },
    resultado_projetos: { label: "Resultado 3 - Projetos", codes: ["14"], status: "confirmed", note: "calculado f=12-13" },
    resultado_consolidado: { label: "Resultado 4 - Locação + Operacional + Projetos", codes: ["15"], status: "confirmed", note: "calculado f=11+14" },
  },

  // ── Fase 2: relatório real da SGX por conta DRE (codes confirmados) ────────
  // Sinais: despesas chegam como magnitude POSITIVA (fórmulas usam 1-2, 12-13).
  // Reutilizamos os helpers do payload (Math.abs p/ exibir, statusDespesas...).
  report: {
    // Cards: 3 resultados (1ª linha) + Margem Líquida (2ª linha) → grade 3 cols.
    kpiCards: [
      { label: "Resultado Locações", code: "3", kind: "resultado" },
      { label: "Resultado Projetos", code: "14", kind: "resultado" },
      { label: "Resultado Final", code: "15", kind: "resultado" },
      // Margem Líquida = Resultado Final (15) / (Locações + Outras + Projetos).
      { label: "Margem Líquida", kind: "margem", ratio: { numerator: ["15"], denominator: ["1", "4", "12"] } },
    ],
    // 4 cards numa única linha (grade de 4 colunas — default).
    kpiColumns: 4,
    // Ordem por frente (Locações → Operacional → Projetos → Final). Despesas
    // entram como magnitude positiva (padrão do gráfico). "Resultado
    // Operacional" é derivado: Receitas Operacionais (4) − Despesas
    // Operacionais (Deduções 5 + Desp. Op. 7 + IRPJ 9 + Contrib. Social 10).
    previstoRealizado: [
      { label: "Receita com Locações", code: "1", unidade: "currency" },
      { label: "Despesas com Locações", code: "2", unidade: "currency" },
      { label: "Receitas Operacionais", code: "4", unidade: "currency" },
      { label: "Despesas Operacionais", codes: ["5", "7", "9", "10"], unidade: "currency" },
      { label: "Resultado Operacional", codes: ["4"], minus: ["5", "7", "9", "10"], unidade: "currency" },
      { label: "Receitas Projetos", code: "12", unidade: "currency" },
      { label: "Despesas Projetos", code: "13", unidade: "currency" },
      { label: "Resultado Projetos", code: "14", unidade: "currency" },
      { label: "Resultado Final", code: "15", unidade: "currency" },
    ],
    // Composição do Resultado e Semáforo removidos a pedido (não habilitados).
    // Histórico acompanha o Resultado Final (code 15).
    historicoAccountCode: "15",
    historicoTitle: "Histórico do Resultado Final",
    enabledBlocks: ["diagnostico", "previstoRealizado", "historico", "alertas", "acoes"],
  },
};
