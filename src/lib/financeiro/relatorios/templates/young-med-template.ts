import { NO_VIVA_CAPABILITIES, type ReportTemplate } from "./report-template-types";

// ============================================================================
// Template Young Med — serviços para médicos recém-formados (receita por
// parceiros / BVs). Empresa PRÓPRIA, isolada das demais (Franquias Viva, SGX,
// Village, Salvaterra, Feat, Case Shows, Sirena, Terrazzo). Plano DRE custom
// (company_id = Young Med). Nada aqui vaza para outros templates.
// ============================================================================

const YOUNG_MED_SYSTEM_CONTEXT = `CONTEXTO DA EMPRESA — Young Med:
A Young Med é uma empresa JOVEM (cerca de um ano de operação) que presta serviços para MÉDICOS RECÉM-FORMADOS. Atua inicialmente como INTERMEDIADORA/COMERCIALIZADORA de plataformas de contabilidade para esses médicos. Hoje, a principal lógica de receita vem das VENDAS/INTERMEDIAÇÕES feitas com PARCEIROS (categoria "BV - Vendas YoungMed"). Inicialmente o único parceiro relevante era a Heppi; a empresa busca EXPANDIR parcerias e reduzir a dependência de um único parceiro. Há expectativa FUTURA de expansão para o segmento de IAs, mas isso ainda é apenas um projeto — só trate IA como receita atual se houver dado financeiro no payload. A Young Med possui um esquema relevante de COMISSÕES que aparece no relatório.

A análise é FINANCEIRA-GERENCIAL e NÃO genérica. Foque em: receita total; receita por parceiros; principal parceiro; concentração da receita em BVs; comissões; despesas operacionais; resultado operacional; resultado final; margem líquida; evolução do resultado previsto x realizado; performance por parceiro no mês e no acumulado.

A IA deve responder principalmente:
- A Young Med está crescendo em receita?
- A receita ainda está concentrada em um parceiro principal?
- A empresa está conseguindo diversificar suas parcerias?
- As comissões estão consumindo uma parcela relevante da receita?
- O resultado operacional acompanha a evolução da receita?
- A margem líquida indica eficiência financeira?
- O resultado do exercício está aderente ao orçamento no mês e no acumulado?

OBSERVAÇÃO importante: a categoria "BV - Vendas YoungMed" é receita/venda por PARCEIROS da Young Med. NÃO confundir com BV de agenciamento de shows da Case Shows. No cálculo do Principal Parceiro, a conta "Produto Contabilidade - Turmas Heppi" fica de fora (é outra conta).

CUIDADOS:
- NÃO trate a Young Med como franquia, empresa de eventos, salão de eventos, estacionamento, condomínio, Real Estate, construtora, produtora de eventos ou agenciadora de shows.
- NÃO afirme que há dependência atual da Heppi se os dados não mostrarem isso.
- NÃO afirme que a empresa já atua com IA se não houver receita/dado no payload (pode mencionar a frente de IA como POSSÍVEL evolução futura, separada da receita atual).
- NÃO cite dados operacionais que não estejam no payload.
- Quando uma informação não estiver no payload, pode recomendar acompanhamento futuro, mas NÃO pode afirmar que o fato ocorreu.

REGRAS RÍGIDAS (isolamento):
- Use APENAS os dados financeiros enviados no payload (da própria Young Med). NÃO invente números, contas, categorias ou fornecedores.
- NÃO mencione nem aplique contexto de outras empresas: VVR, FEE disponível, sobrevivência de caixa, margem média de eventos, fundos de formatura, carteira de fundos (Franquias Viva); locações/projetos (SGX); gap de reembolso / resultado ajustado (Village); condomínio/estacionamento (Salvaterra); fechamento de eventos (Feat Produções); BV de shows (Case Shows); ocupação de agenda (Sirena/Terrazzo).

ALERTAS esperados (quando os dados sustentarem): receita abaixo do orçamento; receita concentrada em um único parceiro; principal parceiro com parcela elevada da receita de BVs; comissões consumindo parcela relevante da receita; resultado operacional abaixo do previsto; margem líquida negativa/pressionada; resultado do exercício abaixo do orçamento no mês ou acumulado; novas parcerias ainda sem volume relevante (se houver concentração).

AÇÕES recomendadas esperadas: acompanhar performance mensal por parceiro; monitorar concentração no principal parceiro; revisar a política de comissões; avaliar comissões como % da receita; acompanhar o resultado operacional frente ao crescimento da receita; fortalecer a previsibilidade de receita por parceiros; acelerar a diversificação de parceiros se houver concentração elevada; acompanhar o projeto de IA separadamente (sem misturar com a receita atual); avaliar a margem líquida e a eficiência da operação.

Tom: executivo, financeiro, objetivo, sem alarmismo, com foco em decisão e ação.

BASE DE CONHECIMENTO COMPLEMENTAR — Young Med (apenas ADICIONA contexto; não substitui nada acima):
- Responda também: a empresa está conseguindo transformar parcerias e vendas em RESULTADO financeiro sustentável (receita virando margem após comissões)?

PARCEIROS E BVs:
- Os parceiros da categoria "BV - Vendas YoungMed" são fontes de receita/intermediação da Young Med; a análise por parceiro mede CONCENTRAÇÃO e DIVERSIFICAÇÃO da receita.
- O principal parceiro é um indicador de DEPENDÊNCIA/CONCENTRAÇÃO; a diversificação de parceiros é uma frente ESTRATÉGICA para a empresa.
- O principal parceiro é o fornecedor/parceiro com maior participação na receita de "BV - Vendas YoungMed" — a conta "Produto Contabilidade - Turmas Heppi" NÃO entra nesse cálculo.
- Se a abertura por fornecedor/parceiro NÃO estiver no payload, NÃO invente um parceiro principal; pode dizer, de forma segura: "Para aprofundar a análise de concentração da receita, é importante acompanhar a abertura da receita de BVs por parceiro."

COMISSÕES (soma de: Comissão - GT, Comissão - Vendedor, Comissão - Head de Vendas, Comissão - Embaixador, Comissão - Representante, Comissão - Franquia):
- São um ponto central da EFICIÊNCIA COMERCIAL. Observe: valor total; comissões como % da receita (quando disponível); impacto no resultado operacional; relação entre o crescimento da receita e o das comissões; risco de a receita crescer SEM conversão proporcional em resultado.
- Alertas possíveis: comissões em parcela elevada da receita; comissões crescendo mais rápido que a receita; resultado operacional pressionado por comissões; margem líquida baixa/negativa mesmo com receita relevante.
- Ações possíveis: revisar a política de comissões; avaliar comissões como % da receita; acompanhar comissões por canal/parceiro (se houver dado); monitorar se o modelo comercial gera resultado APÓS comissões.
- NÃO invente valores de comissão se as categorias não estiverem no payload.

FRENTE DE IA (projeto FUTURO, não operação consolidada):
- Pode mencionar como "frente futura de IA", "projeto de expansão para IA", "potencial nova linha de receita" ou "necessidade de acompanhar separadamente a evolução do projeto de IA".
- NÃO afirme que já há receita relevante de IA, que a IA já impactou o resultado, que a operação de IA está consolidada ou que existe margem/resultado dessa frente — a menos que esses dados estejam EXPLICITAMENTE no payload financeiro.

DADOS AUSENTES: quando uma informação não estiver no payload, pode recomendar acompanhamento futuro, mas NÃO pode afirmar que o fato ocorreu. Ex.: pode dizer "vale acompanhar a abertura da receita por parceiro para medir concentração e diversificação"; NÃO pode dizer "a concentração na Heppi aumentou" se o dado por parceiro não estiver disponível.`;

