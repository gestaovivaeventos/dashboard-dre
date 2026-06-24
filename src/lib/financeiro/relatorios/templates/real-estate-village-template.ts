import { NO_VIVA_CAPABILITIES, type ReportTemplate } from "./report-template-types";

// ============================================================================
// Template Real Estate — Village (construtora: custos reembolsáveis + reembolsos)
// ----------------------------------------------------------------------------
// Mapeamento CONFIRMADO pela auditoria do plano DRE custom da Village
// (company c674d8c0-…, 71 contas, estrutura P&L padrão). Codes reais:
//   1.1 Clientes - Serviços Prestados           → Receita de Serviços
//   1.2 Clientes - Receita com Serviços Vendidos → Reembolsos Recebidos (*)
//   5.1 Custos de Serviços e Produtos de Contratos Vendidos → Custos Reembolsáveis
//   7   Despesas Operacionais                    → Despesas Operacionais
//   8   Resultado do Exercício Antes IR e CS (f=6-7) → Resultado Operacional
//   11  Resultado Após IR e CS (f=8-9-10)        → Resultado Final
//   4   Receita Operacional Líquida (f=1+2-3)    → Receita Líquida
// (*) AMBIGUIDADE registrada: existe também 2.2 "Reembolso de Despesas"
//     (Receitas Indiretas) — candidato alternativo/adicional a "Reembolsos".
//     Seguimos a indicação do usuário (1.2) e NÃO somamos 2.2 sem confirmação.
// Sinais: despesas/custos entram como MAGNITUDE POSITIVA (fórmulas usam 4-5,
// 6-7). Gap e Resultado Ajustado são DERIVADOS (não há conta contábil própria).
// ============================================================================

const VILLAGE_SYSTEM_CONTEXT = `CONTEXTO DA EMPRESA — Village (construtora):
A Village é uma CONSTRUTORA. A receita principal vem de CONTRATOS de construção e SERVIÇOS prestados aos clientes. Parte relevante dos custos é REEMBOLSÁVEL pelos contratantes das obras (ex.: empreiteiros CLT da Village e despesas vinculadas às obras), lançada nos custos de serviços/produtos de contratos vendidos. Em contrapartida, os REEMBOLSOS desses custos entram como receita de serviços vendidos. Há DELAY natural: custos do mês M podem ser reembolsados em M+1. A receita EFETIVA da operação está ligada à TAXA ADMINISTRATIVA dos contratos (referência comercial ~15% do valor do projeto), que pode NÃO existir como conta separada no DRE.

INDICADORES GERENCIAIS CENTRAIS:
- Gap de Reembolso = Reembolsos Recebidos − Custos Reembolsáveis.
- Resultado Ajustado = Resultado Final − Gap de Reembolso (remove o efeito líquido do descasamento de reembolso; leitura GERENCIAL, não contábil).
- Margem Líquida = Resultado Final ÷ Receita Líquida.

INTERPRETAÇÃO:
- Gap NEGATIVO em um mês isolado pode ser apenas o delay normal (custo em M, reembolso em M+1) — descasamento TEMPORÁRIO de caixa, não perda estrutural.
- Gap negativo RECORRENTE (vários meses) deve ser tratado como alerta de controle, conciliação ou atraso de reembolso.
- Um Resultado Operacional POSITIVO pode estar INFLADO por reembolsos recebidos no mês (inclusive de períodos anteriores).
- Um Resultado Operacional NEGATIVO pode estar PRESSIONADO por custos reembolsáveis ainda não recebidos.
- Use o Resultado Ajustado para entender a operação SEM o efeito líquido do gap.
- A taxa administrativa ~15% é referência COMERCIAL — NÃO trate como dado realizado se não houver conta/base específica no DRE.

O relatório deve responder: a Village gera resultado REAL com os contratos ou apenas movimenta reembolsos? O gap está distorcendo o resultado operacional? O gap é pontual ou recorrente? A operação está financiando temporariamente custos de obra? O resultado ajustado mostra uma operação saudável?

CLASSIFICAÇÃO (semáforo / leituraPorIndicador):
- Receita de Serviços acima do orçado → Positivo.
- Gap levemente negativo → Atenção (pode ser delay natural).
- Gap negativo recorrente → Crítico.
- Resultado Ajustado positivo → Positivo.
- Resultado Operacional negativo → Atenção ou Crítico conforme a magnitude.
- Margem Líquida negativa → Crítico.
- Resultado Operacional positivo, mas Resultado Ajustado MUITO menor → Atenção (resultado possivelmente inflado por reembolsos).

ALERTAS esperados (quando os dados sustentarem): custos reembolsáveis superaram reembolsos no período; gap negativo pode indicar descasamento temporário de caixa; gap negativo recorrente exige conciliação por contrato/obra; resultado operacional positivo possivelmente influenciado por reembolsos de períodos anteriores; resultado operacional negativo pressionado por custos ainda não reembolsados; margem líquida negativa indica perda de eficiência final; ausência de controle por obra/contrato limita a leitura da rentabilidade real.

AÇÕES recomendadas esperadas: conciliar custos reembolsáveis por obra; validar reembolsos pendentes por contrato; acompanhar custos de M contra reembolsos de M+1; separar receita de reembolso da receita efetiva de administração; criar aging de reembolsos pendentes; revisar contratos com taxa administrativa abaixo do padrão (se houver dados); avaliar se o resultado operacional foi influenciado por reembolsos pontuais.

REGRAS RÍGIDAS:
- NUNCA fale de VVR, FEE disponível, margem média de eventos, sobrevivência de caixa, franquias, locações, projetos da SGX, estacionamento ou condomínio — nada disso se aplica à Village.
- Se as contas de custo reembolsável, reembolso ou taxa administrativa não estiverem identificáveis com segurança, registre que dependem de mapeamento a confirmar. NÃO invente valores nem códigos.`;

