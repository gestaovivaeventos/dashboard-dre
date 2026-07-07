import { getSessionContext } from "@/lib/auth/session";

export interface ViagensUserContext {
  id: string;
  name: string | null;
  email: string;
  isAdmin: boolean;
  /** Pode escolher/aprovar orçamentos (gerente de viagens). */
  isAprovador: boolean;
}

/** Retorna o contexto do usuário no módulo Viagens, ou null se sem acesso. */
export async function getViagensUser(): Promise<ViagensUserContext | null> {
  const ctx = await getSessionContext();
  if (!ctx.user || !ctx.profile || !ctx.modules?.viagens) {
    return null;
  }
  const isAdmin = ctx.profile.profile === "admin" || ctx.profile.role === "admin";
  return {
    id: ctx.profile.id,
    name: ctx.profile.name,
    email: ctx.profile.email,
    isAdmin,
    isAprovador: ctx.modules.viagens.aprovador || isAdmin,
  };
}

/**
 * Guard para Server Actions do módulo Viagens: retorna o contexto ou lança.
 * Uso: const ctx = await requireViagensUser()
 */
export async function requireViagensUser(): Promise<ViagensUserContext> {
  const ctx = await getViagensUser();
  if (!ctx) throw new Error("Não autenticado.");
  return ctx;
}

/** Guard de aprovador (escolher orçamento, reservar). */
export async function requireViagensAprovador(): Promise<ViagensUserContext> {
  const ctx = await requireViagensUser();
  if (!ctx.isAprovador) throw new Error("Acesso negado.");
  return ctx;
}

/** Guard admin-only (configuração do módulo). */
export async function requireViagensAdmin(): Promise<ViagensUserContext> {
  const ctx = await requireViagensUser();
  if (!ctx.isAdmin) throw new Error("Acesso negado.");
  return ctx;
}
