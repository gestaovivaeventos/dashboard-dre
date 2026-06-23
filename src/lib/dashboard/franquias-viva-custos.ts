import type { SupabaseClient } from "@supabase/supabase-js";

import type { DreAccountBase } from "@/lib/dashboard/dre";

// Slug do segmento das franquias Viva. A regra abaixo só se aplica a ele.
export const FRANQUIAS_VIVA_SLUG = "franquias-viva";

// Nome canônico da ÚNICA conta de RECEITA que vive dentro do grupo de DESPESA
// "Custos com os Serviços Prestados" (code 5) no plano DRE global usado pelas
// franquias Viva — code 5.8 "Receitas Ressarciveis - Fundos". Detecção pelo
// NOME (não pelo code) para tolerar variações de plano; comparação
// case/acento-insensível, mesma normalização da regra de Fundos no sync.
const RECEITAS_RESSARCIVEIS_FUNDOS = "receitas ressarciveis - fundos";

const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();

/**
 * Sinal com que `code` aparece em `formula` (+1 / -1), ou null se não
 * referenciado. Usa o MESMO tokenizador de `evaluateFormula` (dre.ts), então o
 * resultado bate exatamente com o que o motor calcula.
 */
function signInFormula(formula: string, code: string): 1 | -1 | null {
  const normalized = formula.replace(/\s+/g, "");
  const parts = normalized.match(/[+-]?[^+-]+/g) ?? [];
  for (const token of parts) {
    if (!token) continue;
    const op: 1 | -1 = token[0] === "-" ? -1 : 1;
    const c = token[0] === "+" || token[0] === "-" ? token.slice(1) : token;
    if (c === code) return op;
  }
  return null;
}

/**
 * Conjunto de CODES cuja contribuição deve ser SUBTRAÍDA (sinal invertido) no
 * totalizador do grupo-pai ao calcular o DRE, exclusivamente para o segmento
 * "franquias-viva".
 *
 * Problema que resolve: "Receitas Ressarciveis - Fundos" é uma RECEITA
 * cadastrada dentro do grupo de despesa "Custos com os Serviços Prestados". O
 * somatório do grupo trata todos os filhos pela HIERARQUIA (mesmo sinal), então
 * essa receita inflava o total de custos. Como a estrutura DRE não pode ser
 * alterada (a conta segue cadastrada como `despesa`), devolvemos aqui o code
 * dela para que `buildDashboardRows` a SUBTRAIA do total do grupo. Isso:
 *  - não altera a estrutura DRE, o mapeamento, nem os dados da Omie;
 *  - não altera o valor individual exibido na própria linha (o desconto ocorre
 *    apenas na soma do pai), preservando o drilldown;
 *  - propaga o sinal correto para Lucro Operacional Bruto (4-5) e demais
 *    totalizadoras derivadas, mantendo a DRE internamente consistente.
 *
 * IMPORTANTE — ciência do sinal: dentro do MESMO segmento convivem duas
 * variantes do plano. Nos planos custom de 8 das 10 empresas a fórmula do grupo
 * Custos já SUBTRAI a conta (`5.1+...5.7-5.8+5.9...`) — ali o valor já está
 * correto e NÃO deve ser invertido (senão dupla negação infla o custo). Só o
 * plano GLOBAL (usado por VVR e Petropolis) ainda SOMA (`+5.8`). Por isso só
 * incluímos o code quando o pai o agrega de forma ADITIVA. Assim a mesma regra
 * serve aos dois planos sem alterar a estrutura DRE.
 *
 * Retorna Set vazio (inerte) para qualquer outro segmento.
 */
export function resolveFranquiasVivaCustosNegation(
  segmentSlug: string | null | undefined,
  accounts: DreAccountBase[],
): ReadonlySet<string> {
  if (segmentSlug !== FRANQUIAS_VIVA_SLUG) return new Set();
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const codes = new Set<string>();
  for (const account of accounts) {
    if (normalize(account.name) !== RECEITAS_RESSARCIVEIS_FUNDOS) continue;
    const parent = account.parent_id ? byId.get(account.parent_id) : null;
    // Só inverter quando o PAI agrega esta conta ADITIVAMENTE:
    //  - pai `calculado` cuja fórmula SOMA o code (plano global "+5.8");
    //  - pai `is_summary` sem fórmula (soma todos os filhos).
    // Se o pai já SUBTRAI (planos custom "-5.8"), deixa como está.
    const additive =
      parent && parent.type === "calculado" && parent.formula
        ? signInFormula(parent.formula, account.code) === 1
        : true;
    if (additive) codes.add(account.code);
  }
  return codes;
}

/**
 * Variante para chamadores que NÃO conhecem o slug do segmento, apenas os
 * `companyIds` (ex.: geradores de relatório de IA). Resolve o segmento a partir
 * das empresas e só ativa a negação quando TODAS pertencem a "franquias-viva"
 * (relatórios são sempre escopados a um único segmento). Inerte caso contrário.
 */
export async function resolveFranquiasVivaCustosNegationForCompanies(
  supabase: SupabaseClient,
  companyIds: string[],
  accounts: DreAccountBase[],
): Promise<ReadonlySet<string>> {
  if (companyIds.length === 0) return new Set();

  const { data: segment } = await supabase
    .from("segments")
    .select("id")
    .eq("slug", FRANQUIAS_VIVA_SLUG)
    .maybeSingle();
  const franquiasVivaSegmentId = (segment as { id: string } | null)?.id ?? null;
  if (!franquiasVivaSegmentId) return new Set();

  const { data: companies } = await supabase
    .from("companies")
    .select("id,segment_id")
    .in("id", companyIds);
  const rows = (companies ?? []) as Array<{ id: string; segment_id: string | null }>;
  if (rows.length === 0) return new Set();

  const allFranquiasViva = rows.every((c) => c.segment_id === franquiasVivaSegmentId);
  return resolveFranquiasVivaCustosNegation(
    allFranquiasViva ? FRANQUIAS_VIVA_SLUG : null,
    accounts,
  );
}
