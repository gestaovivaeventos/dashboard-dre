import type { UserRole } from "@/lib/supabase/types";

export const PAGE_ACCESS_RULES: Array<{ prefix: string; roles: UserRole[] }> = [
  { prefix: "/dashboard", roles: ["admin", "gestor_hero", "gestor_unidade"] },
  { prefix: "/kpis", roles: ["admin", "gestor_hero", "gestor_unidade"] },
  { prefix: "/conexoes", roles: ["admin", "gestor_hero"] },
  { prefix: "/mapeamento", roles: ["admin"] },
  { prefix: "/configuracoes", roles: ["admin"] },
  { prefix: "/usuarios", roles: ["admin"] },
];

export function canAccessPath(pathname: string, role: UserRole) {
  const matchedRule = PAGE_ACCESS_RULES.find((rule) => pathname.startsWith(rule.prefix));
  if (!matchedRule) return true;
  return matchedRule.roles.includes(role);
}