export const youngMedTemplate: ReportTemplate = {
  id: "young-med",
  name: "Young Med",
  segment: "young-med",
  description:
    "Young Med: serviços para médicos recém-formados — receita por parceiros (BVs), comissões e resultado.",
  // Empresa única "Young Med"; nenhum outro template casa com "young".
  priority: 120,
  matches: (ctx) => ctx.companyNameLower.includes("young"),

  capabilities: { ...NO_VIVA_CAPABILITIES },
  prompt: { kind: "custom", systemContext: YOUNG_MED_SYSTEM_CONTEXT },

  // Mapeamento CONFIRMADO pela auditoria (plano custom da Young Med).
  expectedKpis: [
    { key: "receita_total", label: "Receita Total", source: "core-receita" },
    { key: "principal_parceiro", label: "Principal Parceiro", source: "todo", note: "drill-down da conta 1.1 por fornecedor." },
    { key: "comissoes", label: "Comissões", source: "core-despesas" },
    { key: "resultado_operacional", label: "Resultado Operacional", source: "core-resultado" },
    { key: "margem_liquida", label: "Margem Líquida", source: "core-margem" },
  ],
  expectedCharts: [
    { key: "performance_parceiro", title: "Performance por Parceiro — Mês e Acumulado" },
    { key: "resultado_exercicio", title: "Resultado do Exercício — Previsto x Realizado" },
  ],
  semaforoIndicators: ["Resultado Operacional", "Margem Líquida", "Comissões"],
  alertHints: [
    "Receita abaixo do orçamento.",
    "Receita concentrada em um único parceiro.",
    "Comissões consumindo parcela relevante da receita.",
    "Resultado operacional abaixo do previsto.",
    "Margem líquida negativa ou pressionada.",
    "Resultado do exercício abaixo do orçamento no mês ou acumulado.",
  ],
  actionHints: [
    "Acompanhar performance mensal por parceiro.",
    "Monitorar concentração de receita no principal parceiro.",
    "Revisar a política de comissões.",
    "Acelerar a diversificação de parceiros.",
    "Acompanhar o projeto de IA separadamente da receita atual.",
  ],
  dreAccountMapping: {
    receita_total: { label: "Receita Operacional Bruta", codes: ["1"], status: "confirmed", note: "summary; 1.1 BVs + 1.2 Turmas Heppi + 1.3 Produto IA." },
    receita_liquida: { label: "Receita Líquida (Lucro Operacional Bruto)", codes: ["6"], status: "confirmed", note: "calculado f=1+2-3; base da Margem Líquida (11/6)." },
    bvs_young_med: { label: "Produto Contabilidade - BVs Young Med", codes: ["1.1"], status: "confirmed", note: "categoria BV - Vendas YoungMed; base do Principal Parceiro (por fornecedor)." },
    turmas_heppi: { label: "Produto Contabilidade - Turmas Heppi", codes: ["1.2"], status: "confirmed", note: "EXCLUÍDO do Principal Parceiro (conta separada)." },
    comissoes: { label: "Comissões (GT, Vendedor, Head, Embaixador, Representante, Franquia)", codes: ["7.1.2", "7.1.3", "7.1.4", "7.1.5", "7.1.6", "7.1.7"], status: "confirmed" },
    despesas_operacionais: { label: "Despesas Operacionais", codes: ["7"], status: "confirmed" },
    resultado_operacional: { label: "Lucro ou Prejuizo Operacional", codes: ["8"], status: "confirmed", note: "calculado f=6-7." },
    resultado_final: { label: "Resultado do Exercicio", codes: ["11"], status: "confirmed", note: "calculado f=8+9-10." },
  },

  // ── Relatório REAL da Young Med ────────────────────────────────────────────
  report: {
    // 5 cards executivos.
    kpiCards: [
      { label: "Receita Total", code: "1", kind: "receita" },
      // Principal Parceiro: maior fornecedor da conta 1.1 (BVs) no período + % do total de BVs.
      { label: "Principal Parceiro", kind: "parceiro", partnerAccountCode: "1.1" },
      // Comissões = soma das 6 sub-contas de comissão; subtítulo = % da Receita Total (1).
      { label: "Comissões", kind: "despesa", codes: ["7.1.2", "7.1.3", "7.1.4", "7.1.5", "7.1.6", "7.1.7"], subtitlePctOf: ["1"] },
      { label: "Resultado Operacional", code: "8", kind: "resultado" },
      // Margem Líquida = Resultado do Exercício (11) ÷ Receita Líquida. No plano
      // da Young Med, a Receita Líquida é o "Lucro Operacional Bruto" (code 6 =
      // 1+2-3 = Receita Bruta + Outras Receitas − Deduções).
      { label: "Margem Líquida", kind: "margem", ratio: { numerator: ["11"], denominator: ["6"] } },
    ],
    kpiColumns: 5,
    // Tabela "Desempenho do mês vs orçamento" — 4 linhas (Comissões ficam no card).
    previstoRealizado: [
      { label: "Receita Total", code: "1", unidade: "currency" },
      { label: "Despesas Operacionais", code: "7", unidade: "currency" },
      { label: "Resultado Final", code: "11", unidade: "currency" },
    ],
    // Bloco Performance por Parceiro — realizado por fornecedor da conta 1.1
    // (mês + acumulado do ano). Orçamento existe por conta, não por parceiro.
    partnerPerformance: {
      title: "Performance por Parceiro — Mês e Acumulado",
      accountCode: "1.1",
      categoryLabel: "BV - Vendas YoungMed",
    },
    // Histórico do Resultado do Exercício (6 meses) + acumulado do ano (Jan→análise).
    historicoAccountCode: "11",
    historicoTitle: "Resultado do Exercício — Previsto × Realizado",
    historicoKLabels: true,
    historicoShowAcum: true,
    // Oculta VVR/FEE/sobrevivência (capabilities) + composição/semáforo/acumulado
    // genérico (allowlist). Aparecem: diagnóstico, tabela, parceiros, histórico,
    // alertas e ações.
    enabledBlocks: ["diagnostico", "previstoRealizado", "performancePorParceiro", "historico", "alertas", "acoes"],
  },
};
