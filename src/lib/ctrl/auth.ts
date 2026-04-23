import { getSessionContext } from "@/lib/auth/session";
import type { CtrlRole } from "@/lib/supabase/types";

export interface CtrlUserContext {
  id: string;
  name: string | null;
  email: string;
  dreRole: "admin" | "gestor_hero" | "gestor_unidade";
  /** Conjunto de permissoes no modulo Controladoria. Nunca vazio quando o contexto existe. */
  ctrlRoles: CtrlRole[];
}

/** Retorna o contexto do usuário na Controladoria, ou null se sem acesso. */
export async function getCtrlUser(): Promise<CtrlUserContext | null> {
  const ctx = await getSessionContext();
  if (!ctx.user || !ctx.profile || !ctx.modules?.ctrl || ctx.modules.ctrl.roles.length === 0) {
    return null;
  }

  return {
    id: ctx.profile.id,
    name: ctx.profile.name,
    email: ctx.profile.email,
    dreRole: ctx.profile.role,
    ctrlRoles: ctx.modules.ctrl.roles,
  };
}

/** Verifica se o contexto possui ao menos um dos roles informados. */
export function hasCtrlRole(ctx: CtrlUserContext, ...allowedRoles: CtrlRole[]): boolean {
  if (allowedRoles.length === 0) return true;
  return ctx.ctrlRoles.some((r) => allowedRoles.includes(r));
}

/**
 * Guard para Server Actions: retorna o contexto ou lança erro se não autorizado.
 * Uso: const ctx = await requireCtrlRole("gerente", "diretor", "admin")
 */
export async function requireCtrlRole(
  ...allowedRoles: CtrlRole[]
): Promise<CtrlUserContext> {
  const ctx = await getCtrlUser();
  if (!ctx) throw new Error("Não autenticado.");
  if (allowedRoles.length > 0 && !hasCtrlRole(ctx, ...allowedRoles)) {
    throw new Error("Acesso negado.");
  }
  return ctx;
}
