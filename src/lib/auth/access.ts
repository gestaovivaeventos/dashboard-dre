import { VIAGENS_ENABLED } from "@/lib/viagens/flags";
import type { DreRole, CtrlRole, UserProfileType } from "@/lib/supabase/types";

/** Alias retrocompatível */
export type { DreRole as UserRole };

// ─── Novo modelo: acesso por perfil unificado ───────────────────────────────

export function defaultLandingFor(
  profile: UserProfileType,
  canFinanceiro: boolean,
  canCompras: boolean,
  canCase: boolean = false,
  canViagens: boolean = false,
): string {
  // Ilha de contratos — não passa pela home.
  if (profile === "validador_contrato") return "/contratos";
  // Franqueado: mantém /dashboard até o Plano 2 entregar o widget Mini-DRE dele.
  if (profile === "franqueado") return "/dashboard";
  // Demais perfis com algum módulo → cockpit /home.
  if (canFinanceiro || canCompras || profile === "admin") return "/home";
  // Usuário só-Case cai direto nos contratos da Case.
  if (canCase) return "/case/contratos";
  // Usuário só-Viagens cai direto nas requisições de viagem.
  if (canViagens) return "/viagens/requisicoes";
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
  "/comparativos-anuais",
  "/kpis",
  "/financeiro/business-intelligence",
  "/financeiro/documentos",
];

// Sub-páginas permitidas dentro de /s/<segmentSlug>/... pra franqueado
const FRANQUEADO_SEGMENT_SUBS = new Set([
  "/dashboard",
  "/fluxo-de-caixa",
  "/budget-forecast",
  "/comparativos-anuais",
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
  canCase: boolean = false,
  canViagens: boolean = false,
): boolean {
  // Validador de contrato: ilha. Só /contratos.
  if (profile === "validador_contrato") {
    return pathname === "/contratos" || pathname.startsWith("/contratos/");
  }

  // Módulo Case (Case Shows) — acesso binário via can_case (admin sempre pode).
  if (pathname === "/case" || pathname.startsWith("/case/")) {
    return canCase || profile === "admin";
  }

  // Módulo Viagens — acesso binário via can_viagens (admin sempre pode).
  // A fila de aprovações tem gate extra (can_viagens_aprovar) no server action.
  if (pathname === "/viagens" || pathname.startsWith("/viagens/")) {
    if (!VIAGENS_ENABLED) return false; // kill-switch: bloqueado pra todos
    return canViagens || profile === "admin";
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
    // Contas a pagar: fora do alcance do gerente/solicitante.
    if (pathname.startsWith("/ctrl/contas-a-pagar")) {
      return ["diretor", "contas_a_pagar"].includes(profile);
    }
    // Editar Orçamento é admin-only (vive no hub Configurações). Precisa vir
    // ANTES da regra geral /ctrl/orcamento abaixo, senão gerente/diretor/csc
    // herdariam acesso. Admin já retornou true no topo desta função.
    if (pathname.startsWith("/ctrl/orcamento/editar")) {
      return false;
    }
    // Orcamento (visualizacao): gerente + diretor + contas_a_pagar (csc).
    if (pathname.startsWith("/ctrl/orcamento")) {
      return ["gerente", "diretor", "contas_a_pagar"].includes(profile);
    }
    // Relatorios: diretor + contas_a_pagar (csc); escondido do gerente/solicitante.
    if (pathname.startsWith("/ctrl/relatorios")) {
      return ["diretor", "contas_a_pagar"].includes(profile);
    }
    // Fornecedores: qualquer perfil do CTRL pode listar/cadastrar/editar.
    // A aprovação em si fica restrita ao CSC/admin (gate no client + server
    // action), mas a tela é colaborativa.
    if (pathname.startsWith("/ctrl/admin/fornecedores")) {
      return ["solicitante", "gerente", "diretor", "csc", "contas_a_pagar"].includes(profile);
    }
    // Configurações do módulo Compras (admin-only): o hub /ctrl/configuracoes e
    // as demais áreas administrativas — Eventos, Mapeamento Omie, Setores e
    // Tipos de Despesa.
    if (
      pathname.startsWith("/ctrl/configuracoes") ||
      pathname.startsWith("/ctrl/admin")
    ) {
      return false;
    }
    // Padrão dentro de /ctrl (requisicoes, orçamento, notificações, etc.)
    return true;
  }

  // Rotas do módulo Financeiro (DRE).
  // Áreas que requerem admin já caíram acima. O que sobra são telas de
  // visualização que qualquer perfil com can_financeiro pode acessar.
  if (
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/fluxo-de-caixa") ||
    pathname.startsWith("/budget-forecast") ||
    pathname.startsWith("/comparativos-anuais") ||
    pathname.startsWith("/kpis") ||
    pathname.startsWith("/home") ||
    pathname.startsWith("/s/") ||
    pathname.startsWith("/conexoes") ||
    pathname.startsWith("/financeiro") ||
    pathname.startsWith("/mapeamento") ||
    pathname.startsWith("/configuracoes")
  ) {
    if (!canFinanceiro) return false;
    // Mapeamento e Configurações continuam admin-only — admins já retornaram
    // true acima. Comparativos Anuais foi ABERTO a quem tem Financeiro (as
    // empresas são escopadas ao acesso do usuário na própria tela).
    if (
      pathname.startsWith("/mapeamento") ||
      pathname.startsWith("/configuracoes")
    ) {
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
  { suffix: "/comparativos-anuais", roles: ["admin"] },
  { suffix: "/kpis",             roles: ["admin", "gestor_hero", "gestor_unidade"] },
  { suffix: "/mapeamento",       roles: ["admin"] },
  { suffix: "/lancamentos-manuais", roles: ["admin"] },
  { suffix: "/configuracoes",    roles: ["admin"] },
  { suffix: "/painel-administrador", roles: ["admin"] },
];

const DRE_RULES: Array<{ prefix: string; roles: DreRole[] }> = [
  { prefix: "/admin",            roles: ["admin"] },
  { prefix: "/usuarios",         roles: ["admin"] },
  { prefix: "/dashboard",        roles: ["admin", "gestor_hero", "gestor_unidade"] },
  { prefix: "/fluxo-de-caixa",   roles: ["admin", "gestor_hero", "gestor_unidade"] },
  { prefix: "/budget-forecast",  roles: ["admin", "gestor_hero", "gestor_unidade"] },
  { prefix: "/comparativos-anuais", roles: ["admin"] },
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
