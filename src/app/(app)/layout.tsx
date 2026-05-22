import { redirect } from "next/navigation";

import { AppShell } from "@/components/app/app-shell";
import { getCurrentSessionContext } from "@/lib/auth/session";
import { resolveLayoutContext } from "@/lib/context/modules";
import type { Segment } from "@/lib/supabase/types";

export default async function ProtectedLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { supabase, user, profile, modules } = await getCurrentSessionContext();

  if (!user) {
    redirect("/login");
  }

  const userName = profile?.name || user.email || "Usuario";
  const userEmail = profile?.email || user.email || "";
  const userRole = modules?.dre?.role ?? profile?.role ?? "gestor_unidade";
  const ctrlRoles = modules?.ctrl?.roles ?? [];
  const contractsOnly = profile?.contracts_only === true;

  // Fetch segments the user has access to.
  // 1) Admin: vê todos os segmentos ativos.
  // 2) Outros: primeiro tenta user_segment_access; se vazio, deriva dos
  //    companies em user_company_access (cada company carrega segment_id).
  //    Esse fallback cobre franqueado e qualquer perfil que só recebeu
  //    vínculo por unidade — o sidebar precisa de um slug válido pra
  //    renderizar itens scope:"segment" (/s/<slug>/dashboard, etc.).
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

    if (segments.length === 0 && profile.company_ids.length > 0) {
      const { data: companiesData } = await supabase
        .from("companies")
        .select("segment_id, segments!inner(id,name,slug,display_order,active)")
        .in("id", profile.company_ids)
        .eq("active", true);
      const segmentMap = new Map<string, Segment>();
      ((companiesData ?? []) as unknown as Array<{ segments: Segment }>).forEach((row) => {
        const seg = row.segments;
        if (seg && seg.active && !segmentMap.has(seg.id)) segmentMap.set(seg.id, seg);
      });
      segments = Array.from(segmentMap.values()).sort(
        (a, b) => a.display_order - b.display_order,
      );
    }
  }

  // Resolve module/segment context.
  const { availableModules, activeModule, activeSegmentSlug } = await resolveLayoutContext(
    userRole,
    ctrlRoles,
    segments,
    "dre",
  );

  return (
    <AppShell
      userName={userName}
      userEmail={userEmail}
      userRole={userRole}
      ctrlRoles={ctrlRoles}
      segments={segments}
      activeModule={activeModule}
      availableModules={availableModules}
      activeSegmentSlug={activeSegmentSlug}
      contractsOnly={contractsOnly}
    >
      {children}
    </AppShell>
  );
}
