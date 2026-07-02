import { redirect } from "next/navigation";

import { defaultLandingFor } from "@/lib/auth/access";
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
    .select("profile, active, can_financeiro, can_compras, can_case")
    .eq("id", user.id)
    .maybeSingle<{
      profile: UserProfileType | null;
      active: boolean | null;
      can_financeiro: boolean | null;
      can_compras: boolean | null;
      can_case: boolean | null;
    }>();

  // Sem profile (signup ainda não materializado) ou inativo → /pendente.
  if (!profileRow || profileRow.active === false) {
    redirect("/pendente");
  }

  redirect(
    defaultLandingFor(
      profileRow.profile ?? "solicitante",
      Boolean(profileRow.can_financeiro),
      Boolean(profileRow.can_compras),
      Boolean(profileRow.can_case),
    ),
  );
}
