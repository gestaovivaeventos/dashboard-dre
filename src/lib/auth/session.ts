import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { VIAGENS_ENABLED } from "@/lib/viagens/flags";
import type { DreRole, CtrlRole, ModuleAccess, UnifiedProfile } from "@/lib/supabase/types";

export type { ModuleAccess, UnifiedProfile };

export interface SessionContext {
  supabase: Awaited<ReturnType<typeof createClient>>;
  user: import("@supabase/supabase-js").User | null;
  profile: UnifiedProfile | null;
  modules: ModuleAccess | null;
}

// ─── Helpers de autorização (use em Server Components e API Routes) ────────────

export function hasDreAccess(ctx: SessionContext, minRole?: DreRole): boolean {
  if (!ctx.modules?.dre) return false;
  if (!minRole) return true;
  const hierarchy: DreRole[] = ["gestor_unidade", "gestor_hero", "admin"];
  return hierarchy.indexOf(ctx.modules.dre.role) >= hierarchy.indexOf(minRole);
}

export function hasCtrlAccess(ctx: SessionContext, roles?: CtrlRole[]): boolean {
  if (!ctx.modules?.ctrl || ctx.modules.ctrl.roles.length === 0) return false;
  if (!roles || roles.length === 0) return true;
  return ctx.modules.ctrl.roles.some((r) => roles.includes(r));
}

export function hasCaseAccess(ctx: SessionContext): boolean {
  return Boolean(ctx.modules?.case);
}

export function hasViagensAccess(ctx: SessionContext): boolean {
  return Boolean(ctx.modules?.viagens);
}

export function hasViagensAprovar(ctx: SessionContext): boolean {
  return Boolean(ctx.modules?.viagens?.aprovador);
}

// ─── Função principal ─────────────────────────────────────────────────────────

export async function getSessionContext(): Promise<SessionContext> {
  const isDevMode = process.env.NODE_ENV !== "production";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const empty: SessionContext = { supabase, user: null, profile: null, modules: null };
  if (!user) return empty;

  // Busca perfil + ctrl role + setores + empresas em uma query
  const { data: profileRow } = await supabase
    .from("users")
    .select(`
      id, email, name, role, company_id, active, created_at, contracts_only,
      profile, can_financeiro, can_compras, can_case, can_viagens, can_viagens_aprovar,
      user_module_roles!user_module_roles_user_id_fkey(role, module),
      user_sectors(sector_id),
      user_company_access(company_id)
    `)
    .eq("id", user.id)
    .maybeSingle();

  // Sem linha em public.users — não deveria mais acontecer: o trigger
  // `on_auth_user_created` em auth.users cria a linha no momento do signup,
  // e o backfill cobre cadastros antigos. Se ainda assim cair aqui, devolve
  // sessão vazia (o usuário acaba na tela /pendente) sem mascarar o problema.
  if (!profileRow) {
    return empty;
  }

  // Promoção automática do primeiro admin em dev
  if (isDevMode && profileRow.role !== "admin") {
    try {
      const adminClient = createAdminClientIfAvailable();
      if (adminClient) {
        const { count } = await adminClient
          .from("users")
          .select("id", { count: "exact", head: true })
          .eq("role", "admin")
          .eq("active", true);

        if (count === 0) {
          await adminClient.from("users").upsert(
            {
              id: user.id,
              email: user.email ?? `${user.id}@placeholder.local`,
              name: profileRow.name ?? null,
              role: "admin",
              company_id: null,
              active: true,
            },
            { onConflict: "id" },
          );
          // Re-fetch after promotion
          return getSessionContext();
        }
      } else {
        await supabase.rpc("promote_first_admin_if_none");
      }
    } catch {
      // Continue with current profile in dev if service role unavailable
    }
  }

  if (!profileRow.active && !isDevMode) {
    return empty;
  }

  // ── New unified model ────────────────────────────────────────────────────
  const userProfile = (profileRow.profile ?? null) as
    | "admin"
    | "contas_a_pagar"
    | "gerente"
    | "diretor"
    | "validador_contrato"
    | "solicitante"
    | "franqueado"
    | null;
  const canFinanceiro = Boolean(profileRow.can_financeiro);
  const canCompras = Boolean(profileRow.can_compras);
  // Admin sempre enxerga o Case (espelha has_case_access() no banco).
  const canCase =
    Boolean(profileRow.can_case) ||
    userProfile === "admin" ||
    profileRow.role === "admin";
  // Admin sempre enxerga Viagens e pode aprovar (espelha has_viagens_access()).
  // VIAGENS_ENABLED=false desliga o módulo pra todos (kill-switch).
  const isAdminUser = userProfile === "admin" || profileRow.role === "admin";
  const canViagens = VIAGENS_ENABLED && (Boolean(profileRow.can_viagens) || isAdminUser);
  const canViagensAprovar = VIAGENS_ENABLED && (Boolean(profileRow.can_viagens_aprovar) || isAdminUser);

  const sectorIds = (
    (profileRow.user_sectors as Array<{ sector_id: string }> | null) ?? []
  ).map((s) => s.sector_id);

  const companyIds = (
    (profileRow.user_company_access as Array<{ company_id: string }> | null) ?? []
  ).map((c) => c.company_id);

  // ── Compat layer: derive legacy fields from the new model ────────────────
  // Legacy code reads profile.role / profile.ctrl_roles / profile.contracts_only
  // — we keep those filled while the codebase migrates. New code should
  // consume `profile.profile` directly.
  const dreRole: DreRole = deriveDreRole(userProfile, profileRow.role as DreRole | null);
  const ctrlRoles: CtrlRole[] = deriveCtrlRoles(userProfile, canCompras, profileRow.user_module_roles as Array<{ role: string; module: string }> | null);

  const profile: UnifiedProfile = {
    id: profileRow.id,
    email: profileRow.email,
    name: profileRow.name,
    profile: userProfile ?? "solicitante", // fallback never expected post-backfill
    can_financeiro: canFinanceiro,
    can_compras: canCompras,
    can_case: canCase,
    can_viagens: canViagens,
    can_viagens_aprovar: canViagensAprovar,
    sector_ids: sectorIds,
    company_ids: companyIds,
    active: profileRow.active,
    created_at: profileRow.created_at,
    // ── legacy compat ──
    role: dreRole,
    ctrl_roles: ctrlRoles,
    company_id: profileRow.company_id ?? companyIds[0] ?? null,
    contracts_only: userProfile === "validador_contrato",
  };

  const modules: ModuleAccess = {
    dre: canFinanceiro ? { role: dreRole, companyId: profile.company_id } : null,
    ctrl: ctrlRoles.length > 0 ? { roles: ctrlRoles } : null,
    case: canCase ? {} : null,
    viagens: canViagens ? { aprovador: canViagensAprovar } : null,
  };

  return { supabase, user, profile, modules };
}

