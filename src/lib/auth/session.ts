import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import type { UserProfile } from "@/lib/supabase/types";

export async function getCurrentSessionContext() {
  const isDevMode = process.env.NODE_ENV !== "production";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { supabase, user: null, profile: null };
  }

  let { data: profile } = await supabase
    .from("users")
    .select("id,email,name,role,company_id,active,created_at")
    .eq("id", user.id)
    .maybeSingle<UserProfile>();

  if (!profile) {
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

    const { data: refreshedProfile } = await supabase
      .from("users")
      .select("id,email,name,role,company_id,active,created_at")
      .eq("id", user.id)
      .maybeSingle<UserProfile>();
    profile = refreshedProfile ?? null;
  }

  // In dev mode, promote the current user to admin ONLY if there are no admins
  // in the system yet (first-time setup). This avoids overwriting role changes
  // made via the Users admin panel.
  if (isDevMode && user && (!profile || profile.role !== "admin")) {
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
              name:
                profile?.name ??
                (typeof user.user_metadata?.name === "string" ? user.user_metadata.name : null),
              role: "admin",
              company_id: null,
              active: true,
            },
            { onConflict: "id" },
          );

          const { data: promotedProfile } = await supabase
            .from("users")
            .select("id,email,name,role,company_id,active,created_at")
            .eq("id", user.id)
            .maybeSingle<UserProfile>();

          profile = promotedProfile ?? profile;
        }
      } else {
        await supabase.rpc("promote_first_admin_if_none");
      }
    } catch {
      // In dev, if service role is missing, continue with current profile.
    }
  }

  if (isDevMode && user && !profile) {
    profile = {
      id: user.id,
      email: user.email ?? `${user.id}@placeholder.local`,
      name:
        typeof user.user_metadata?.name === "string" ? user.user_metadata.name : null,
      role: "admin",
      company_id: null,
      active: true,
      created_at: new Date().toISOString(),
    };
  }

  if (profile && profile.active === false) {
    return { supabase, user: null, profile: null };
  }

  return { supabase, user, profile: profile ?? null };
}
