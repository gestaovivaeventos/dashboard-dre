import { getSessionContext } from "@/lib/auth/session";
import { hasCtrlFullView } from "@/lib/ctrl/full-view";
import { getInjectedCtrlUser } from "@/lib/ctrl/injected-identity";
import { getCtrlOrgContext, type CtrlOrg } from "@/lib/ctrl/orgs";
import { resolveCtrlRolesForOrg } from "@/lib/ctrl/roles";
import type { CtrlRole, UserProfileType } from "@/lib/supabase/types";

export interface CtrlUserContext {
  id: string;
  name: string | null;
  email: string;
  dreRole: "admin" | "gestor_hero" | "gestor_unidade";
  /**
   * Perfil unificado (users.profile). Use apenas quando dois perfis compartilham
   * o mesmo CtrlRole e a tela precisa distinguí-los — hoje só o par
   * gerente ("Gerente Sócio") vs gerente_setor ("Gerente") na tela de Orçamento.
   * Para permissão, continue usando hasCtrlRole/requireCtrlRole.
   */
  profile: UserProfileType;
  /** Conjunto de permissoes no modulo Controladoria. Nunca vazio quando o contexto existe. */
  ctrlRoles: CtrlRole[];
  /** Setores aos quais o usuario esta vinculado (user_sectors). Vazio = sem vinculo. */
  sectorIds: string[];
  // ── Empresa do Compras (multiempresa — ver src/lib/ctrl/orgs.ts) ──────────
  /** Empresas que o usuário pode acessar (admin → todas as ativas). */
  orgs: CtrlOrg[];
  /** Ids das empresas acessíveis. */
  orgIds: string[];
  /** Empresa ATIVA (cookie validado contra orgs; senão a 1ª). null só se não há empresa. */
  orgId: string | null;
}

/** Retorna o contexto do usuário na Controladoria, ou null se sem acesso. */
export async function getCtrlUser(): Promise<CtrlUserContext | null> {
  const injected = getInjectedCtrlUser();
  if (injected) return injected;

  const ctx = await getSessionContext();
  if (!ctx.user || !ctx.profile || !ctx.modules?.ctrl || ctx.modules.ctrl.roles.length === 0) {
    return null;
  }

  // Empresa ativa do Compras (RLS de ctrl_orgs recorta ao que o usuário acessa).
  const orgCtx = await getCtrlOrgContext(ctx.supabase);

  // Papéis do Compras NA EMPRESA ATIVA: o override de ctrl_user_orgs.role
  // estreita o papel por empresa; sem override (null) cai no papel global de
  // hoje. Admin é ignorado (segue global). Este é o ÚNICO ponto em que o papel
  // por empresa entra no módulo — todo requireCtrlRole/hasCtrlRole/getRequests
  // herda daqui. Ver docs/.../2026-10-07-ctrl-papel-por-empresa-usuarios.md.
  const ctrlRoles = resolveCtrlRolesForOrg(
    ctx.profile.profile,
    ctx.modules.ctrl.roles,
    orgCtx.activeOrgRole,
  );

  return {
    id: ctx.profile.id,
    name: ctx.profile.name,
    email: ctx.profile.email,
    dreRole: ctx.profile.role,
    profile: ctx.profile.profile,
    ctrlRoles,
    sectorIds: ctx.profile.sector_ids ?? [],
    orgs: orgCtx.orgs,
    orgIds: orgCtx.orgIds,
    orgId: orgCtx.activeOrgId,
  };
}

/** Verifica se o contexto possui ao menos um dos roles informados. */
export function hasCtrlRole(ctx: CtrlUserContext, ...allowedRoles: CtrlRole[]): boolean {
  if (allowedRoles.length === 0) return true;
  return ctx.ctrlRoles.some((r) => allowedRoles.includes(r));
}

/**
 * Guard para Server Actions: retorna o contexto ou lança erro se não autorizado.
 * Uso: const ctx = await requireCtrlRole("gerente", "diretor", "admin")
 */
export async function requireCtrlRole(
  ...allowedRoles: CtrlRole[]
): Promise<CtrlUserContext> {
  const ctx = await getCtrlUser();
  if (!ctx) throw new Error("Não autenticado.");
  if (allowedRoles.length > 0 && !hasCtrlRole(ctx, ...allowedRoles)) {
    throw new Error("Acesso negado.");
  }
  return ctx;
}

/**
 * Igual ao requireCtrlRole, mas também autoriza quem tem a visão completa do
 * módulo (@/lib/ctrl/full-view) — o override nominal que dá a um líder de área
 * o módulo Compras inteiro sem mudar o perfil dele.
 *
 * Usar SÓ nas ações que o override deve mesmo alcançar (hoje: as operações da
 * tela Contas a Pagar). Onde a alçada continua valendo — aprovar/rejeitar por
 * setor — a guarda é outra (fullViewSectorBlock, em actions/requests.ts).
 */
export async function requireCtrlRoleOrFullView(
  ...allowedRoles: CtrlRole[]
): Promise<CtrlUserContext> {
  const ctx = await getCtrlUser();
  if (!ctx) throw new Error("Não autenticado.");
  if (
    allowedRoles.length > 0 &&
    !hasCtrlRole(ctx, ...allowedRoles) &&
    !hasCtrlFullView(ctx.email)
  ) {
    throw new Error("Acesso negado.");
  }
  return ctx;
}
