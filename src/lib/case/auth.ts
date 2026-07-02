import { getSessionContext } from "@/lib/auth/session";

export interface CaseUserContext {
  id: string;
  name: string | null;
  email: string;
  isAdmin: boolean;
}

/** Retorna o contexto do usuário no módulo Case, ou null se sem acesso. */
export async function getCaseUser(): Promise<CaseUserContext | null> {
  const ctx = await getSessionContext();
  if (!ctx.user || !ctx.profile || !ctx.modules?.case) {
    return null;
  }
  return {
    id: ctx.profile.id,
    name: ctx.profile.name,
    email: ctx.profile.email,
    isAdmin: ctx.profile.profile === "admin" || ctx.profile.role === "admin",
  };
}

/**
 * Guard para Server Actions do Case: retorna o contexto ou lança se sem acesso.
 * Uso: const ctx = await requireCaseUser()
 */
export async function requireCaseUser(): Promise<CaseUserContext> {
  const ctx = await getCaseUser();
  if (!ctx) throw new Error("Não autenticado.");
  return ctx;
}

/** Guard admin-only (ex.: configuração Omie). */
export async function requireCaseAdmin(): Promise<CaseUserContext> {
  const ctx = await requireCaseUser();
  if (!ctx.isAdmin) throw new Error("Acesso negado.");
  return ctx;
}
