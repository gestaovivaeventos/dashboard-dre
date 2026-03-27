import { ConnectionsGrid } from "@/components/app/connections-grid";
import { redirect } from "next/navigation";

import { getCurrentSessionContext } from "@/lib/auth/session";

interface ConexoesPageProps {
  params?: { segmentSlug?: string };
}

export default async function ConexoesPage({ params }: ConexoesPageProps) {
  const { user, profile } = await getCurrentSessionContext();
  if (!user) {
    redirect("/login");
  }
  if (!profile || (profile.role !== "admin" && profile.role !== "gestor_hero")) {
    redirect("/dashboard");
  }

  return <ConnectionsGrid segmentSlug={params?.segmentSlug} />;
}
