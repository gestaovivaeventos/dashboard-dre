import "server-only";

import { getSessionContext } from "@/lib/auth/session";

export interface CaixaUserContext {
  id: string;
  name: string | null;
  email: string;
}

/**
 * Contexto do usuário no Caixa, ou null sem acesso.
 *
 * Acesso = concessão em user_module_roles OU perfil admin (ver
 * @/lib/auth/caixa). Não há recorte por empresa: quem entra vê todas.
 */
export async function getCaixaUser(): Promise<CaixaUserContext | null> {
  const ctx = await getSessionContext();
  if (!ctx.user || !ctx.profile || !ctx.modules?.caixa) return null;
  return { id: ctx.profile.id, name: ctx.profile.name, email: ctx.profile.email };
}

/** Lança "Acesso negado." sem acesso. Use nas rotas que escrevem. */
export async function requireCaixaUser(): Promise<CaixaUserContext> {
  const user = await getCaixaUser();
  if (!user) throw new Error("Acesso negado.");
  return user;
}
