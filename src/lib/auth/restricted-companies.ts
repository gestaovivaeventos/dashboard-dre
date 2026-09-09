// ============================================================================
// Empresas RESTRITAS — visíveis apenas para quem tem a empresa no cadastro.
//
// Regra: uma empresa restrita só aparece (e só pode ser consultada) para quem
// tem o vínculo explícito em `user_company_access` — o que o admin marca em
// Usuários > "Empresas / unidades". Diferente do resto do sistema, **admin não
// passa por cima**: sem o vínculo, o admin também não vê a empresa.
//
// Por que existe: `resolveAllowedCompanyIds` devolve TODAS as empresas para
// quem tem role 'admin', e as telas de Business Intelligence e Documentos
// anexos são de escopo GLOBAL (listam empresas de todos os segmentos numa
// lista só, sem o filtro por segmento do Dashboard/Fluxo/Budget). O resultado
// era a Dataforte aparecendo no seletor dessas duas telas para os três admins,
// nenhum deles cadastrado na empresa. Pedido de negócio: só quem está no
// cadastro vê.
//
// Escopo: as duas telas citadas e as APIs que elas chamam. As telas por
// segmento continuam com o comportamento de sempre (admin vê tudo) — é o que
// mantém Mapeamento, Configurações e sincronização da Omie funcionando.
//
// Como liberar alguém: marque a empresa para o usuário na tela de Usuários.
// Vale para admin também — é o único caminho, de propósito, para que a
// liberação fique visível em cadastro e não escondida numa lista no código.
//
// Client-safe: só constantes e funções puras.
// ============================================================================

/** Empresas que só aparecem para quem tem o vínculo em `user_company_access`. */
export const RESTRICTED_COMPANY_IDS: ReadonlySet<string> = new Set<string>([
  "56c44737-09d5-49ff-9248-a460216526fc", // Dataforte
]);

/** A empresa está sob a regra de restrição por cadastro? */
export function isRestrictedCompany(companyId: string): boolean {
  return RESTRICTED_COMPANY_IDS.has(companyId);
}

/**
 * O usuário pode ver esta empresa?
 *
 * Empresa fora da lista: sempre true (a autorização normal por
 * `resolveAllowedCompanyIds` continua valendo e é aplicada em separado).
 * Empresa restrita: só com o vínculo explícito no cadastro.
 *
 * `grantedCompanyIds` é sempre `profile.company_ids` — as linhas de
 * `user_company_access` do próprio usuário. Falha fechada: lista vazia (ou
 * leitura que não voltou) bloqueia.
 */
export function canSeeRestrictedCompany(
  companyId: string,
  grantedCompanyIds: readonly string[] | null | undefined,
): boolean {
  if (!isRestrictedCompany(companyId)) return true;
  return (grantedCompanyIds ?? []).includes(companyId);
}

/**
 * Remove de uma lista de empresas as restritas que o usuário não tem no
 * cadastro. Use no seletor de empresa das telas de escopo global.
 */
export function filterRestrictedCompanies<T extends { id: string }>(
  companies: readonly T[],
  grantedCompanyIds: readonly string[] | null | undefined,
): T[] {
  return companies.filter((c) => canSeeRestrictedCompany(c.id, grantedCompanyIds));
}
