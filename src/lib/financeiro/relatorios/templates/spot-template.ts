import { NO_VIVA_CAPABILITIES, type ReportTemplate } from "./report-template-types";

// ============================================================================
// Template Spot — cenografia/produção/locação de mobiliário + braço logístico
// Express. Empresa PRÓPRIA, isolada das demais. Plano DRE custom (codes 1..15).
// A Express tem DRE separado e SÓ aparece no bloco "Visão Gerencial — Spot +
// Express" (consolidado). Cards/tabela/composição/frete usam SOMENTE a Spot.
// ============================================================================

// Fontes de receita da Spot = as 7 sub-contas de "1 Receita Operacional Bruta"
// (divisão correta confirmada pelo Marcelo). Somam ao code 1, então o % é sobre
// a Receita Total. Usado no card "Principal Fonte" e na "Composição da Receita".
const SPOT_RECEITA_SOURCES = [
  { label: "Locação de mobiliário", codes: ["1.1"] },
  { label: "Personalização", codes: ["1.2"] },
  { label: "Iluminação", codes: ["1.3"] },
  { label: "Reembolso de Avarias", codes: ["1.4"] },
  { label: "Serviços de Montagem", codes: ["1.5"] },
  { label: "Serviços de Frete", codes: ["1.6"] },
  { label: "Produção de móveis", codes: ["1.7"] },
];

const SPOT_SYSTEM_CONTEXT = `CONTEXTO DA EMPRESA — Spot:
A Spot é uma empresa de CENOGRAFIA: fabrica mobiliários, cenários e ambientes para eventos. Produz móveis SOB DEMANDA (para venda ou locação) e mantém um ESTOQUE/ACERVO de itens já produzidos para LOCAÇÃO futura. Funciona como OFICINA (produção) + GALPÃO (armazenagem e itens para locação). Possui um braço logístico, a EXPRESS, que é a transportadora da própria Spot (alguns veículos próprios, usados para os FRETES dos produtos). A operação logística é da Express, mas a COBRANÇA e o FATURAMENTO dos fretes são feitos via Spot.

IMPORTANTE — a Express tem DRE SEPARADO. Por isso, neste relatório:
- a análise principal é da SPOT;
- os cards usam apenas dados da Spot;
- a tabela principal usa apenas dados da Spot;
- os gráficos individuais (composição da receita, frete) usam apenas dados da Spot;
- a Express aparece APENAS no bloco "Visão Gerencial — Spot + Express".

A análise considera quatro dimensões: (1) Produção sob demanda; (2) Locação de acervo; (3) Frete/logística; (4) Estrutura fixa de oficina e galpão.

Foque em: receita total; principal fonte de receita (mix entre venda/produção, locação e frete, quando houver dados); composição da receita; despesas operacionais; resultado operacional; resultado final; margem líquida; receita e custo logístico (frete), quando houver contas claras; resultado da Express SÓ no bloco gerencial; resultado consolidado Spot + Express; aderência ao orçamento; resultado do exercício previsto × realizado.

CUIDADOS:
- "Locação" na Spot = locação de MOBILIÁRIO, cenografia, peças, itens e acervo. NÃO é aluguel imobiliário (SGX) nem locação de salão (Sirena/Terrazzo).
- NÃO trate a Spot como produtora de eventos, salão de eventos, franquia, Real Estate ou construtora.
- NÃO misture dados da Express nos indicadores individuais da Spot (cards/tabela/composição/margem). A Express só entra na Visão Gerencial.
- NÃO afirme baixo aproveitamento do acervo se não houver dado de acervo/locação no payload.
- NÃO afirme custos logísticos se as categorias não estiverem disponíveis.
- NÃO cite dados operacionais que não estejam no payload.

VISÃO GERENCIAL (Spot + Express): bloco COMPLEMENTAR com Resultado Spot, Resultado Express e Resultado Consolidado (= Resultado Final Spot + Resultado Final Express). A IA pode comentá-lo, mas deve deixar CLARO quando fala do CONSOLIDADO e quando fala da SPOT individual. Ex. adequado: "A Spot teve resultado positivo, mas a Express pressionou o consolidado." Ex. INADEQUADO: "A Receita Total da Spot inclui a receita da Express." / "A margem líquida da Spot considera o resultado da Express."

REGRAS RÍGIDAS (isolamento):
- Use APENAS os dados financeiros do payload (Spot nos indicadores individuais; Express só no bloco gerencial). NÃO invente números, contas, categorias, empresas ou fornecedores.
- NÃO mencione nem aplique contexto de outras empresas: VVR, FEE disponível, sobrevivência de caixa, margem média de eventos, fundos de formatura (Franquias Viva); locações/projetos (SGX); gap de reembolso / resultado ajustado (Village); condomínio/estacionamento (Salvaterra); fechamento de eventos (Feat Produções); BV de shows (Case Shows); ocupação de agenda (Sirena/Terrazzo); parceiros/BVs/comissões (Young Med).

ALERTAS esperados (quando os dados sustentarem): receita abaixo do orçamento; principal fonte de receita muito concentrada; despesas operacionais acima do orçamento; resultado operacional abaixo do previsto; resultado final negativo/abaixo do orçamento; margem líquida pressionada; receita de frete não compensando o custo logístico; resultado da Express pressionando o consolidado; consolidado Spot + Express abaixo do previsto.

AÇÕES recomendadas esperadas: acompanhar o mix de receita (venda/produção, locação, frete); monitorar despesas da oficina e do galpão; avaliar a rentabilidade da locação de itens já produzidos; acompanhar os custos logísticos dos fretes; revisar a precificação de frete quando o custo logístico pressionar o resultado; acompanhar o impacto da Express no consolidado; criar/aprimorar controle gerencial de acervo (itens disponíveis, locados, receita por item); separar custos de produção, manutenção de acervo e logística; avaliar se o crescimento de receita está virando margem líquida.

Tom: executivo, financeiro, objetivo, sem alarmismo, com foco em decisão e ação.`;

