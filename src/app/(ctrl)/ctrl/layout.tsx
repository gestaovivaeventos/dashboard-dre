import { redirect } from "next/navigation";

import { AppShell } from "@/components/app/app-shell";
import { getSessionContext } from "@/lib/auth/session";
import { readActiveModule, readActiveSegmentSlug } from "@/lib/context/active-context";
import { resolveActiveModule, resolveAvailableModules } from "@/lib/context/modules";
import type { Segment } from "@/lib/supabase/types";

export default async function CtrlLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getSessionContext();

  if (!ctx.user) redirect("/login");
  if (!ctx.modules?.ctrl) redirect("/dashboard");

  const { profile, supabase, modules } = ctx;
  const userName  = profile?.name || ctx.user.email || "Usuario";
  const userEmail = profile?.email || ctx.user.email || "";
  const dreRole   = modules!.dre!.role;
  const ctrlRoles = modules!.ctrl!.roles;

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
  const availableModules = resolveAvailableModules(dreRole, ctrlRoles);
  const moduleCookie = await readActiveModule();
  const activeModuleDef = resolveActiveModule(moduleCookie, availableModules);
  const activeModule = activeModuleDef?.id ?? "ctrl";

  const segmentCookie = await readActiveSegmentSlug();
  const activeSegmentSlug =
    segmentCookie && segments.some((s) => s.slug === segmentCookie)
      ? segmentCookie
      : segments[0]?.slug ?? null;

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
    >
      {children}
    </AppShell>
  );
}
