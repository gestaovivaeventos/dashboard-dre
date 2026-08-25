import {
  BI_VALIDATION_PATH,
  canAccessBiValidationByProfile,
} from "@/lib/auth/bi-validation";
import { hasCtrlFullView } from "@/lib/ctrl/full-view";
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
  canContratos: boolean = false,
): string {
  // TODO perfil pousa na tela inicial. Ela é o cockpit comum do Control Hub:
  // saudação, indicadores e notícias econômicas para todos, e as seções
  // operacionais que cada perfil pode ver (@/lib/home/ctrl-widgets). Os destinos
  // por módulo que existiam aqui (franqueado/CSC em /dashboard, validador de
  // contrato em /contratos, só-Case em /case/contratos, só-Viagens em
  // /viagens/requisicoes) saíram: a home é acessível a todos e leva a essas
  // telas pelo menu.
  if (
    canFinanceiro ||
    canCompras ||
    canCase ||
    canViagens ||
    canContratos ||
    profile === "admin"
  ) {
    return "/home";
  }
  // Usuário ativo sem NENHUM módulo liberado — não é regra de perfil, é falta de
  // acesso: continua na tela de espera. (Usuário inativo já vai para /pendente
  // antes de chegar aqui, na root page e no middleware.)
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
  /**
   * Módulo Validação de Contratos (/contratos). Concedido por usuário em
   * "Módulos visíveis" — ver @/lib/auth/contratos.
   */
  canContratos: boolean = false,
  /**
   * E-mail do usuário. Usado pelas liberações NOMINAIS: a tela "Validação
   * Relatório" (marcela@/marcelo@quokka.net.br além de CSC/admin) e a visão
   * completa do módulo Compras (@/lib/ctrl/full-view). Ausente = trata como
   * não-nominal (a regra por perfil continua valendo).
   */
  email: string | null = null,
): boolean {
  // Tela inicial (cockpit): liberada para TODOS os perfis, sem depender de
  // módulo. O que cada um VÊ lá dentro é decidido por perfil na própria tela
  // (ver @/lib/home/ctrl-widgets) — aqui é só o acesso à rota.
  //
  // Vem antes de tudo de propósito: /home estava dentro do bloco do módulo
  // Financeiro, então quem só tem Compras (solicitante, gerente, diretor,
  // contas a pagar sem can_financeiro) era barrado justamente na rota para a
  // qual o defaultLandingFor o manda — o middleware negava e redirecionava de
  // volta para /home, em loop.
  if (pathname === "/home" || pathname.startsWith("/home/")) return true;

  // Validador de contrato: ilha. Só /contratos (+ a tela inicial, acima).
  if (profile === "validador_contrato") {
    return pathname === "/contratos" || pathname.startsWith("/contratos/");
  }

  // Tela "Validação Relatório": whitelist fechada (CSC + admin + e-mails
  // nominais). Precisa vir ANTES das regras genéricas de /financeiro, que
  // liberariam a tela para qualquer perfil com o módulo Financeiro.
  if (pathname === BI_VALIDATION_PATH || pathname.startsWith(`${BI_VALIDATION_PATH}/`)) {
    return canAccessBiValidationByProfile(profile, email);
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

  // Módulo Validação de Contratos — acesso binário pelo módulo concedido ao
  // usuário (admin sempre pode). Antes a tela era exclusiva do perfil
  // 'validador_contrato', o que impedia dar o acesso a quem tem outro perfil
  // (ex.: gerente do Compras, Visão Financeira). Precisa vir ANTES do bloco do
  // franqueado/CSC, cuja whitelist negaria a rota mesmo com o módulo marcado.
  if (pathname === "/contratos" || pathname.startsWith("/contratos/")) {
    return canContratos || profile === "admin";
  }

  // Franqueado (e a cópia CSC): whitelist explícita de telas do Financeiro.
  // Bloqueia Conexões, Mapeamento, Configurações, /admin, /usuarios, /ctrl e
  // qualquer página fora das visualizações permitidas. As telas "Validação
  // Relatório" (CSC) e "Validação de Contratos" (quem tem o módulo) já foram
  // decididas acima.
  if (profile === "franqueado" || profile === "csc") {
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

  // Plataforma é admin-only — qualquer outra rota /admin* ou /usuarios
  // exige admin. O módulo Orçamento (/orcamento*) também é admin-only: admin
  // já retornou true no topo, então aqui negamos para todos os demais perfis.
  // (Não confundir com /ctrl/orcamento, do módulo Compras, tratado abaixo.)
  if (
    pathname.startsWith("/admin") ||
    pathname.startsWith("/usuarios") ||
    pathname.startsWith("/orcamento") ||
    pathname.startsWith("/menu-lab")
  ) {
    return false;
  }

  // Rotas do módulo Compras (CTRL).
  if (pathname.startsWith("/ctrl")) {
    if (!canCompras) return false;
    // Visão completa (leitura) do módulo por liberação nominal — ver
    // @/lib/ctrl/full-view. Vale para as telas operacionais abaixo; NÃO vale
    // para Configurações (/ctrl/configuracoes, /ctrl/admin/* e Editar
    // Orçamento), reservadas a admin + perfil Contas a Pagar mais adiante.
    const fullView = hasCtrlFullView(email);
    // Manual do módulo: liberado a todo mundo que tem Compras (a regra geral no
    // fim desta função já bastaria; explícito aqui para que uma futura restrição
    // por perfil não o derrube junto sem querer).
    if (pathname.startsWith("/ctrl/manual")) return true;
    // Aprovações: gerente/diretor/contas_a_pagar/admin
    if (pathname.startsWith("/ctrl/aprovacoes")) {
      return (
        fullView ||
        ["gerente", "gerente_setor", "diretor", "contas_a_pagar"].includes(profile)
      );
    }
    // Contas a Pagar: exclusivo do perfil Contas a Pagar (+ admin, que já
    // retornou true no topo). Diretor/gerente/solicitante não acessam — só a
    // visão completa entra, e em modo somente-leitura (gate na própria página).
    if (pathname.startsWith("/ctrl/contas-a-pagar")) {
      return fullView || profile === "contas_a_pagar";
    }
    // Editar Orçamento vive no hub Configurações: admin + perfil Contas a
    // Pagar. Precisa vir ANTES da regra geral /ctrl/orcamento abaixo, senão
    // gerente/diretor herdariam acesso. Admin já retornou true no topo desta
    // função. A visão completa (fullView) NÃO entra aqui — ela é leitura do
    // módulo operacional, não das Configurações.
    if (pathname.startsWith("/ctrl/orcamento/editar")) {
      return profile === "contas_a_pagar";
    }
    // Orcamento (visualizacao): gerente + gerente_setor + diretor +
    // contas_a_pagar (csc). O gerente_setor entra na tela, mas só enxerga os
    // setores vinculados a ele (filtro na própria página).
    if (pathname.startsWith("/ctrl/orcamento")) {
      return (
        fullView ||
        ["gerente", "gerente_setor", "diretor", "contas_a_pagar"].includes(profile)
      );
    }
    // Relatorios: diretor + contas_a_pagar (csc); escondido do gerente/solicitante.
    if (pathname.startsWith("/ctrl/relatorios")) {
      return fullView || ["diretor", "contas_a_pagar"].includes(profile);
    }
    // Fornecedores: qualquer perfil do CTRL pode listar/cadastrar/editar.
    // A aprovação em si fica restrita ao CSC/admin (gate no client + server
    // action), mas a tela é colaborativa.
    if (pathname.startsWith("/ctrl/admin/fornecedores")) {
      return (
        fullView ||
        ["solicitante", "gerente", "gerente_setor", "diretor", "csc", "contas_a_pagar"].includes(
          profile,
        )
      );
    }
    // Configurações do módulo Compras: o hub /ctrl/configuracoes e as demais
    // áreas administrativas — Eventos, Mapeamento Omie, Setores e Tipos de
    // Despesa. Admin (já liberado no topo) + perfil Contas a Pagar, que opera
    // esses cadastros no dia a dia. Fornecedores já foi liberado acima, para
    // todos os perfis. A visão completa (fullView) segue de fora: ela é leitura
    // do módulo operacional, não das Configurações.
    if (
      pathname.startsWith("/ctrl/configuracoes") ||
      pathname.startsWith("/ctrl/admin")
    ) {
      return profile === "contas_a_pagar";
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
    // /home saiu daqui: a tela inicial é de todos os perfis e já foi liberada
    // no topo desta função, antes de qualquer gate de módulo.
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
