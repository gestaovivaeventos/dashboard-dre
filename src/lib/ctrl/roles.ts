import type { CtrlRole, UserProfileType } from "@/lib/supabase/types";

// Papel do Compras POR EMPRESA — peças PURAS e compartilhadas. Ver
// docs/superpowers/specs/2026-10-07-ctrl-papel-por-empresa-usuarios.md.
//
// Hoje o papel do Compras é GLOBAL (vem de users.profile). O override por
// empresa (ctrl_user_orgs.role) pode ESTREITAR o papel dentro de uma empresa.
// Estas funções são o único lugar que converte perfil → papéis e que decide
// entre o override e o global, para app e banco nunca divergirem.

// Vocabulário do override. É o MESMO do CHECK de ctrl_user_orgs.role. 'admin'
// NÃO entra: admin é papel GLOBAL, nunca por empresa. franqueado/csc/validador
// não são papéis do Compras.
export const CTRL_ORG_ROLE_VALUES = [
  "solicitante",
  "gerente",
  "gerente_setor",
  "diretor",
  "contas_a_pagar",
] as const;

export type CtrlOrgRole = (typeof CTRL_ORG_ROLE_VALUES)[number];

/** True se `value` é um papel de empresa válido (para validar entrada de rota). */
export function isCtrlOrgRole(value: unknown): value is CtrlOrgRole {
  return typeof value === "string" && (CTRL_ORG_ROLE_VALUES as readonly string[]).includes(value);
}

/**
 * Perfil (UserProfileType) → conjunto de CtrlRole.
 *
 * É EXATAMENTE o `switch` que era a cauda de `deriveCtrlRoles` (session.ts),
 * extraído para ser reusado pelo override por empresa. Os early-returns de "não
 * tem o módulo" (validador, franqueado/csc, !canCompras) continuam em
 * `deriveCtrlRoles` — aqui é só o mapeamento do perfil que TEM Compras.
 */
export function ctrlRolesFromProfile(profile: UserProfileType): CtrlRole[] {
  switch (profile) {
    case "admin":
      return ["admin"];
    case "contas_a_pagar":
      // 'contas_a_pagar' absorve csc + aprovacao_fornecedor.
      return ["contas_a_pagar", "csc", "aprovacao_fornecedor"];
    case "diretor":
      return ["diretor"];
    case "gerente":
    // "Gerente" (gerente_setor) tem as MESMAS permissões do "Gerente Sócio".
    case "gerente_setor":
      return ["gerente"];
    case "solicitante":
      return ["solicitante"];
    default:
      return [];
  }
}

/**
 * Papéis efetivos do usuário na EMPRESA ATIVA do Compras.
 *
 * - Admin é GLOBAL: nunca estreita por empresa (ignora o override).
 * - Sem override (`activeOrgRole = null`) → cai no papel global de hoje.
 * - Com override → usa o papel daquela empresa (mesmo mapeamento do global).
 *
 * `activeOrgRole` nunca é "admin" (o CHECK não permite); mesmo assim o guard de
 * admin acima torna impossível estreitar um admin. Com override NULL, o retorno
 * é `globalRoles` inalterado — a garantia de diff-zero.
 */
export function resolveCtrlRolesForOrg(
  globalProfile: UserProfileType | null,
  globalRoles: CtrlRole[],
  activeOrgRole: CtrlOrgRole | null,
): CtrlRole[] {
  if (globalProfile === "admin") return globalRoles;
  if (!activeOrgRole) return globalRoles;
  return ctrlRolesFromProfile(activeOrgRole);
}