export const spotTemplate: ReportTemplate = {
  id: "spot",
  name: "Spot",
  segment: "spot",
  description:
    "Spot: cenografia/produção/locação de mobiliário + frete; Express (logística) só na visão gerencial consolidada.",
  // Empresa única "Spot"; "Express" tem template próprio? Não — Express usa o
  // genérico. O matcher exige "spot" e exclui "express" por segurança.
  priority: 120,
  matches: (ctx) =>
    ctx.companyNameLower.includes("spot") && !ctx.companyNameLower.includes("express"),

  capabilities: { ...NO_VIVA_CAPABILITIES },
  prompt: { kind: "custom", systemContext: SPOT_SYSTEM_CONTEXT },

  expectedKpis: [
    { key: "receita_total", label: "Receita Total", source: "core-receita" },
    { key: "principal_fonte", label: "Principal Fonte de Receita", source: "todo", note: "máx. entre fontes 1.1/1.7+1.2/1.6/1.3+1.4+1.5." },
    { key: "despesas_operacionais", label: "Despesas Operacionais", source: "core-despesas" },
    { key: "resultado_operacional", label: "Resultado Operacional", source: "core-resultado" },
    { key: "margem_liquida", label: "Margem Líquida", source: "core-margem" },
  ],
  expectedCharts: [
    { key: "composicao_receita", title: "Composição da Receita" },
    { key: "frete_logistica", title: "Frete: Receita × Custo Logístico" },
    { key: "visao_gerencial", title: "Visão Gerencial — Spot + Express" },
    { key: "resultado_exercicio", title: "Resultado do Exercício — Previsto × Realizado" },
  ],
  semaforoIndicators: ["Resultado Operacional", "Margem Líquida", "Resultado Final"],
  alertHints: [
    "Receita abaixo do orçamento.",
    "Principal fonte de receita muito concentrada.",
    "Despesas operacionais acima do orçamento.",
    "Resultado operacional abaixo do previsto.",
    "Margem líquida pressionada.",
    "Receita de frete não compensando o custo logístico.",
    "Resultado da Express pressionando o consolidado Spot + Express.",
  ],
  actionHints: [
    "Acompanhar o mix de receita (venda/produção, locação, frete).",
    "Avaliar a rentabilidade da locação de itens do acervo.",
    "Acompanhar os custos logísticos dos fretes.",
    "Acompanhar o impacto da Express no consolidado.",
    "Criar controle gerencial de acervo (itens disponíveis/locados).",
  ],
  // Mapeamento CONFIRMADO pela auditoria (plano custom da Spot).
  dreAccountMapping: {
    receita_total: { label: "Receita Operacional Bruta", codes: ["1"], status: "confirmed", note: "summary; 1.1 Locação, 1.2 Personalização, 1.3 Iluminação, 1.4 Avarias, 1.5 Montagem, 1.6 Frete, 1.7 Produção." },
    receita_liquida: { label: "Receita Liquida", codes: ["4"], status: "confirmed", note: "calculado f=1+2-3; base da Margem Líquida (15/4)." },
    receita_fontes: { label: "Fontes de receita (7 sub-contas de 1)", codes: ["1.1", "1.2", "1.3", "1.4", "1.5", "1.6", "1.7"], status: "confirmed", note: "1.1 Locação, 1.2 Personalização, 1.3 Iluminação, 1.4 Avarias, 1.5 Montagem, 1.6 Frete, 1.7 Produção. Card Principal Fonte + Composição da Receita." },
    frete_receita: { label: "Clientes - Serviços Frete", codes: ["1.6"], status: "confirmed" },
    frete_custo: { label: "Custo Logístico (Fretes + Veículos)", codes: ["5.7", "5.8"], status: "confirmed" },
    despesas_operacionais: { label: "Despesas Operacionais", codes: ["7"], status: "confirmed" },
    resultado_operacional: { label: "Lucro ou Prejuizo Operacional", codes: ["8"], status: "confirmed", note: "calculado f=6-7." },
    resultado_final: { label: "Resultado do Exercício", codes: ["15"], status: "confirmed", note: "calculado f=12-13-14." },
    express_resultado: { label: "Resultado do Exercício (Express)", codes: ["15"], status: "confirmed", note: "plano Express, só no bloco Visão Gerencial." },
  },

  // ── Relatório REAL da Spot ─────────────────────────────────────────────────
  report: {
    kpiCards: [
      { label: "Receita Total", code: "1", kind: "receita" },
      // Principal Fonte = a fonte de maior valor entre as SPOT_RECEITA_SOURCES.
      { label: "Principal Fonte de Receita", kind: "fonte", fonteSources: SPOT_RECEITA_SOURCES },
      { label: "Despesas Operacionais", code: "7", kind: "despesa" },
      { label: "Resultado Operacional", code: "8", kind: "resultado" },
      // Margem Líquida = Resultado do Exercício (15) ÷ Receita Líquida (4).
      { label: "Margem Líquida", kind: "margem", ratio: { numerator: ["15"], denominator: ["4"] } },
    ],
    kpiColumns: 5,
    // Tabela "Desempenho do mês vs orçamento" — 3 linhas, só Spot.
    previstoRealizado: [
      { label: "Receita Total", code: "1", unidade: "currency" },
      { label: "Despesas Operacionais", code: "7", unidade: "currency" },
      { label: "Resultado Final", code: "15", unidade: "currency" },
    ],
    // Composição da Receita (fontes) + Frete (receita × custo × resultado).
    breakdownBlocks: [
      {
        key: "composicaoReceita",
        title: "Composição da Receita",
        showPctOfTotal: true,
        rows: SPOT_RECEITA_SOURCES,
      },
      {
        key: "freteLogistica",
        title: "Frete: Receita × Custo Logístico",
        rows: [
          { label: "Receita com Frete", codes: ["1.6"] },
          { label: "Custo Logístico", codes: [], minus: ["5.7", "5.8"] },
          { label: "Resultado Logístico", codes: ["1.6"], minus: ["5.7", "5.8"], emphasis: true },
        ],
      },
    ],
    // Visão Gerencial — Spot + Express (per-company custom: code 15 de cada).
    consolidatedGroup: {
      title: "Visão Gerencial — Spot + Express",
      matchName: "spot",
      matchNames: ["Spot", "Express"],
      resultCode: "15",
      perCompanyPlan: true,
      consolidatedLabel: "Resultado Consolidado Spot + Express",
    },
    historicoAccountCode: "15",
    historicoTitle: "Resultado do Exercício — Previsto × Realizado",
    historicoKLabels: true,
    historicoShowAcum: true,
    // Oculta VVR/FEE/sobrevivência (capabilities) + composição-waterfall/semáforo/
    // acumulado genérico (allowlist). Aparecem: diagnóstico, tabela, composição
    // da receita, frete, histórico, alertas, ações + Visão Gerencial (consolidado).
    enabledBlocks: ["diagnostico", "previstoRealizado", "composicaoReceita", "freteLogistica", "historico", "alertas", "acoes"],
  },
};
