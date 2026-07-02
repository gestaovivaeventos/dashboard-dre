import { redirect } from "next/navigation";

import { AppShell } from "@/components/app/app-shell";
import { getCurrentSessionContext } from "@/lib/auth/session";
import { resolveLayoutContext } from "@/lib/context/modules";
import { getUnreadNotificationsCount } from "@/lib/ctrl/notifications";
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
  // Papel DRE para o MENU: só quem realmente tem o módulo Financeiro. Sem isso,
  // perfis só-Compras (ex.: solicitante) herdariam o dreRole de compatibilidade
  // 'gestor_unidade' e veriam telas financeiras globais (ex.: "Documentos
  // anexos") no menu lateral. O `userRole` acima continua servindo o restante
  // do layout (resolveLayoutContext, query de segmentos).
  const navDreRole = modules?.dre?.role ?? null;
  const ctrlRoles = modules?.ctrl?.roles ?? [];
  const canCase = Boolean(modules?.case);
  const contractsOnly = profile?.contracts_only === true;
  const isFranqueado = profile?.profile === "franqueado";

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
      // Duas queries simples em vez de PostgREST embed (mais robusto contra
      // ambiguidade de relations):
      // 1) pega segment_ids distintos das companies do usuário
      // 2) carrega segments por esses IDs
      const { data: companiesData } = await supabase
        .from("companies")
        .select("segment_id")
        .in("id", profile.company_ids)
        .eq("active", true);

      const segmentIds = Array.from(
        new Set(
          ((companiesData ?? []) as Array<{ segment_id: string | null }>)
            .map((c) => c.segment_id)
            .filter((s): s is string => !!s),
        ),
      );

      if (segmentIds.length > 0) {
        const { data: segData } = await supabase
          .from("segments")
          .select("id,name,slug,display_order,active")
          .in("id", segmentIds)
          .eq("active", true)
          .order("display_order");
        segments = (segData as Segment[]) ?? [];
      }
    }
  }

  // Resolve module/segment context.
  const { availableModules, activeModule, activeSegmentSlug } = await resolveLayoutContext(
    userRole,
    ctrlRoles,
    segments,
    "dre",
    canCase,
  );

  const unreadNotifications = profile?.id
    ? await getUnreadNotificationsCount(profile.id)
    : 0;

  return (
    <AppShell
      userName={userName}
      userEmail={userEmail}
      userRole={navDreRole}
      ctrlRoles={ctrlRoles}
      canCase={canCase}
      segments={segments}
      activeModule={activeModule}
      availableModules={availableModules}
      activeSegmentSlug={activeSegmentSlug}
      contractsOnly={contractsOnly}
      isFranqueado={isFranqueado}
      unreadNotifications={unreadNotifications}
    >
      {children}
    </AppShell>
  );
}
