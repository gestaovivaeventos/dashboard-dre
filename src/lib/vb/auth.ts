import { getSessionContext } from "@/lib/auth/session";
import type { VbRole } from "@/lib/supabase/types";

export interface VbUserContext {
  id: string;
  name: string | null;
  email: string;
  role: VbRole;
}

/** Contexto do usuário no VB, ou null sem concessão (admin incluso). */
export async function getVbUser(): Promise<VbUserContext | null> {
  const ctx = await getSessionContext();
  if (!ctx.user || !ctx.profile || !ctx.modules?.vb) return null;
  return {
    id: ctx.profile.id,
    name: ctx.profile.name,
    email: ctx.profile.email,
    role: ctx.modules.vb.role,
  };
}

/** Qualquer papel do módulo. Lança "Acesso negado." sem concessão. */
export async function requireVbUser(): Promise<VbUserContext> {
  const user = await getVbUser();
  if (!user) throw new Error("Acesso negado.");
  return user;
}

/** Só gestor: importação, lançamentos, edição de credor. */
export async function requireVbGestor(): Promise<VbUserContext> {
  const user = await requireVbUser();
  if (user.role !== "gestor") throw new Error("Acesso negado.");
  return user;
}
