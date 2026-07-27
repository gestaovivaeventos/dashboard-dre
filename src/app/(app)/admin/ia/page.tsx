import { redirect } from "next/navigation";

import { AiAdminClient } from "@/components/app/ai-admin-client";
import { getAiPanelData } from "@/lib/ai/settings-actions";
import { getCurrentSessionContext } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function AiAdminPage() {
  const { user, profile } = await getCurrentSessionContext();

  if (!user) {
    redirect("/login");
  }
  if (!profile || profile.role !== "admin") {
    redirect("/dashboard");
  }

  const data = await getAiPanelData();

  return <AiAdminClient initial={data} />;
}
