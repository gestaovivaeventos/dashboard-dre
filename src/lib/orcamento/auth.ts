import { getCurrentSessionContext } from "@/lib/auth/session";

/**
 * Guard do módulo Orçamento: exclusivo de admin.
 *
 * Retorna `{ userId }` do admin autenticado, ou `null` quando o usuário não é
 * admin. As server actions retornam um erro amigável quando `null`; as páginas
 * (server components) fazem `redirect`.
 */
export async function getOrcamentoAdmin(): Promise<{ userId: string } | null> {
  const { user, profile } = await getCurrentSessionContext();
  if (!user || !profile || profile.profile !== "admin") return null;
  return { userId: profile.id };
}
