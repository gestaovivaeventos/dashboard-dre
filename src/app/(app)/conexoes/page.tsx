import { ConnectionsGrid } from "@/components/app/connections-grid";
import { redirect } from "next/navigation";

import { getCurrentSessionContext } from "@/lib/auth/session";

export default async function ConexoesPage() {
  const { user, profile } = await getCurrentSessionContext();
  if (!user) {
    redirect("/login");
  }
  if (!profile || (profile.role !== "admin" && profile.role !== "gestor_hero")) {
    redirect("/dashboard");
  }

  return <ConnectionsGrid />;
}
