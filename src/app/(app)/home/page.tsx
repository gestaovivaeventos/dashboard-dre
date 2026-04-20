import { redirect } from "next/navigation";

import { HomeView } from "@/components/app/home-view";
import { getCurrentSessionContext } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { user, profile, modules } = await getCurrentSessionContext();
  if (!user) redirect("/login");

  const userName = profile?.name || user.email || "Usuario";
  const ctrlRole = modules?.ctrl?.role ?? null;

  let pendingApprovalsCount = 0;
  if (ctrlRole && ctrlRole !== "solicitante") {
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
      ctrlRole={ctrlRole}
      pendingApprovalsCount={pendingApprovalsCount}
    />
  );
}
