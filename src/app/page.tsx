import { redirect } from "next/navigation";

import { defaultLandingFor } from "@/lib/auth/access";
import { hasContratosGrant } from "@/lib/auth/contratos";
import { createClient } from "@/lib/supabase/server";
import type { UserProfileType } from "@/lib/supabase/types";

/**
 * Página raiz — atua como roteador de entrada do app.
 *
 * Decide o destino com base em:
 *   - sem auth → /login
 *   - auth + active === false → /pendente
 *   - auth + active → defaultLandingFor(profile, can_financeiro, can_compras)
 *
 * Login/signup pages só precisam fazer router.push("/") após sucesso —
 * a decisão acontece aqui em UM lugar (single source of truth).
 */
export default async function RootRouter() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Lê o perfil sem aplicar a checagem de `active` que o session.ts faz
  // (que retornaria empty pra inativo). Aqui precisamos saber o active
  // pra decidir entre /pendente vs landing.
  const { data: profileRow } = await supabase
    .from("users")
    .select(
      "profile, active, contracts_only, can_financeiro, can_compras, can_case, user_module_roles!user_module_roles_user_id_fkey(module)",
    )
    .eq("id", user.id)
    .maybeSingle<{
      profile: UserProfileType | null;
      active: boolean | null;
      contracts_only: boolean | null;
      can_financeiro: boolean | null;
      can_compras: boolean | null;
      can_case: boolean | null;
      user_module_roles: Array<{ module: string | null }> | null;
    }>();

  // Sem profile (signup ainda não materializado) ou inativo → /pendente.
  if (!profileRow || profileRow.active === false) {
    redirect("/pendente");
  }

  const userProfile = profileRow.profile ?? "solicitante";
  // Módulo Validação de Contratos — mesma regra do getSessionContext.
  const canContratos =
    hasContratosGrant(profileRow.user_module_roles) ||
    userProfile === "validador_contrato" ||
    Boolean(profileRow.contracts_only) ||
    userProfile === "admin";

  redirect(
    defaultLandingFor(
      userProfile,
      Boolean(profileRow.can_financeiro),
      Boolean(profileRow.can_compras),
      Boolean(profileRow.can_case),
      // Viagens fica de fora do roteamento de entrada como sempre esteve — o
      // módulo tem kill-switch próprio (VIAGENS_ENABLED) e mandar alguém pra
      // /viagens com ele desligado devolveria o usuário pra cá.
      false,
      canContratos,
    ),
  );
}
