import { getSessionContext } from "@/lib/auth/session";
import type { CtrlRole } from "@/lib/supabase/types";

export interface CtrlUserContext {
  id: string;
  name: string | null;
  email: string;
  dreRole: "admin" | "gestor_hero" | "gestor_unidade";
  ctrlRole: CtrlRole;
}

/** Retorna o contexto do usuário na Controladoria, ou null se sem acesso. */
export async function getCtrlUser(): Promise<CtrlUserContext | null> {
  const ctx = await getSessionContext();
  if (!ctx.user || !ctx.profile || !ctx.modules?.ctrl) return null;

  return {
    id: ctx.profile.id,
    name: ctx.profile.name,
    email: ctx.profile.email,
    dreRole: ctx.profile.role,
    ctrlRole: ctx.modules.ctrl.role,
  };
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
  if (!allowedRoles.includes(ctx.ctrlRole)) {
    throw new Error("Acesso negado.");
  }
  return ctx;
}
