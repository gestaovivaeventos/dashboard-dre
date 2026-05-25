import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { canAccessPathByProfile, defaultLandingFor } from "@/lib/auth/access";
import { getSupabaseEnv } from "@/lib/supabase/env";
import type { UserProfileType } from "@/lib/supabase/types";

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
    // Auth user em /login ou /signup → manda pra raiz. A root page (server)
    // faz redirect inteligente baseado em profile + active. Centraliza a
    // decisão num único lugar pra evitar loops causados por destinos
    // inconsistentes entre middleware e pages.
    const url = request.nextUrl.clone();
    url.pathname = "/";
    supabaseResponse = NextResponse.redirect(url);
  } else if (user && !isApiRoute && !isAuthRoute && !isPublicRoot && !isDevMode) {
    const { data: profileData } = await supabase
      .from("users")
      .select("profile, active, can_financeiro, can_compras")
      .eq("id", user.id)
      .maybeSingle<{
        profile: UserProfileType | null;
        active: boolean;
        can_financeiro: boolean | null;
        can_compras: boolean | null;
      }>();

    const userProfile: UserProfileType = profileData?.profile ?? "solicitante";
    const canFinanceiro = Boolean(profileData?.can_financeiro);
    const canCompras = Boolean(profileData?.can_compras);
    const isActive = profileData?.active ?? true;

    if (!isActive) {
      const url = request.nextUrl.clone();
      url.pathname = "/pendente";
      supabaseResponse = NextResponse.redirect(url);
    } else if (!canAccessPathByProfile(pathname, userProfile, canFinanceiro, canCompras)) {
      const url = request.nextUrl.clone();
      url.pathname = defaultLandingFor(userProfile, canFinanceiro, canCompras);
      supabaseResponse = NextResponse.redirect(url);
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
