import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { canAccessPath } from "@/lib/auth/access";
import { getSupabaseEnv } from "@/lib/supabase/env";
import type { DreRole, CtrlRole } from "@/lib/supabase/types";

export async function updateSession(request: NextRequest) {
  const isDevMode = process.env.NODE_ENV !== "production";
  const response = NextResponse.next({ request });
  const { supabaseAnonKey, supabaseUrl } = getSupabaseEnv();
  const pathname = request.nextUrl.pathname;

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          request.cookies.set(name, value);
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const { data: { user } } = await supabase.auth.getUser();

  const isAuthRoute =
    pathname === "/login" ||
    pathname === "/signup" ||
    pathname === "/pendente" ||
    pathname.startsWith("/auth/callback");
  const isApiRoute  = pathname.startsWith("/api/");
  const isPublicRoot = pathname === "/";

  let supabaseResponse = response;

  if (!user && !isAuthRoute && !isApiRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirectedFrom", pathname);
    supabaseResponse = NextResponse.redirect(url);
  } else if (user && (pathname === "/login" || pathname === "/signup")) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    supabaseResponse = NextResponse.redirect(url);
  } else if (user && !isApiRoute && !isAuthRoute && !isPublicRoot && !isDevMode) {
    const { data: profileData } = await supabase
      .from("users")
      .select(`
        role, active,
        user_module_roles!user_module_roles_user_id_fkey(role, module)
      `)
      .eq("id", user.id)
      .maybeSingle<{
        role: DreRole;
        active: boolean;
        user_module_roles: Array<{ role: string; module: string }> | null;
      }>();

    const dreRole: DreRole = profileData?.role ?? "gestor_unidade";
    const isActive = profileData?.active ?? true;

    if (!isActive) {
      const url = request.nextUrl.clone();
      url.pathname = "/pendente";
      supabaseResponse = NextResponse.redirect(url);
    } else {
      const ctrlModuleRow = profileData?.user_module_roles?.find((r) => r.module === "ctrl");
      const ctrlRole: CtrlRole | null =
        dreRole === "admin" ? "admin" : ctrlModuleRow ? (ctrlModuleRow.role as CtrlRole) : null;

      if (!canAccessPath(pathname, dreRole, ctrlRole)) {
        const url = request.nextUrl.clone();
        url.pathname = pathname.startsWith("/ctrl") ? "/ctrl/requisicoes" : "/dashboard";
        supabaseResponse = NextResponse.redirect(url);
      }
    }
  }

  if (supabaseResponse !== response) {
    const cookiesToSet = response.cookies.getAll();
    cookiesToSet.forEach(({ name, value, ...options }) => {
      supabaseResponse.cookies.set(name, value, options);
    });
  }

  return supabaseResponse;
}
