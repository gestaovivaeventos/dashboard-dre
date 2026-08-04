import type { UnifiedProfile, UserProfileType } from "@/lib/supabase/types";

// ============================================================================
// Quem pode ver/usar a tela "Validação Relatório" (/financeiro/validacao-relatorio).
//
// Regra de negócio (fechada):
//   - perfil CSC;
//   - Admin;
//   - Marcela de Souza  (marcela@quokka.net.br);
//   - Marcelo Gonçalves (marcelo@quokka.net.br).
//
// Qualquer outro usuário NÃO vê o item no menu, é bloqueado no middleware e
// levaria 403 nas rotas de API. Espelha public.can_validate_bi_reports() no
// banco (RLS) — ao mudar um, mude os dois.
// ============================================================================

/** E-mails nominais liberados além do perfil CSC/admin. Sempre em minúsculas. */
export const BI_VALIDATION_EXTRA_EMAILS: ReadonlySet<string> = new Set([
  "marcela@quokka.net.br",
  "marcelo@quokka.net.br",
]);

/** Rota da tela. Centralizada para o menu, o middleware e os redirects. */
export const BI_VALIDATION_PATH = "/financeiro/validacao-relatorio";

/** Chave do item no menu lateral (NAV_GROUPS). */
export const BI_VALIDATION_NAV_KEY = "fin-validacao";

function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

/**
 * Versão "crua" — usada pelo middleware, que só tem `profile` + e-mail do
 * usuário autenticado (não carrega o UnifiedProfile completo).
 */
export function canAccessBiValidationByProfile(
  profile: UserProfileType | null,
  email: string | null | undefined,
): boolean {
  if (profile === "admin" || profile === "csc") return true;
  return BI_VALIDATION_EXTRA_EMAILS.has(normalizeEmail(email));
}

/** Versão usada nas páginas/rotas, a partir do perfil da sessão. */
export function canAccessBiValidation(
  profile: Pick<UnifiedProfile, "profile" | "role" | "email"> | null,
): boolean {
  if (!profile) return false;
  // `role` legado ainda marca admins criados antes do modelo unificado.
  if (profile.role === "admin") return true;
  return canAccessBiValidationByProfile(profile.profile, profile.email);
}
