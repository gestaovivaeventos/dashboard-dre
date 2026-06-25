// ============================================================================
// One Page Report — camada de TEMPLATES por empresa/segmento
// ============================================================================
// Objetivo: dada uma empresa selecionada no Business Intelligence, decidir qual
// MODELO de relatório usar (Franquias Viva, Real Estate SGX, Village, etc.),
// sem duplicar todo o pipeline do relatório e SEM alterar o comportamento já
// consolidado de Franquias Viva.
//
// O que esta camada controla na Fase 1:
//   1. Roteamento do PROMPT da IA (cada template tem seu próprio contexto; o
//      template de Franquias Viva continua usando EXATAMENTE o prompt atual).
//   2. Capacidades que LIGAM/DESLIGAM blocos específicos da Viva (VVR, FEE
//      disponível, sobrevivência de caixa, margem média de eventos) — para que
//      empresas Real Estate não exibam nem enviem esses indicadores à IA.
//   3. Metadados DECLARATIVOS (KPIs, gráficos, semáforo, alertas, ações e
//      mapeamento de contas DRE esperados) — documentação + base para fases
//      futuras + rótulo de debug. Mapeamentos incertos ficam como TODO; nunca
//      inventamos código/regra financeira aqui.
// ============================================================================

export type ReportTemplateId =
  | "franquias-viva"
  | "generic"
  | "real-estate-sgx"
  | "real-estate-village"
  | "real-estate-salvaterra-condominio"
  | "real-estate-salvaterra-estacionamento"
  // ── Grupo Feat / Eventos (cada empresa com contexto de negócio próprio) ────
  | "feat-producoes"
  | "case-shows"
  | "sirena"
  | "terrazzo"
  // ── Young Med (serviços para médicos recém-formados; receita por parceiros) ──
  | "young-med";

/** Contexto usado para casar uma empresa a um template. */
export interface TemplateMatchContext {
  companyId: string;
  /** Nome cru da empresa. */
  companyName: string;
  /** Nome normalizado (trim + lowercase) — conveniência para os matchers. */
  companyNameLower: string;
  /** Slug do segmento (ex.: "franquias-viva", "real-estate") ou null. */
  segmentSlug: string | null;
}

/**
 * Capacidades específicas de Franquias Viva. Quando `false`, o bloco
 * correspondente NÃO é montado no payload nem enviado à IA. Franquias Viva liga
 * todas; Real Estate/genérico desliga todas (núcleo DRE puro).
 */
export interface TemplateCapabilities {
  /** Cartões VVR + FEE disponível e os respectivos campos no input da IA. */
  vvrFee: boolean;
  /** Cartão "Sobrevivência de caixa" e o campo no input da IA. */
  sobrevivenciaCaixa: boolean;
  /** Cartão "Margem média dos eventos". */
  margemMediaEventos: boolean;
}

/**
 * Roteamento do system prompt da IA:
 *  - "franquias-viva": usa o FRANQUIAS_VIVA_SYSTEM_PROMPT atual, INTOCADO.
 *  - "generic": usa o GENERIC_SYSTEM_PROMPT atual.
 *  - "custom": usa as regras compartilhadas + o `systemContext` do template
 *    (nunca a linguagem da Viva).
 */
export type TemplatePromptConfig =
  | { kind: "franquias-viva" }
  | { kind: "generic" }
  | { kind: "custom"; systemContext: string };

/**
 * KPI esperado pelo template. `source` diz de onde o número sai HOJE:
 *  - "core-*": já calculado pelo payload genérico (Receita/Despesas/Resultado/
 *    Margem dos codes 1/7/11).
 *  - "todo": depende de mapeamento de contas DRE ainda não confirmado — fica
 *    declarado para a próxima fase, sem inventar a conta.
 */
export interface TemplateKpiSpec {
  key: string;
  label: string;
  source:
    | "core-receita"
    | "core-despesas"
    | "core-resultado"
    | "core-margem"
    | "todo";
  note?: string;
}

