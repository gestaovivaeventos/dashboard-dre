import { redirect } from "next/navigation";

import { AppShell } from "@/components/app/app-shell";
import { getSessionContext } from "@/lib/auth/session";
import { resolveLayoutContext } from "@/lib/context/modules";
import { getUnreadNotificationsCount } from "@/lib/ctrl/notifications";
import type { Segment } from "@/lib/supabase/types";

export default async function CtrlLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getSessionContext();

  if (!ctx.user) redirect("/login");
  if (!ctx.modules?.ctrl) redirect("/dashboard");

  const { profile, supabase, modules } = ctx;
  const userName  = profile?.name || ctx.user.email || "Usuario";
  const userEmail = profile?.email || ctx.user.email || "";
  // dreRole pode não vir em `modules.dre` quando o user só tem Compras
  // (can_financeiro=false). Fallback pro role legado derivado em
  // session.ts → garante que o AppShell receba um valor válido.
  const dreRole   = modules.dre?.role ?? profile?.role ?? "gestor_unidade";
  const ctrlRoles = modules.ctrl?.roles ?? [];

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

  // Resolve module/segment context — ctrl layout always lands in ctrl module.
  const { availableModules, activeModule, activeSegmentSlug } = await resolveLayoutContext(
    dreRole,
    ctrlRoles,
    segments,
    "ctrl",
  );

  const unreadNotifications = profile?.id
    ? await getUnreadNotificationsCount(profile.id)
    : 0;

  return (
    <AppShell
      userName={userName}
      userEmail={userEmail}
      userRole={dreRole}
      ctrlRoles={ctrlRoles}
      segments={segments}
      activeModule={activeModule}
      availableModules={availableModules}
      activeSegmentSlug={activeSegmentSlug}
      unreadNotifications={unreadNotifications}
    >
      {children}
    </AppShell>
  );
}
