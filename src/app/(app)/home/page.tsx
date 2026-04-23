import { redirect } from "next/navigation";

import { HomeView } from "@/components/app/home-view";
import { getCurrentSessionContext } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { user, profile, modules } = await getCurrentSessionContext();
  if (!user) redirect("/login");

  const userName = profile?.name || user.email || "Usuario";
  const ctrlRoles = modules?.ctrl?.roles ?? [];

  // Mostra contagem de aprovacoes pendentes para quem tem algum role com poder de aprovacao
  const canSeeApprovals = ctrlRoles.some((r) =>
    ["gerente", "diretor", "csc", "admin", "contas_a_pagar", "aprovacao_fornecedor"].includes(r),
  );

  let pendingApprovalsCount = 0;
  if (canSeeApprovals) {
    try {
      const adminClient = createAdminClient();
      const { count } = await adminClient
        .from("ctrl_requests")
        .select("id", { count: "exact", head: true })
        .eq("status", "pendente");
      pendingApprovalsCount = count ?? 0;
    } catch {
      // non-fatal — ctrl tables may not exist yet
    }
  }

  return (
    <HomeView
      userName={userName}
      ctrlRoles={ctrlRoles}
      pendingApprovalsCount={pendingApprovalsCount}
    />
  );
}
