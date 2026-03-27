import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { canAccessPath } from "@/lib/auth/access";
import { getSupabaseEnv } from "@/lib/supabase/env";

export async function updateSession(request: NextRequest) {
  const isDevMode = process.env.NODE_ENV !== "production";
  const response = NextResponse.next({
    request,
  });
  const { supabaseAnonKey, supabaseUrl } = getSupabaseEnv();

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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isAuthRoute =
    request.nextUrl.pathname === "/login" ||
    request.nextUrl.pathname === "/signup" ||
    request.nextUrl.pathname.startsWith("/auth/callback");
  const isApiRoute = request.nextUrl.pathname.startsWith("/api/");
  const isPublicRoot = request.nextUrl.pathname === "/";

  let supabaseResponse = response;

  if (!user && !isAuthRoute && !isApiRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirectedFrom", request.nextUrl.pathname);
    supabaseResponse = NextResponse.redirect(url);
  } else if (user && (request.nextUrl.pathname === "/login" || request.nextUrl.pathname === "/signup")) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    supabaseResponse = NextResponse.redirect(url);
  } else if (user && !isApiRoute && !isAuthRoute && !isPublicRoot && !isDevMode) {
    const { data: profile } = await supabase
      .from("users")
      .select("role,active")
      .eq("id", user.id)
      .maybeSingle<{ role: "admin" | "gestor_hero" | "gestor_unidade"; active: boolean }>();

    const role = profile?.role ?? "gestor_unidade";
    const isActive = profile?.active ?? true;

    if (!isActive) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("reason", "inactive");
      supabaseResponse = NextResponse.redirect(url);
    } else if (!canAccessPath(request.nextUrl.pathname, role)) {
      const url = request.nextUrl.clone();
      url.pathname = "/dashboard";
      supabaseResponse = NextResponse.redirect(url);
    }
  }

  // Copy over the cookies from the original response (which may have been updated by Supabase)
  // to our final response, whether it's a redirect or the original request.
  if (supabaseResponse !== response) {
    const cookiesToSet = response.cookies.getAll();
    cookiesToSet.forEach(({ name, value, ...options }) => {
      supabaseResponse.cookies.set(name, value, options);
    });
  }

  return supabaseResponse;
}
