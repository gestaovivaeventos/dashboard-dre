import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { canAccessPathByProfile, defaultLandingFor } from "@/lib/auth/access";
import { hasContratosGrant } from "@/lib/auth/contratos";
import { getSupabaseEnv } from "@/lib/supabase/env";
import type { UserProfileType } from "@/lib/supabase/types";

export async function updateSession(request: NextRequest) {
  const isDevMode = process.env.NODE_ENV !== "production";
  const response = NextResponse.next({ request });
  const { supabaseAnonKey, supabaseUrl } = getSupabaseEnv();
  const pathname = request.nextUrl.pathname;

  // Link de recuperação/convite que caiu na raiz (ou no login) em vez de
  // /redefinir-senha. Acontece quando o Supabase descarta o `redirect_to` e
  // usa o Site URL no lugar — destino fora da allowlist de Redirect URLs, ou
  // e-mail disparado pelo painel (que não manda redirectTo nenhum).
  // Sem este desvio o `?code=` morre no redirect da raiz para /login e o
  // usuário cai numa tela de login sem erro nenhum, como se o link não
  // valesse. O fragmento (#access_token) não chega ao servidor: aquele caso é
  // tratado no cliente, em /login.
  //
  // Os links que o app envia hoje já apontam direto para /redefinir-senha com
  // `token_hash` (ver src/lib/auth/password-recovery.ts) — este desvio cobre os
  // links antigos, ainda em caixas de entrada, e qualquer e-mail disparado pelo
  // painel do Supabase.
  if (
    (pathname === "/" || pathname === "/login") &&
    (request.nextUrl.searchParams.has("code") ||
      request.nextUrl.searchParams.has("token_hash") ||
      request.nextUrl.searchParams.get("type") === "recovery")
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/redefinir-senha";
    return NextResponse.redirect(url);
  }

  // Link de e-mail recusado pelo GoTrue (expirado/já usado): ele devolve
  // `error`/`error_code` no destino. Na raiz esses parâmetros morreriam no
  // redirect para /login — o usuário via a tela de login sem explicação
  // nenhuma. Preserva a query para o login conseguir mostrar o motivo.
  if (
    pathname === "/" &&
    (request.nextUrl.searchParams.has("error") ||
      request.nextUrl.searchParams.has("error_code"))
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

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
    // Recuperação de senha: "/recuperar-senha" é público (deslogado pede o link);
    // "/redefinir-senha" recebe a sessão de recovery na própria URL (?code= ou
    // #access_token, processados pelo browser client) e define a nova senha —
    // fica fora do guard de perfil pra não ser redirecionada.
    pathname === "/recuperar-senha" ||
    pathname === "/redefinir-senha" ||
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
      .select(
        "profile, active, contracts_only, can_financeiro, can_compras, can_case, can_viagens, user_module_roles!user_module_roles_user_id_fkey(module)",
      )
      .eq("id", user.id)
      .maybeSingle<{
        profile: UserProfileType | null;
        active: boolean;
        contracts_only: boolean | null;
        can_financeiro: boolean | null;
        can_compras: boolean | null;
        can_case: boolean | null;
        can_viagens: boolean | null;
        user_module_roles: Array<{ module: string | null }> | null;
      }>();

    const userProfile: UserProfileType = profileData?.profile ?? "solicitante";
    const canFinanceiro = Boolean(profileData?.can_financeiro);
    const canCompras = Boolean(profileData?.can_compras);
    const canCase = Boolean(profileData?.can_case);
    const canViagens = Boolean(profileData?.can_viagens);
    // Mesma regra do getSessionContext: concessão explícita do módulo, perfil
    // validador (ou o flag legado) e admin.
    const canContratos =
      hasContratosGrant(profileData?.user_module_roles) ||
      userProfile === "validador_contrato" ||
      Boolean(profileData?.contracts_only) ||
      userProfile === "admin";
    const isActive = profileData?.active ?? true;

    if (!isActive) {
      const url = request.nextUrl.clone();
      url.pathname = "/pendente";
      supabaseResponse = NextResponse.redirect(url);
    } else if (
      !canAccessPathByProfile(
        pathname,
        userProfile,
        canFinanceiro,
        canCompras,
        canCase,
        canViagens,
        canContratos,
        // Necessário para a tela "Validação Relatório", liberada nominalmente
        // para dois e-mails além de CSC/admin.
        user.email ?? null,
      )
    ) {
      const url = request.nextUrl.clone();
      url.pathname = defaultLandingFor(
        userProfile,
        canFinanceiro,
        canCompras,
        canCase,
        canViagens,
        canContratos,
      );
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
