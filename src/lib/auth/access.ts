import type { DreRole, CtrlRole, UserProfileType } from "@/lib/supabase/types";

/** Alias retrocompatível */
export type { DreRole as UserRole };

// ─── Novo modelo: acesso por perfil unificado ───────────────────────────────

/**
 * Para onde mandar o usuário no pós-login (ou quando tenta acessar uma rota
 * proibida). A regra de prioridade:
 *   1. Validador de contrato → /contratos (sempre)
 *   2. Sem nenhum módulo → /pendente (caso degenerado)
 *   3. Tem Financeiro → /dashboard
 *   4. Só Compras → /ctrl/requisicoes
 *   5. Admin sem módulos marcados → /dashboard como fallback
 */
export function defaultLandingFor(
  profile: UserProfileType,
  canFinanceiro: boolean,
  canCompras: boolean,
): string {
  if (profile === "validador_contrato") return "/contratos";
  if (profile === "franqueado") return "/dashboard";
  if (profile === "admin") return canFinanceiro || !canCompras ? "/dashboard" : "/ctrl/requisicoes";
  if (canFinanceiro) return "/dashboard";
  if (canCompras) return "/ctrl/requisicoes";
  return "/pendente";
}

// Whitelist explícito de rotas que o perfil 'franqueado' pode acessar dentro
// do módulo Financeiro. Tudo fora dessa lista (Conexões, Mapeamento,
// Configurações, /admin, /ctrl, /contratos, /usuarios) é negado.
const FRANQUEADO_BASE_PATHS = [
  "/home",
  "/dashboard",
  "/fluxo-de-caixa",
  "/budget-forecast",
  "/kpis",
  "/financeiro/business-intelligence",
  "/financeiro/documentos",
];

// Sub-páginas permitidas dentro de /s/<segmentSlug>/... pra franqueado
const FRANQUEADO_SEGMENT_SUBS = new Set([
  "/dashboard",
  "/fluxo-de-caixa",
  "/budget-forecast",
  "/kpis",
]);

/**
 * Decide se o usuário pode acessar uma URL com base no novo modelo.
 *
 * - Validador de contrato: só /contratos
 * - Admin: tudo
 * - Demais: dependem do módulo da rota (financeiro vs compras vs plataforma)
 *   E do perfil (gerente/diretor/solicitante/contas_a_pagar) pra páginas
 *   sensíveis dentro de Compras.
 */
