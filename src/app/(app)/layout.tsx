import { redirect } from "next/navigation";

import { AppShell } from "@/components/app/app-shell";
import { getCurrentSessionContext } from "@/lib/auth/session";
import type { Segment } from "@/lib/supabase/types";

export default async function ProtectedLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { supabase, user, profile } = await getCurrentSessionContext();

  if (!user) {
    redirect("/login");
  }

  const userName = profile?.name || user.email || "Usuario";
  const userEmail = profile?.email || user.email || "";
  const userRole = profile?.role ?? "gestor_unidade";

  // Fetch segments the user has access to
  let segments: Segment[] = [];
  if (userRole === "admin") {
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
    <AppShell userName={userName} userEmail={userEmail} userRole={userRole} segments={segments}>
      {children}
    </AppShell>
  );
}
