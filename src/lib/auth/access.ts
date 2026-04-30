import type { DreRole, CtrlRole } from "@/lib/supabase/types";

/** Alias retrocompatível */
export type { DreRole as UserRole };

// ─── Regras do módulo DRE ─────────────────────────────────────────────────────

const SEGMENT_SUB_RULES: Array<{ suffix: string; roles: DreRole[] }> = [
  { suffix: "/dashboard",        roles: ["admin", "gestor_hero", "gestor_unidade"] },
  { suffix: "/budget-forecast",  roles: ["admin", "gestor_hero", "gestor_unidade"] },
  { suffix: "/kpis",             roles: ["admin", "gestor_hero", "gestor_unidade"] },
  { suffix: "/mapeamento",       roles: ["admin"] },
  { suffix: "/configuracoes",    roles: ["admin"] },
];

const DRE_RULES: Array<{ prefix: string; roles: DreRole[] }> = [
  { prefix: "/admin",            roles: ["admin"] },
  { prefix: "/usuarios",         roles: ["admin"] },
  { prefix: "/dashboard",        roles: ["admin", "gestor_hero", "gestor_unidade"] },
  { prefix: "/budget-forecast",  roles: ["admin", "gestor_hero", "gestor_unidade"] },
  { prefix: "/kpis",             roles: ["admin", "gestor_hero", "gestor_unidade"] },
  { prefix: "/conexoes",         roles: ["admin", "gestor_hero"] },
  { prefix: "/mapeamento",       roles: ["admin"] },
  { prefix: "/configuracoes",    roles: ["admin"] },
];

// ─── Regras do módulo Ctrl ────────────────────────────────────────────────────

const CTRL_RULES: Array<{ prefix: string; roles: CtrlRole[] }> = [
  { prefix: "/ctrl/admin",       roles: ["admin"] },
  { prefix: "/ctrl/orcamento",   roles: ["admin", "gerente", "diretor", "csc"] },
  { prefix: "/ctrl/aprovacoes",  roles: ["admin", "gerente", "diretor", "csc"] },
  { prefix: "/ctrl/requisicoes", roles: ["admin", "solicitante", "gerente", "diretor", "csc"] },
  { prefix: "/ctrl",             roles: ["admin", "solicitante", "gerente", "diretor", "csc"] },
];

// ─── Função principal ─────────────────────────────────────────────────────────

export function canAccessPath(
  pathname: string,
  dreRole: DreRole,
  ctrlRole: CtrlRole | null = null,
): boolean {
  // Módulo Ctrl: /ctrl/*
  if (pathname.startsWith("/ctrl")) {
    if (!ctrlRole) return false;
    const rule = CTRL_RULES.find((r) => pathname.startsWith(r.prefix));
    if (!rule) return true;
    return rule.roles.includes(ctrlRole);
  }

  // Módulo DRE: rotas de segmento /s/<slug>/<sub>
  if (pathname.startsWith("/s/")) {
    const parts = pathname.split("/");
    const subPage = parts[3] ? `/${parts[3]}` : null;
    if (subPage) {
      const rule = SEGMENT_SUB_RULES.find((r) => subPage.startsWith(r.suffix));
      if (rule) return rule.roles.includes(dreRole);
    }
    return true;
  }

  // Módulo DRE: rotas globais
  const rule = DRE_RULES.find((r) => pathname.startsWith(r.prefix));
  if (!rule) return true;
  return rule.roles.includes(dreRole);
}
