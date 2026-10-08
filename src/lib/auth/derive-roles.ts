import { ctrlRolesFromProfile } from "@/lib/ctrl/roles";
import type { CtrlRole, DreRole, UserProfileType } from "@/lib/supabase/types";

// Perfil (users.profile) → papéis legados de DRE e do Compras. Puro e fora de
// session.ts para ser reusado pela API externa (@/lib/ext-api/identity) sem
// arrastar cookies/next/headers.

export type UserProfileEnum = UserProfileType;

export function deriveDreRole(
  profile: UserProfileEnum | null,
  fallback: DreRole | null,
): DreRole {
  if (!profile) return fallback ?? "gestor_unidade";
  switch (profile) {
    case "admin":
      return "admin";
    case "diretor":
      return "gestor_hero";
    case "contas_a_pagar":
      return "gestor_hero";
    case "gerente":
    case "gerente_setor":
      return "gestor_unidade";
    case "solicitante":
      return "gestor_unidade";
    case "validador_contrato":
      // contracts_only users had a 'gestor_unidade' role in the legacy model;
      // they don't really use DRE but we keep a value so old checks don't fail.
      return "gestor_unidade";
    case "franqueado":
    // 'csc' é a cópia funcional do franqueado — mesmo DRE role restritivo.
    case "csc":
      // Restricted financeiro user. 'gestor_unidade' is the most restrictive
      // legacy DRE role — keeps any legacy admin-only check denying access.
      return "gestor_unidade";
  }
}

export function deriveCtrlRoles(
  profile: UserProfileEnum | null,
  canCompras: boolean,
  existingRows: Array<{ role: string; module: string }> | null,
): CtrlRole[] {
  if (!profile) {
    // Fall back to whatever exists in user_module_roles (pre-migration data)
    return (existingRows ?? [])
      .filter((r) => r.module === "ctrl")
      .map((r) => r.role as CtrlRole);
  }
  if (profile === "validador_contrato") return [];
  // Franqueado (e sua cópia CSC) nunca tem acesso ao módulo Compras.
  if (profile === "franqueado" || profile === "csc") return [];
  if (!canCompras && profile !== "admin") return [];

  // O mapeamento perfil → CtrlRole vive em @/lib/ctrl/roles (puro), para ser
  // reusado pelo override por empresa (ctrl_user_orgs.role) sem duplicar a
  // regra. "Gerente" (gerente_setor) tem as MESMAS permissões do "Gerente
  // Sócio"; a restrição por setor dele vive só na tela /ctrl/orcamento, que lê
  // profile.profile — não passa por CtrlRole.
  return ctrlRolesFromProfile(profile);
}
