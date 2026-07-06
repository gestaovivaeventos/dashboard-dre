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
  // Papel DRE para o MENU: só quem realmente tem o módulo Financeiro. Sem isso,
  // perfis só-Compras (ex.: solicitante) herdariam o fallback 'gestor_unidade'
  // e veriam telas financeiras globais (ex.: "Documentos anexos") no menu — o
  // mesmo tratamento do layout (app). `dreRole` acima segue servindo o resto.
  const navDreRole = modules.dre?.role ?? null;
  const ctrlRoles = modules.ctrl?.roles ?? [];
  const canCase = Boolean(modules.case);
  const canViagens = Boolean(modules.viagens);
  const canViagensAprovar = Boolean(modules.viagens?.aprovador);

  // Segmentos para o shell DRE (mesmo do (app) layout).
  // 1) Admin: vê todos os segmentos ativos.
  // 2) Outros: primeiro tenta user_segment_access; se vazio, deriva dos
  //    companies em user_company_access (cada company carrega segment_id).
  //    Sem esse fallback, um perfil que só recebeu acesso por unidade (ex.:
  //    diretor com Compras + Financeiro) fica com segments vazio ao navegar
  //    numa tela CTRL → activeSegmentSlug null → itens scope:"segment" do
  //    menu Financeiro (DRE Gerencial, Fluxo de Caixa, Budget) somem do
  //    sidebar. O (app) layout já faz esse fallback; espelhamos aqui.
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

  // Resolve module/segment context — ctrl layout always lands in ctrl module.
  const { availableModules, activeModule, activeSegmentSlug } = await resolveLayoutContext(
    dreRole,
    ctrlRoles,
    segments,
    "ctrl",
    canCase,
    canViagens,
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
      canViagens={canViagens}
      canViagensAprovar={canViagensAprovar}
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