export interface TemplateChartSpec {
  key: string;
  title: string;
  note?: string;
}

/**
 * Entrada de mapeamento de conta DRE — CONFIGURAÇÃO, não verdade financeira.
 * `byNameIncludes` são candidatos por nome (substring, case-insensitive) para
 * matching flexível futuro; `codes` só quando conhecidos com segurança.
 */
export interface TemplateDreMappingEntry {
  label: string;
  byNameIncludes?: string[];
  codes?: string[];
  status: "confirmed" | "todo";
  note?: string;
}

export type TemplateDreMapping = Record<string, TemplateDreMappingEntry>;

// ── Fase 2: configuração de relatório REAL por conta DRE (opcional) ──────────
// Quando um template define `report`, o payload monta os blocos a partir das
// contas DRE indicadas (por CODE), substituindo os blocos genéricos. Ausência
// de `report` = comportamento atual (Franquias Viva e demais ficam idênticos).

/**
 * Card de KPI ligado a conta(s) DRE. Use UM de: `code` (conta única),
 * `codes` (soma de contas, ex.: Receitas Operacionais = 1+12) ou, para
 * `kind: "margem"`, `ratio` (soma(numerator) / soma(denominator) * 100).
 * `kind` define o sinal/farol: receita/resultado = maior melhor; despesa =
 * menor que o previsto melhor; margem = % (verde se positiva).
 */
export interface TemplateKpiCardSpec {
  label: string;
  kind: "receita" | "despesa" | "resultado" | "margem" | "parceiro";
  code?: string;
  codes?: string[];
  /**
   * Para `kind: "parceiro"` (ex.: Young Med "Principal Parceiro"): code da conta
   * DRE cujos FORNECEDORES (supplier_customer) são quebrados via drill-down. O
   * card mostra o 1º nome do maior fornecedor no período + seu % do total da
   * conta. Apenas dados financeiros da própria empresa; nada inventado.
   */
  partnerAccountCode?: string;
  /**
   * Subtítulo "% da receita" — valor do card sobre a soma destas contas (ex.:
   * Comissões / Receita Total = subtitlePctOf ["1"]). Quando presente, substitui
   * a variação "vs orçamento" pelo percentual sobre a base. Opt-in por card.
   */
  subtitlePctOf?: string[];
  /**
   * Contas a SUBTRAIR — resultado derivado em card. Valor =
   * soma(code/codes) − soma(minus). Ex.: Gap de Reembolso (Village) =
   * Reembolsos − Custos Reembolsáveis; Resultado Ajustado = Resultado
   * Operacional + Custos − Reembolsos.
   */
  minus?: string[];
  ratio?: { numerator: string[]; denominator: string[] };
  /**
   * Inverte o farol da margem/razão: por padrão "maior = melhor" (verde acima
   * do orçado). Com `invertStatus: true`, "maior = pior" — ex.: Freelancers /
   * Receita (Salvaterra Estacionamento), onde subir a razão é ruim.
   */
  invertStatus?: boolean;
}

/**
 * Linha do gráfico Previsto x Realizado ligada a conta(s) DRE.
 * Valor = soma(`codes`/`code`) − soma(`minus`). Use `minus` para resultados
 * derivados (ex.: Resultado Operacional = Receitas Op. − Despesas Op.).
 */
export interface TemplatePrevistoRealizadoSpec {
  label: string;
  unidade: "currency" | "percent";
  code?: string;
  codes?: string[];
  /** Contas a SUBTRAIR (ex.: despesas) para linhas de resultado derivado. */
  minus?: string[];
  /**
   * Razão em % (ex.: Margem Líquida = Resultado Final / Receita Líquida).
   * Quando presente, IGNORA code/codes/minus e calcula (Σnum / Σden) * 100,
   * tanto no realizado quanto no orçado. Use com `unidade: "percent"`.
   */
  ratio?: { numerator: string[]; denominator: string[] };
  /**
   * Subtítulo do subgrupo na tabela. Linhas com o mesmo `group` consecutivo
   * ficam sob um subtítulo; a troca de group desenha um divisor. Ex.: Village
   * usa "Resultado do mês" e "Leitura gerencial". Ausência = sem agrupamento
   * (Franquias Viva / SGX permanecem com a tabela plana atual).
   */
  group?: string;
  /** Nota de rodapé: marca a linha com "*" e exibe o texto abaixo da tabela. */
  footnote?: string;
}