export const realEstateVillageTemplate: ReportTemplate = {
  id: "real-estate-village",
  name: "Real Estate — Village",
  segment: "real-estate",
  description: "Village: construtora com custos reembolsáveis, reembolsos (delay M+1) e gap de reembolso.",
  priority: 100,
  matches: (ctx) => ctx.companyNameLower.includes("village"),

  capabilities: { ...NO_VIVA_CAPABILITIES },
  prompt: { kind: "custom", systemContext: VILLAGE_SYSTEM_CONTEXT },

  expectedKpis: [
    { key: "receita_servicos", label: "Receita de Serviços", source: "core-receita", note: "code 1.1" },
    { key: "gap_reembolso", label: "Gap de Reembolso", source: "todo", note: "DERIVADO: 1.2 − 5.1" },
    { key: "resultado_ajustado", label: "Resultado Ajustado", source: "todo", note: "DERIVADO: Resultado Final − Gap = 11 + 5.1 − 1.2" },
    { key: "resultado_operacional", label: "Resultado Operacional", source: "core-resultado", note: "code 8" },
    { key: "margem_liquida", label: "Margem Líquida", source: "core-margem", note: "11 ÷ 4" },
  ],
  expectedCharts: [
    { key: "historico_gap", title: "Histórico do Gap de Reembolso", note: "IMPLEMENTADO: histórico derivado (1.2 − 5.1), 6 meses, realizado x orçado." },
    { key: "custos_x_reembolsos", title: "Custos Reembolsáveis x Reembolsos Recebidos", note: "EVOLUÇÃO FUTURA: série dupla temporal — dados já visíveis na tabela." },
    { key: "resultado_op_x_ajustado", title: "Resultado Operacional x Resultado Ajustado", note: "EVOLUÇÃO FUTURA: série dupla — dados já visíveis na tabela." },
  ],
  semaforoIndicators: [
    "Receita de Serviços",
    "Gap de Reembolso",
    "Resultado Ajustado",
    "Resultado Operacional",
    "Margem Líquida",
  ],
  alertHints: [
    "Custos reembolsáveis superaram reembolsos no período.",
    "Gap de reembolso negativo — possível descasamento temporário de caixa.",
    "Gap negativo recorrente exige conciliação por contrato/obra.",
    "Resultado operacional positivo possivelmente influenciado por reembolsos de períodos anteriores.",
    "Resultado operacional negativo pressionado por custos ainda não reembolsados.",
    "Margem líquida negativa indica perda de eficiência final.",
  ],
  actionHints: [
    "Conciliar custos reembolsáveis por obra.",
    "Validar reembolsos pendentes por contrato.",
    "Acompanhar custos do mês M contra reembolsos do mês M+1.",
    "Separar receita de reembolso da receita efetiva de administração.",
    "Criar aging de reembolsos pendentes.",
    "Avaliar se o resultado operacional foi influenciado por reembolsos pontuais.",
  ],
  // Mapeamento CONFIRMADO pela auditoria (ver cabeçalho). Ambíguos = status "todo".
  dreAccountMapping: {
    receita_servicos: { label: "Clientes - Serviços Prestados", codes: ["1.1"], status: "confirmed", note: "Receita principal de serviços/contratos." },
    reembolsos: { label: "Clientes - Receita com Serviços Vendidos", codes: ["1.2"], status: "confirmed", note: "Reembolsos recebidos (indicado pelo usuário). Ver ambiguidade com 2.2." },
    custos_reembolsaveis: { label: "Custos de Serviços e Produtos de Contratos Vendidos", codes: ["5.1"], status: "confirmed", note: "Custos diretos reembolsáveis — magnitude POSITIVA." },
    despesas_operacionais: { label: "Despesas Operacionais", codes: ["7"], status: "confirmed" },
    resultado_operacional: { label: "Resultado do Exercício Antes IR e CS", codes: ["8"], status: "confirmed", note: "calculado f=6-7 (após despesas op). 6 = Lucro Operacional Bruto (antes das despesas op)." },
    resultado_final: { label: "Resultado Após IR e CS", codes: ["11"], status: "confirmed", note: "calculado f=8-9-10." },
    receita_liquida: { label: "Receita Operacional Líquida", codes: ["4"], status: "confirmed", note: "calculado f=1+2-3." },
    reembolso_despesas: { label: "Reembolso de Despesas (Receitas Indiretas, 2.2)", codes: ["2.2"], status: "todo", note: "AMBÍGUO: candidato alternativo/adicional a 'Reembolsos Recebidos'. Confirmar se deve ser somado a 1.2." },
    taxa_administrativa: { label: "Taxa Administrativa (~15%)", byNameIncludes: ["taxa administrativa", "taxa adm"], status: "todo", note: "NÃO existe conta separada no DRE — referência comercial, não é dado realizado." },
  },

  // ── Relatório REAL da Village por conta DRE (codes confirmados) ────────────
  // Gap e Resultado Ajustado são DERIVADOS via `minus`. Margem Líquida via
  // `ratio`. Histórico = Gap derivado (historicoCodes − historicoMinus).
  report: {
    // 5 cards executivos (sem Custos/Reembolsos isolados — esses vão na tabela).
    // Card 4 = Resultado FINAL (a pedido; substituiu Resultado Operacional).
    kpiCards: [
      { label: "Receita de Serviços", code: "1.1", kind: "receita" },
      { label: "Gap de Reembolso", codes: ["1.2"], minus: ["5.1"], kind: "resultado" },
      { label: "Resultado Ajustado", codes: ["11", "5.1"], minus: ["1.2"], kind: "resultado" },
      { label: "Resultado Final", code: "11", kind: "resultado" },
      { label: "Margem Líquida", kind: "margem", ratio: { numerator: ["11"], denominator: ["4"] } },
    ],
    kpiColumns: 5,
    // Tabela "Desempenho do mês vs orçamento" em 2 grupos:
    //   "Resultado do mês"  — Receita, Reembolsos, Custos, Despesas Op, Resultado Final.
    //   "Leitura gerencial" — Gap de Reembolso e Resultado Ajustado (com nota).
    // Resultado Operacional (8) e Margem Líquida saíram da tabela (Margem segue
    // como card). Resultado Final destacado; Gap negativo em vermelho (preview).
    previstoRealizado: [
      { label: "Receita de Serviços", code: "1.1", unidade: "currency", group: "Resultado do mês" },
      { label: "Reembolsos Recebidos", code: "1.2", unidade: "currency", group: "Resultado do mês" },
      { label: "Custos Reembolsáveis", code: "5.1", unidade: "currency", group: "Resultado do mês" },
      { label: "Despesas Operacionais", code: "7", unidade: "currency", group: "Resultado do mês" },
      { label: "Resultado Final", code: "11", unidade: "currency", group: "Resultado do mês" },
      { label: "Gap de Reembolso", codes: ["1.2"], minus: ["5.1"], unidade: "currency", group: "Leitura gerencial" },
      {
        label: "Resultado Ajustado",
        // = Resultado Final − Gap de Reembolso = 11 − (1.2 − 5.1) = 11 + 5.1 − 1.2.
        codes: ["11", "5.1"],
        minus: ["1.2"],
        unidade: "currency",
        group: "Leitura gerencial",
        footnote: "Resultado Ajustado: resultado desconsiderando os reembolsos.",
      },
    ],
    // Histórico = Gap de Reembolso derivado (Reembolsos 1.2 − Custos 5.1), 6 meses.
    historicoCodes: ["1.2"],
    historicoMinus: ["5.1"],
    historicoTitle: "Histórico do Gap de Reembolso",
    // Mantém semáforo (Village o usa, ao contrário da SGX). Oculta VVR,
    // Acumulado do Ano e Composição.
    enabledBlocks: ["diagnostico", "previstoRealizado", "semaforo", "historico", "alertas", "acoes"],
  },
};
