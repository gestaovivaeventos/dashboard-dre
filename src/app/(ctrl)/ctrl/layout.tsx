import { redirect } from "next/navigation";

import { AppShell } from "@/components/app/app-shell";
import { getSessionContext } from "@/lib/auth/session";
import { resolveLayoutContext } from "@/lib/context/modules";
import { resolveUserSegments } from "@/lib/context/user-segments";
import { getUnreadNotificationsCount } from "@/lib/ctrl/notifications";

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

  // Segmentos para o shell DRE — fonte única compartilhada com o (app) layout
  // e as páginas DRE (resolveUserSegments): admin vê todos; os demais recebem a
  // UNIÃO de user_segment_access com os segmentos derivados das empresas em
  // user_company_access. Sem a união, um perfil com 1 acesso explícito + várias
  // empresas em outros segmentos (ou só acesso por unidade) ficava preso num
  // único segmento → itens scope:"segment" do menu Financeiro somem/limitam.
  const segments = await resolveUserSegments(supabase, {
    isAdmin: dreRole === "admin",
    userId: profile?.id ?? null,
    companyIds: profile?.company_ids ?? [],
  });

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