/** Etapa da Composição do Resultado ligada a uma conta DRE. */
export interface TemplateComposicaoSpec {
  label: string;
  code: string;
  /** entrada = +valor; saida = -|valor| (despesa); resultado = valor como está. */
  type: "entrada" | "saida" | "resultado";
}

/** Blocos do OnePageReportPreview que podem ser ligados/desligados. */
export type ReportBlockKey =
  | "diagnostico"
  | "previstoRealizado"
  | "composicao"
  | "acumuladoAno"
  | "vvrSerie"
  | "historico"
  | "semaforo"
  | "alertas"
  | "acoes"
  // Quadro de eventos EXCLUSIVO da Feat Produções (alimentado por
  // company_feat_projetos). Só o template feat-producoes o habilita.
  | "featEventos"
  // Bloco "Performance por Parceiro — Mês e Acumulado" EXCLUSIVO da Young Med
  // (realizado por fornecedor da conta de BVs). Só o template young-med o habilita.
  | "performancePorParceiro";

export interface TemplateReportConfig {
  /** KPIs por conta DRE (substituem o conjunto fixo). */
  kpiCards?: TemplateKpiCardSpec[];
  /** Linhas do Previsto x Realizado por conta DRE. */
  previstoRealizado?: TemplatePrevistoRealizadoSpec[];
  /** Composição do resultado por conta DRE. */
  composicao?: TemplateComposicaoSpec[];
  /** Code do histórico principal (default "11" quando ausente). */
  historicoAccountCode?: string;
  /**
   * Histórico DERIVADO (6 meses) por soma/subtração de contas — ex.: Gap de
   * Reembolso (Village) = Reembolsos (Σ historicoCodes) − Custos (Σ
   * historicoMinus). Quando `historicoCodes` está presente, substitui
   * `historicoAccountCode`: por mês, valor = Σ(historicoCodes) − Σ(historicoMinus).
   */
  historicoCodes?: string[];
  historicoMinus?: string[];
  /**
   * Título do gráfico de histórico. Ausência = título atual
   * ("Previsto x Realizado — Resultado do Exercício"). Apenas cosmético.
   */
  historicoTitle?: string;
  /**
   * Rótulos do gráfico de histórico no formato "Xk" (milhar) — ex.: "133,6k".
   * Ausência/false = número cheio (Franquias Viva fica inalterada). SGX usa true.
   */
  historicoKLabels?: boolean;
  /**
   * Mostra o rodapé "Acumulado no ano" (Jan→análise, Previsto × Realizado) sob
   * o gráfico de histórico. Opt-in (ex.: Salvaterra) — Franquias Viva / SGX /
   * Village ficam inalterados quando ausente/false.
   */
  historicoShowAcum?: boolean;
  /** Allowlist de blocos visíveis. Ausência = TODOS (comportamento atual). */
  enabledBlocks?: ReportBlockKey[];
  /** Nº de colunas da grade de KPIs (default 4). Ex.: SGX usa 3 (3 + margem). */
  kpiColumns?: number;
  /**
   * Gráfico de COLUNAS verticais — acumulado do ano (janeiro do ano de análise
   * → mês de análise), só valores REALIZADOS. Valor por mês = Σ(codes) −
   * Σ(minus). Ex.: Village — Gap de Reembolso (1.2 − 5.1).
   */
  barsChart?: { title: string; codes: string[]; minus?: string[] };
  /**
   * Gráfico de LINHAS — últimos 6 meses (relativo ao mês de análise), com N
   * séries. Cada série = Σ(codes) − Σ(minus) sobre o realizado (`source:
   * "realized"`, default) ou o orçado (`source: "budget"`). Ex.: Village —
   * Resultado Final realizado (11), Resultado Ajustado (11+5.1−1.2), Resultado
   * Final orçado (11/budget). Renderizado ao lado do `barsChart`.
   */
  linesChart?: {
    title: string;
    series: Array<{
      label: string;
      codes: string[];
      minus?: string[];
      source?: "realized" | "budget";
    }>;
  };
  /**
   * Gráficos de COLUNAS Previsto × Realizado mensais — acumulado do ano (jan do
   * ano de análise → mês de análise). Cada gráfico tem 2 barras por mês
   * (previsto/realizado), valor = Σ(codes) − Σ(minus) sobre orçado/realizado, e
   * abaixo o previsto/realizado ACUMULADO do ano + variação. Lista (renderizados
   * empilhados). Ex.: SGX — Locações (1−2) e Projetos (12−13).
   */
  prevRealCharts?: Array<{ title: string; codes: string[]; minus?: string[] }>;
  /**
   * Bloco CONSOLIDADO entre as empresas de um grupo (ex.: família Salvaterra).
   * Mostra Previsto × Realizado do `resultCode` (ex.: "11" = Resultado do
   * Exercício) de CADA empresa cujo nome casa com `matchName` (ILIKE) + a soma
   * consolidada. É um bloco COMPLEMENTAR — não autoriza misturar o restante da
   * análise individual. Usa apenas dados do dashboard DRE de cada empresa.
   */
  consolidatedGroup?: { title: string; matchName: string; resultCode: string };
  /**
   * Bloco "Performance por Parceiro" (ex.: Young Med). Quebra os FORNECEDORES
   * (supplier_customer) da conta `accountCode` (ex.: "1.1" = BVs Young Med) via
   * drill-down, mostrando REALIZADO por parceiro no mês e no acumulado do ano
   * (Jan→análise) + o % de cada um. O orçamento existe por CONTA, não por
   * fornecedor — por isso o bloco é realizado-only (limitação documentada).
   * Só usa dados financeiros da própria empresa; "Turmas Heppi" (outra conta)
   * fica naturalmente fora. `categoryLabel` é só rótulo exibido.
   */
  partnerPerformance?: { title: string; accountCode: string; categoryLabel?: string };
}