// ─── Compat helpers ──────────────────────────────────────────────────────────

function deriveDreRole(
  profile: UserProfileEnum | null,
  fallback: DreRole | null,
): DreRole {
  if (!profile) return fallback ?? "gestor_unidade";
  switch (profile) {
    case "admin":
      return "admin";
    case "diretor":
      return "gestor_hero";
    case "contas_a_pagar":
      return "gestor_hero";
    case "gerente":
      return "gestor_unidade";
    case "solicitante":
      return "gestor_unidade";
    case "validador_contrato":
      // contracts_only users had a 'gestor_unidade' role in the legacy model;
      // they don't really use DRE but we keep a value so old checks don't fail.
      return "gestor_unidade";
    case "franqueado":
      // Restricted financeiro user. 'gestor_unidade' is the most restrictive
      // legacy DRE role — keeps any legacy admin-only check denying access.
      return "gestor_unidade";
  }
}

type UserProfileEnum =
  | "admin"
  | "contas_a_pagar"
  | "gerente"
  | "diretor"
  | "validador_contrato"
  | "solicitante"
  | "franqueado";

function deriveCtrlRoles(
  profile: UserProfileEnum | null,
  canCompras: boolean,
  existingRows: Array<{ role: string; module: string }> | null,
): CtrlRole[] {
  if (!profile) {
    // Fall back to whatever exists in user_module_roles (pre-migration data)
    return (existingRows ?? [])
      .filter((r) => r.module === "ctrl")
      .map((r) => r.role as CtrlRole);
  }
  if (profile === "validador_contrato") return [];
  // Franqueado nunca tem acesso ao módulo Compras.
  if (profile === "franqueado") return [];
  if (!canCompras && profile !== "admin") return [];

  switch (profile) {
    case "admin":
      return ["admin"];
    case "contas_a_pagar":
      // 'contas_a_pagar' now absorbs csc + aprovacao_fornecedor permissions.
      return ["contas_a_pagar", "csc", "aprovacao_fornecedor"];
    case "diretor":
      return ["diretor"];
    case "gerente":
      return ["gerente"];
    case "solicitante":
      return ["solicitante"];
    default:
      return [];
  }
}

/** Alias retrocompatível — código existente continua funcionando sem alteração */
export const getCurrentSessionContext = getSessionContext;
