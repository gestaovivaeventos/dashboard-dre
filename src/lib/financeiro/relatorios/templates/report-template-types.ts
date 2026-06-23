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
  | "real-estate-salvaterra-estacionamento";

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
}

/** Capacidades "tudo desligado" — base para Real Estate e genérico. */
export const NO_VIVA_CAPABILITIES: TemplateCapabilities = {
  vvrFee: false,
  sobrevivenciaCaixa: false,
  margemMediaEventos: false,
};
