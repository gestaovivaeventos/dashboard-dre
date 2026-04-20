import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
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
  if (!ctx.modules?.ctrl) return false;
  if (!roles || roles.length === 0) return true;
  return roles.includes(ctx.modules.ctrl.role);
}

// ─── Função principal ─────────────────────────────────────────────────────────

export async function getSessionContext(): Promise<SessionContext> {
  const isDevMode = process.env.NODE_ENV !== "production";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const empty: SessionContext = { supabase, user: null, profile: null, modules: null };
  if (!user) return empty;

  // Busca perfil + ctrl role em uma query
  const { data: profileRow } = await supabase
    .from("users")
    .select(`
      id, email, name, role, company_id, active, created_at,
      user_module_roles!user_module_roles_user_id_fkey(role, module)
    `)
    .eq("id", user.id)
    .maybeSingle();

  // Novo usuário — cria perfil mínimo
  if (!profileRow) {
    const fallbackName =
      typeof user.user_metadata?.name === "string" ? user.user_metadata.name : null;
    await supabase.from("users").upsert(
      {
        id: user.id,
        email: user.email ?? `${user.id}@placeholder.local`,
        name: fallbackName,
        role: "gestor_unidade",
        company_id: null,
        active: false,
      },
      { onConflict: "id" },
    );
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

  const dreRole = profileRow.role as DreRole;

  const ctrlModuleRow = (
    profileRow.user_module_roles as Array<{ role: string; module: string }> | null
  )?.find((r) => r.module === "ctrl");

  const ctrlRole: CtrlRole | null =
    dreRole === "admin" ? "admin" : ctrlModuleRow ? (ctrlModuleRow.role as CtrlRole) : null;

  const profile: UnifiedProfile = {
    id: profileRow.id,
    email: profileRow.email,
    name: profileRow.name,
    role: dreRole,
    ctrl_role: ctrlRole,
    company_id: profileRow.company_id,
    active: profileRow.active,
    created_at: profileRow.created_at,
  };

  const modules: ModuleAccess = {
    dre: { role: dreRole, companyId: profileRow.company_id },
    ctrl: ctrlRole ? { role: ctrlRole } : null,
  };

  return { supabase, user, profile, modules };
}

/** Alias retrocompatível — código existente continua funcionando sem alteração */
export const getCurrentSessionContext = getSessionContext;