export interface ReportTemplate {
  id: ReportTemplateId;
  /** Nome exibível (rótulo de debug). Ex.: "Real Estate — SGX". */
  name: string;
  /** Slug do segmento ao qual o template pertence (informativo). */
  segment: string;
  description?: string;
  /**
   * Precedência de resolução: maior vence. Matches por empresa (nome/id) usam
   * prioridade alta; match por segmento, média; o genérico é o fallback final.
   */
  priority: number;
  /** Retorna true quando este template se aplica à empresa do contexto. */
  matches(ctx: TemplateMatchContext): boolean;

  capabilities: TemplateCapabilities;
  prompt: TemplatePromptConfig;

  // ── Metadados declarativos (documentação / debug / fases futuras) ──────────
  expectedKpis: TemplateKpiSpec[];
  expectedCharts: TemplateChartSpec[];
  semaforoIndicators: string[];
  alertHints: string[];
  actionHints: string[];
  dreAccountMapping: TemplateDreMapping;

  // ── Fase 2: relatório REAL por conta DRE (opcional). Ausência = genérico. ──
  report?: TemplateReportConfig;
}

/** Capacidades "tudo desligado" — base para Real Estate e genérico. */
export const NO_VIVA_CAPABILITIES: TemplateCapabilities = {
  vvrFee: false,
  sobrevivenciaCaixa: false,
  margemMediaEventos: false,
};
