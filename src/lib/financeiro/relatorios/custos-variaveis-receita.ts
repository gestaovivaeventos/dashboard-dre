import { normalizeCompanyName } from "./templates/hero-holding-template";

// ============================================================================
// Gate da regra "custos variáveis acompanham a receita" (One Page Report / BI).
// ============================================================================
// Em algumas empresas do grupo, os CUSTOS DE SERVIÇOS PRESTADOS e os IMPOSTOS
// sobre a receita (IRPJ, CSLL, PIS, COFINS) são VARIÁVEIS: só existem em volume
// relevante quando existe receita no período. Nessas empresas, custo direto
// abaixo do orçamento quando a receita também ficou abaixo NÃO é economia
// operacional — é consequência da receita que não aconteceu.
//
// A regra é EXCLUSIVAMENTE de LEITURA da IA. Não toca cálculo de DRE, dados
// financeiros, orçamento, Omie, Google Sheets, estrutura DRE nem mapeamento —
// só decide se `CUSTOS_VARIAVEIS_RECEITA_RULE` é anexada ao system prompt.
//
// POR QUE UMA LISTA PRÓPRIA E NÃO UMA FLAG NO TEMPLATE: a Express NÃO tem
// template próprio (cai no `genericTemplate`, compartilhado com todas as demais
// empresas sem template). Uma flag no template ligaria a regra para todo mundo
// que usa o genérico. A lista abaixo é a fonte de verdade — para incluir uma
// empresa nova, acrescente um matcher em APPLICABLE_COMPANIES.
// ============================================================================

interface CompanyMatcher {
  /** Rótulo legível — usado só em documentação/debug. */
  label: string;
  /** Recebe o nome da empresa normalizado (minúsculo, sem acento). */
  test: (normalizedName: string) => boolean;
}

/**
 * Empresas em que a regra SE APLICA. Decisão de negócio (Marcelo, 13/08/2026):
 * modelos em que custo de serviço prestado e impostos sobre receita são
 * variáveis e acompanham o faturamento.
 */
const APPLICABLE_COMPANIES: readonly CompanyMatcher[] = [
  { label: "Sirena", test: (n) => n.includes("sirena") },
  { label: "Terrazzo", test: (n) => n.includes("terrazzo") },
  {
    label: "Salvaterra Estacionamento",
    test: (n) => n.includes("salvaterra") && n.includes("estacion"),
  },
  { label: "SGX", test: (n) => n.includes("sgx") },
  { label: "Village", test: (n) => n.includes("village") },
  { label: "Spot", test: (n) => n.includes("spot") },
  { label: "Express", test: (n) => n.includes("express") },
];

/**
 * Empresas/segmentos em que a regra NÃO se aplica — o modelo de negócio não
 * sustenta a leitura "custo direto acompanha a receita".
 *
 * Redundante em relação a APPLICABLE_COMPANIES (nenhuma delas casa com a lista
 * acima hoje), e é de propósito: se um matcher da allowlist for afrouxado no
 * futuro, estas empresas continuam de fora. Falha FECHADA — a exclusão vence.
 */
const NEVER_APPLICABLE_COMPANIES: readonly CompanyMatcher[] = [
  { label: "Case Shows", test: (n) => n.includes("case shows") },
  { label: "Feat Produções", test: (n) => n.includes("feat") },
  { label: "Young Med", test: (n) => n.includes("young") },
  {
    label: "Salvaterra Condomínio",
    test: (n) => n.includes("salvaterra") && !n.includes("estacion"),
  },
];

/** Segmentos inteiros fora da regra (todas as Franquias Viva + Hero Holding). */
const NEVER_APPLICABLE_SEGMENTS: readonly string[] = ["franquias-viva"];

export interface CustosVariaveisReceitaContext {
  companyName: string | null | undefined;
  segmentSlug: string | null | undefined;
}

/**
 * True quando a empresa analisada deve receber a regra de leitura dos custos
 * variáveis/impostos em relação à receita. Qualquer empresa fora da allowlist
 * (ou dentro de uma exclusão) mantém o prompt byte a byte como era.
 */
export function appliesCustosVariaveisReceita(
  ctx: CustosVariaveisReceitaContext,
): boolean {
  const segment = (ctx.segmentSlug ?? "").trim().toLowerCase();
  if (NEVER_APPLICABLE_SEGMENTS.includes(segment)) return false;

  const name = normalizeCompanyName(ctx.companyName ?? "");
  if (name === "") return false;
  if (NEVER_APPLICABLE_COMPANIES.some((m) => m.test(name))) return false;

  return APPLICABLE_COMPANIES.some((m) => m.test(name));
}

/** Rótulos das empresas cobertas — documentação/debug (ex.: rota debug-ai). */
export const CUSTOS_VARIAVEIS_COMPANY_LABELS: readonly string[] =
  APPLICABLE_COMPANIES.map((m) => m.label);
