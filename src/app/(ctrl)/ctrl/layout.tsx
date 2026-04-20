import { redirect } from "next/navigation";

import { AppShell } from "@/components/app/app-shell";
import { getSessionContext } from "@/lib/auth/session";
import type { Segment } from "@/lib/supabase/types";

export default async function CtrlLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getSessionContext();

  if (!ctx.user) redirect("/login");
  if (!ctx.modules?.ctrl) redirect("/dashboard");

  const { profile, supabase, modules } = ctx;
  const userName  = profile?.name || ctx.user.email || "Usuario";
  const userEmail = profile?.email || ctx.user.email || "";
  const dreRole   = modules!.dre!.role;
  const ctrlRole  = modules!.ctrl!.role;

  // Segmentos para o shell DRE (mesmo do (app) layout)
  let segments: Segment[] = [];
  if (dreRole === "admin") {
    const { data } = await supabase
      .from("segments")
      .select("id,name,slug,display_order,active")
      .eq("active", true)
      .order("display_order");
    segments = (data as Segment[]) ?? [];
  } else if (profile) {
    const { data } = await supabase
      .from("user_segment_access")
      .select("segments(id,name,slug,display_order,active)")
      .eq("user_id", profile.id);
    segments = ((data ?? []) as unknown as Array<{ segments: Segment }>)
      .map((row) => row.segments)
      .filter((s) => s && s.active)
      .sort((a, b) => a.display_order - b.display_order);
  }

  return (
    <AppShell
      userName={userName}
      userEmail={userEmail}
      userRole={dreRole}
      ctrlRole={ctrlRole}
      segments={segments}
    >
      {children}
    </AppShell>
  );
}
