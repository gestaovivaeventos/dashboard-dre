import { getSessionContext } from "@/lib/auth/session";

export interface DpUserContext {
  id: string;
  name: string | null;
  email: string;
}

/** Contexto do usuário no Departamento Pessoal, ou null sem concessão (admin incluso). */
export async function getDpUser(): Promise<DpUserContext | null> {
  const ctx = await getSessionContext();
  if (!ctx.user || !ctx.profile || !ctx.modules?.dp) return null;
  return {
    id: ctx.profile.id,
    name: ctx.profile.name,
    email: ctx.profile.email,
  };
}

/**
 * Guard de TODA server action e rota de API do módulo. Lança "Acesso negado."
 * sem concessão. As tabelas `dp_*` que vierem devem ser escritas pelo admin
 * client DEPOIS deste guard, com a RLS (`dp_has_access()`) como segunda linha.
 */
export async function requireDpUser(): Promise<DpUserContext> {
  const user = await getDpUser();
  if (!user) throw new Error("Acesso negado.");
  return user;
}
