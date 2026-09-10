import type { VbRole } from "@/lib/supabase/types";

/**
 * Módulo VB (Viva Bank) — controle dos créditos de sócios/credores.
 *
 * ── Onde o acesso é gravado ────────────────────────────────────────────────
 * Numa linha de `user_module_roles` (module='vb', role='gestor' | 'credor'),
 * o mesmo caminho do módulo Validação de Contratos (ver @/lib/auth/contratos):
 * nenhuma coluna nova em `users`, então nada de migration travando o select
 * explícito de getSessionContext.
 *
 * ── Admin NÃO passa por cima ───────────────────────────────────────────────
 * Diferente dos outros módulos, `profile === 'admin'` não dá acesso ao VB. O
 * módulo é de um grupo fechado de pessoas; a única porta é a concessão
 * explícita — mesma filosofia das empresas restritas
 * (@/lib/auth/restricted-companies). Quem precisar liberar alguém insere a
 * linha (fase 2: botão em Usuários > "Módulos visíveis").
 *
 * Client-safe: só constantes e funções puras.
 */
export const VB_MODULE = "vb";

/** Rota raiz do módulo. */
export const VB_PATH = "/vb";

/** Chaves dos itens do grupo VB no menu lateral. */
export const VB_NAV_KEY_OVERVIEW = "vb-overview";
export const VB_NAV_KEY_IMPORT = "vb-import";

/**
 * Há alguma concessão do módulo? Aceita o select enxuto do middleware e da
 * root page (`{ module }`), que não traz o papel.
 */
export function hasVbGrant(
  rows: Array<{ module?: string | null }> | null | undefined,
): boolean {
  return (rows ?? []).some((row) => row?.module === VB_MODULE);
}

/**
 * Papel efetivo no VB a partir das linhas de `user_module_roles` (join do
 * getSessionContext, `{ module, role }`). Com as duas linhas, `gestor`
 * prevalece. Papel desconhecido não concede nada.
 */
export function resolveVbRole(
  rows: Array<{ module?: string | null; role?: string | null }> | null | undefined,
): VbRole | null {
  let role: VbRole | null = null;
  for (const row of rows ?? []) {
    if (row?.module !== VB_MODULE) continue;
    if (row.role === "gestor") return "gestor";
    if (row.role === "credor") role = "credor";
  }
  return role;
}

export function isVbPath(pathname: string): boolean {
  return pathname === VB_PATH || pathname.startsWith(`${VB_PATH}/`);
}
