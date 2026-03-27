import type { UserRole } from "@/lib/supabase/types";

/** Sub-page access rules within a segment (e.g., /s/franquias-viva/mapeamento) */
const SEGMENT_SUB_RULES: Array<{ suffix: string; roles: UserRole[] }> = [
  { suffix: "/dashboard", roles: ["admin", "gestor_hero", "gestor_unidade"] },
  { suffix: "/kpis", roles: ["admin", "gestor_hero", "gestor_unidade"] },
  { suffix: "/mapeamento", roles: ["admin"] },
  { suffix: "/configuracoes", roles: ["admin"] },
];

/** Global page access rules */
const GLOBAL_RULES: Array<{ prefix: string; roles: UserRole[] }> = [
  { prefix: "/admin", roles: ["admin"] },
  { prefix: "/usuarios", roles: ["admin"] },
  // Legacy routes (still accessible for backwards compat)
  { prefix: "/dashboard", roles: ["admin", "gestor_hero", "gestor_unidade"] },
  { prefix: "/kpis", roles: ["admin", "gestor_hero", "gestor_unidade"] },
  { prefix: "/conexoes", roles: ["admin", "gestor_hero"] },
  { prefix: "/mapeamento", roles: ["admin"] },
  { prefix: "/configuracoes", roles: ["admin"] },
];

export function canAccessPath(pathname: string, role: UserRole) {
  // Segment routes: /s/<slug>/<sub-page>
  if (pathname.startsWith("/s/")) {
    const parts = pathname.split("/"); // ['', 's', slug, subpage, ...]
    const subPage = parts[3] ? `/${parts[3]}` : null;
    if (subPage) {
      const rule = SEGMENT_SUB_RULES.find((r) => subPage.startsWith(r.suffix));
      if (rule) return rule.roles.includes(role);
    }
    // Allow access to /s/<slug> root (will redirect to dashboard)
    return true;
  }

  // Global routes
  const matchedRule = GLOBAL_RULES.find((rule) => pathname.startsWith(rule.prefix));
  if (!matchedRule) return true;
  return matchedRule.roles.includes(role);
}
