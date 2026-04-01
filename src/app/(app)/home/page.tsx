import { redirect } from "next/navigation";

import { HomeView } from "@/components/app/home-view";
import { getCurrentSessionContext } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { user, profile } = await getCurrentSessionContext();
  if (!user) redirect("/login");
  const userName = profile?.name || user.email || "Usuario";
  return <HomeView userName={userName} />;
}