export function canAccessPathByProfile(
  pathname: string,
  profile: UserProfileType,
  canFinanceiro: boolean,
  canCompras: boolean,
): boolean {
  // Validador de contrato: ilha. Só /contratos.
  if (profile === "validador_contrato") {
    return pathname === "/contratos" || pathname.startsWith("/contratos/");
  }

  // Franqueado: whitelist explícita de telas do Financeiro.
  // Bloqueia Conexões, Mapeamento, Configurações, /admin, /usuarios, /ctrl,
  // /contratos e qualquer página fora das 5 visualizações permitidas.
  if (profile === "franqueado") {
    if (FRANQUEADO_BASE_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
      return true;
    }
    // Rotas com prefixo /s/<segmentSlug>/<sub> são as mesmas telas servidas
    // por segmento — liberamos só os subs aceitos.
    if (pathname.startsWith("/s/")) {
      const parts = pathname.split("/");
      const sub = parts[3] ? `/${parts[3]}` : "";
      return FRANQUEADO_SEGMENT_SUBS.has(sub);
    }
    return false;
  }

  // Admin: tudo.
  if (profile === "admin") return true;

  // /contratos é restrito a admin + validador_contrato; demais perfis: 403.
  if (pathname === "/contratos" || pathname.startsWith("/contratos/")) {
    return false;
  }

  // Plataforma é admin-only — qualquer outra rota /admin* ou /usuarios
  // exige admin.
  if (
    pathname.startsWith("/admin") ||
    pathname.startsWith("/usuarios") ||
    pathname.startsWith("/menu-lab")
  ) {
    return false;
  }

  // Rotas do módulo Compras (CTRL).
  if (pathname.startsWith("/ctrl")) {
    if (!canCompras) return false;
    // Aprovações: gerente/diretor/contas_a_pagar/admin
    if (pathname.startsWith("/ctrl/aprovacoes")) {
      return ["gerente", "diretor", "contas_a_pagar"].includes(profile);
    }
    // Contas a pagar
    if (pathname.startsWith("/ctrl/contas-a-pagar")) {
      return ["gerente", "diretor", "contas_a_pagar"].includes(profile);
    }
    // Fornecedores: qualquer perfil do CTRL pode listar/cadastrar/editar.
    // A aprovação em si fica restrita ao CSC/admin (gate no client + server
    // action), mas a tela é colaborativa.
    if (pathname.startsWith("/ctrl/admin/fornecedores")) {
      return ["solicitante", "gerente", "diretor", "csc", "contas_a_pagar"].includes(profile);
    }
    // Demais áreas administrativas do CTRL
    if (pathname.startsWith("/ctrl/admin")) {
      return profile === "contas_a_pagar";
    }
    // Padrão dentro de /ctrl (requisicoes, notificações, etc.)
    return true;
  }

  // Rotas do módulo Financeiro (DRE).
  // Áreas que requerem admin já caíram acima. O que sobra são telas de
  // visualização que qualquer perfil com can_financeiro pode acessar.
  if (
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/fluxo-de-caixa") ||
    pathname.startsWith("/budget-forecast") ||
    pathname.startsWith("/kpis") ||
    pathname.startsWith("/home") ||
    pathname.startsWith("/s/") ||
    pathname.startsWith("/conexoes") ||
    pathname.startsWith("/mapeamento") ||
    pathname.startsWith("/configuracoes")
  ) {
    if (!canFinanceiro) return false;
    // Mapeamento e Configurações continuam admin-only — caíram acima
    // se não fosse admin. Aqui só vê quem tem financeiro.
    if (pathname.startsWith("/mapeamento") || pathname.startsWith("/configuracoes")) {
      return false;
    }
    return true;
  }

  // Default permissivo pra rotas não-mapeadas (ex: /pendente, /loading)
  return true;
}

// ─── Legado: SEGMENT_SUB_RULES / DRE_RULES / CTRL_RULES ────────────────────
// Mantidos para o código antigo que ainda chama canAccessPath(role, ...).
// A nova lógica vive em canAccessPathByProfile. Quando todos os callers
// migrarem, isso some.

// ─── Regras do módulo DRE ─────────────────────────────────────────────────────

const SEGMENT_SUB_RULES: Array<{ suffix: string; roles: DreRole[] }> = [
  { suffix: "/dashboard",        roles: ["admin", "gestor_hero", "gestor_unidade"] },
  { suffix: "/fluxo-de-caixa",   roles: ["admin", "gestor_hero", "gestor_unidade"] },
  { suffix: "/budget-forecast",  roles: ["admin", "gestor_hero", "gestor_unidade"] },
  { suffix: "/kpis",             roles: ["admin", "gestor_hero", "gestor_unidade"] },
  { suffix: "/mapeamento",       roles: ["admin"] },
  { suffix: "/lancamentos-manuais", roles: ["admin"] },
  { suffix: "/configuracoes",    roles: ["admin"] },
];

const DRE_RULES: Array<{ prefix: string; roles: DreRole[] }> = [
  { prefix: "/admin",            roles: ["admin"] },
  { prefix: "/usuarios",         roles: ["admin"] },
  { prefix: "/dashboard",        roles: ["admin", "gestor_hero", "gestor_unidade"] },
  { prefix: "/fluxo-de-caixa",   roles: ["admin", "gestor_hero", "gestor_unidade"] },
  { prefix: "/budget-forecast",  roles: ["admin", "gestor_hero", "gestor_unidade"] },
  { prefix: "/kpis",             roles: ["admin", "gestor_hero", "gestor_unidade"] },
  { prefix: "/conexoes",         roles: ["admin", "gestor_hero"] },
  { prefix: "/contratos",        roles: ["admin", "gestor_hero"] },
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
  options: { contractsOnly?: boolean } = {},
): boolean {
  // Contracts-only users see *only* /contratos and its sub-paths.
  if (options.contractsOnly) {
    return pathname === "/contratos" || pathname.startsWith("/contratos/");
  }

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
